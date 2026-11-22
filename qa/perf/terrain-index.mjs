// Opt-in, host-specific microbenchmark of the real terrain index implementation.
// Run: node --expose-gc qa/perf/terrain-index.mjs
import { performance } from 'node:perf_hooks'
import { setImmediate } from 'node:timers/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

if (typeof globalThis.gc !== 'function') {
  console.error('Run with --expose-gc to compare WeakRef collection across event-loop turns.')
  process.exit(2)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const { normalizeTerrain, terrainCellKey, terrainKindIndex } = await server.ssrLoadModule(
    '/src/domain/terrain/terrainField.ts',
  )
  // Keep the exact same three immutable revisions alive for both implementations.
  // 14K cells models a large editor terrain; the 3-revision working set
  // exercises normal undo/edit access without growing the strong cache.
  const terrains = Array.from({ length: 3 }, (_, revision) => normalizeTerrain({
    cells: Array.from({ length: 14_000 }, (_, index) => ({
      column: index % 140 - 70,
      row: Math.floor(index / 140) - 50,
      kind: (index + revision) % 2 ? 'water' : 'hill',
    })),
  }))
  const original = new WeakMap()
  const weakIndex = terrain => {
    const cached = original.get(terrain)?.deref()
    if (cached) return cached
    const index = new Map()
    for (const cell of terrain.cells) index.set(terrainCellKey(cell), cell.kind)
    original.set(terrain, new WeakRef(index))
    return index
  }
  const collect = async () => {
    // WeakRef deref holds its target until the current JS job ends.
    await setImmediate()
    globalThis.gc()
    await setImmediate()
    globalThis.gc()
  }
  const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b)
    return Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(3))
  }
  const measure = async read => {
    const seen = new WeakMap()
    const durations = []
    let rebuilds = 0
    let checksum = 0
    for (let iteration = 0; iteration < 30; iteration++) {
      await collect()
      for (const terrain of terrains) {
        const previous = seen.get(terrain)?.deref()
        const start = performance.now()
        const index = read(terrain)
        for (let i = 0; i < 64; i++) {
          const column = i % 140 - 70
          const row = Math.floor(i / 140) - 50
          if (index.get(`${column}:${row}`) === 'hill') checksum++
        }
        durations.push(performance.now() - start)
        if (previous !== index) rebuilds++
        seen.set(terrain, new WeakRef(index))
      }
    }
    return { samples: durations.length, rebuilds, p50Ms: percentile(durations, 0.50),
      p95Ms: percentile(durations, 0.95), checksum }
  }

  const weak = await measure(weakIndex)
  await collect()
  const heapBefore = process.memoryUsage().heapUsed
  // Warm exactly three strongly cached revisions; preserve the terrain arrays.
  for (const terrain of terrains) terrainKindIndex(terrain)
  await collect()
  const retainedIndexMiB = Number(((process.memoryUsage().heapUsed - heapBefore) / 1048576).toFixed(2))
  const strongLru = await measure(terrainKindIndex)
  if (weak.checksum !== strongLru.checksum) throw new Error('Benchmark implementations disagree.')
  console.log(JSON.stringify({
    node: process.version,
    terrainCellsPerRevision: 14_000,
    revisions: terrains.length,
    collection: 'two forced Node GC cycles between trials; not a mobile WebView measurement',
    weakRefOriginal: weak,
    strongLru,
    approximateRetainedIndexMiB: retainedIndexMiB,
  }, null, 2))
} finally {
  await server.close()
}
