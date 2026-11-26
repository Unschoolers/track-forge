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
  const point = track.points[pointIndex]
  const pointEdit = point ? elapsed(() => applyEditorCommand(editorState, {
    type: 'move-point', index: pointIndex, point: { x: point.x + 1 },
  })) : null
  if (pointEdit && (pointEdit.value.rejection || pointEdit.value.state.points[pointIndex]?.x === point.x)) {
    throw new Error(`Point move did not apply: ${pointEdit.value.rejection ?? 'point unchanged'}`)
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
      pointCoordinateChanged: pointEdit !== null,
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
