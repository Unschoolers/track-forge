// Profile an imported Track Forge JSON file through decode, geometry, terrain
// presentation compilation, and representative editor mutations.
// Run: node qa/perf/track-profile.mjs path/to/track.trackforge.json
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const inputPath = process.argv[2]
if (!inputPath || inputPath === '--help') {
  console.error('Usage: node qa/perf/track-profile.mjs <track-json-path>')
  process.exit(inputPath === '--help' ? 0 : 2)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
})

const elapsed = action => {
  const start = performance.now()
  const value = action()
  return { value, ms: Number((performance.now() - start).toFixed(3)) }
}

try {
  const [{ decodeTrack }, { TrackGeometryService }, { compileTerrainPresentation }, { createEditorState, applyEditorCommand }] = await Promise.all([
    server.ssrLoadModule('/src/domain/track/trackCodec.ts'),
    server.ssrLoadModule('/src/domain/track/trackGeometryService.ts'),
    server.ssrLoadModule('/src/phaser/rendering/terrainMesh.ts'),
    server.ssrLoadModule('/src/domain/editor/editorState.ts'),
  ])

  const rawText = await readFile(resolve(inputPath), 'utf8')
  const parse = elapsed(() => JSON.parse(rawText))
  const raw = parse.value
  const payload = raw?.track ?? raw
  const decode = elapsed(() => decodeTrack(payload, Date.now()))
  const track = decode.value
  if (!track) throw new Error('The input did not decode as a valid Track Forge track.')

  const geometry = elapsed(() => new TrackGeometryService().get(track))
  const service = new TrackGeometryService()
  service.get(track)
  const geometryWarm = elapsed(() => service.get(track))
  const terrainSurface = geometry.value.path.terrainSurface
  const terrainFull = elapsed(() => compileTerrainPresentation(terrainSurface, 'full'))
  const terrainOverview = elapsed(() => compileTerrainPresentation(terrainSurface, 'overview'))

  const terrainCells = track.terrain.cells.slice(0, 16).map(({ column, row }) => ({ column, row }))
  const firstKind = track.terrain.cells[0]?.kind
  const paintKind = firstKind === 'water' ? 'hill' : 'water'
  const editorState = createEditorState(track.points, track.trees, track.start, track.terrain, track)
  const terrainEdit = elapsed(() => applyEditorCommand(editorState, {
    type: 'paint-terrain', cells: terrainCells, kind: paintKind,
  }))
  if (terrainEdit.value.rejection || terrainEdit.value.state.terrain === track.terrain) {
    throw new Error(`Terrain paint did not apply: ${terrainEdit.value.rejection ?? 'terrain unchanged'}`)
  }
  const editedTrack = { ...track, terrain: terrainEdit.value.state.terrain }
  const postTerrainEditGeometry = elapsed(() => new TrackGeometryService().get(editedTrack))

  const pointIndex = Math.floor(track.points.length / 2)
  const pointMoveSearch = findValidPointMove(track, editorState, applyEditorCommand, pointIndex)
  const pointMove = pointMoveSearch.move
  if (!pointMove && track.points.length >= 2) {
    throw new Error(`Point move did not apply: ${pointMoveSearch.reason}`)
  }
  const pointEdit = pointMove
    ? elapsed(() => applyEditorCommand(editorState, pointMove.command))
    : null
  if (pointEdit && (pointEdit.value.rejection ||
      (pointEdit.value.state.points[pointMove.index]?.x === pointMove.original.x &&
       pointEdit.value.state.points[pointMove.index]?.y === pointMove.original.y))) {
    const reason = pointEdit.value.rejection?.message ?? 'point unchanged'
    throw new Error(`Point move did not apply: ${reason}`)
  }
  const postPointEditGeometry = pointEdit
    ? elapsed(() => new TrackGeometryService().get({ ...track, points: pointEdit.value.state.points }))
    : null

  const ms = value => value === null ? null : value.ms
  console.log(JSON.stringify({
    input: resolve(inputPath),
    bytes: Buffer.byteLength(rawText),
    track: {
      id: track.id, name: track.name, pointCount: track.points.length,
      terrainCellCount: track.terrain.cells.length, treeCount: track.trees.length,
      sceneryCount: track.scenery.length, routeKind: track.routeKind,
    },
    timingsMs: {
      jsonParse: parse.ms,
      decodeTrack: decode.ms,
      geometryCold: geometry.ms,
      geometryWarmCacheLookup: geometryWarm.ms,
      terrainPresentationFull: terrainFull.ms,
      terrainPresentationOverview: terrainOverview.ms,
      editorTerrainPaint16Cells: terrainEdit.ms,
      terrainCellsAfterPaint: terrainEdit.value.state.terrain.cells.length,
      geometryAfterTerrainPaint: postTerrainEditGeometry.ms,
      editorMoveOnePoint: ms(pointEdit),
      pointCoordinateChanged: pointEdit !== null && pointMove !== null,
      geometryAfterPointMove: ms(postPointEditGeometry),
    },
    terrainPresentation: {
      full: terrainFull.value.stats,
      overview: terrainOverview.value.stats,
    },
    notes: [
      'Single-process Node/Vite SSR timings; startup/module loading is excluded.',
      'Cold geometry uses a fresh service; warm geometry uses the same service and exact track object.',
      'Editor mutations are domain commands; rendering, browser layout, GPU work, and touch sampling are excluded.',
    ],
  }, null, 2))
} finally {
  await server.close()
}

function findValidPointMove(track, editorState, applyCommand, preferredIndex) {
  const count = track.points.length
  if (count < 2) return { move: null, reason: 'the track has fewer than two points.' }
  const isCircuit = track.routeKind === 'circuit'
  const indices = [...new Set([
    preferredIndex, 1, count - 2, 0, count - 1,
    preferredIndex - 1, preferredIndex + 1,
  ].filter(index => index >= 0 && index < count))]
  const fractions = [0.0001, 0.001, 0.01, 0.1, 0.5, 1]
  let lastRejection
  let attempts = 0
  const maximumAttempts = 128

  for (const index of indices) {
    const point = track.points[index]
    if (!point) continue
    const previous = index > 0 ? track.points[index - 1] : isCircuit ? track.points[count - 1] : undefined
    const next = index + 1 < count ? track.points[index + 1] : isCircuit ? track.points[0] : undefined
    const targets = [previous, next].filter(Boolean)
    if (previous && next) targets.unshift({ x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 })

    for (const target of targets) {
      if (!target) continue
      for (const fraction of fractions) {
        if (attempts >= maximumAttempts) break
        const candidate = {
          x: point.x + (target.x - point.x) * fraction,
          y: point.y + (target.y - point.y) * fraction,
        }
        if (candidate.x === point.x && candidate.y === point.y) continue
        const command = { type: 'move-point', index, point: candidate }
        attempts += 1
        const result = applyCommand(editorState, command)
        const moved = result.state.points[index]
        if (!result.rejection && moved && (moved.x !== point.x || moved.y !== point.y)) {
          return { move: { command, index, original: point }, reason: '' }
        }
        if (result.rejection) lastRejection = result.rejection.message
      }
      if (attempts >= maximumAttempts) break
    }
    if (attempts >= maximumAttempts) break
  }
  return {
    move: null,
    reason: lastRejection ?? 'no candidate changed a point coordinate.',
  }
}
