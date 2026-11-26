import { asTrackId, type RoadStructure, type SurfaceId, type TerrainCell, type TerrainKind, type Track, type TrackPoint } from '@/domain/model'
import type { SceneryPropKind, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { normalizeTerrain, terrainKindAt } from '@/domain/terrain/terrainField'
import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { TRACK_FORGE_CREATOR } from '@/domain/track/trackCreator'

type Control = readonly [x: number, y: number, surface?: SurfaceId, structure?: RoadStructure]
// Terrain and landmarks use the same authoring coordinates as the road.
type Landform = readonly [kind: TerrainKind, x: number, y: number, radiusX: number, radiusY: number]
type Landmark = readonly [kind: SceneryPropKind, x: number, y: number]

interface CircuitDesign {
  readonly id: string
  readonly name: string
  readonly environment: TrackEnvironmentId
  readonly scale: number
  readonly controls: readonly Control[]
  readonly props: readonly SceneryPropKind[]
  readonly landforms: readonly Landform[]
  readonly landmarks: readonly Landmark[]
  readonly groves?: readonly (readonly [x: number, y: number])[]
}

/** Paint bounded, gently irregular silhouettes onto the canonical terrain grid.
 * No runtime random placement or new renderer is needed. */
function buildLandscape(landforms: readonly Landform[], scale: number) {
  const { cellSize } = WORLD_ELEVATION
  const cells: TerrainCell[] = []
  for (const [kind, x, y, radiusX, radiusY] of landforms) {
    const cx = x * scale, cy = y * scale
    const rx = radiusX * scale, ry = radiusY * scale
    for (let row = Math.floor((cy - ry * 1.1) / cellSize); row <= Math.floor((cy + ry * 1.1) / cellSize); row++) {
      for (let column = Math.floor((cx - rx * 1.1) / cellSize); column <= Math.floor((cx + rx * 1.1) / cellSize); column++) {
        const dx = ((column + 0.5) * cellSize - cx) / rx
        const dy = ((row + 0.5) * cellSize - cy) / ry
        const angle = Math.atan2(dy, dx)
        const radius = 1 + 0.035 * Math.sin(angle * 3) + 0.025 * Math.cos(angle * 5)
        if (Math.hypot(dx, dy) <= radius) cells.push({ column, row, kind })
      }
    }
  }
  return normalizeTerrain({ cells })
}

/** Explicitly authored silhouettes. The final control repeats the first. */
function officialTrack(design: CircuitDesign): Track {
  const { id, name, environment, controls, scale, props, landforms, landmarks } = design
  const points: TrackPoint[] = controls.map(([x, y, surface, structure], index) => ({
    id: `${id}-${index}`, x: Math.round(x * scale), y: Math.round(y * scale),
    surface: surface ?? 'street', curve: 'smooth', tension: 0.5,
    structure: structure ?? 'surface',
  }))
  const terrain = buildLandscape(landforms, scale)
  const path = buildRoadPath(points, terrain)
  const clearOfRoad = (position: { x: number; y: number }) => {
    const nearest = nearestPathPoint(path, position)
    return nearest !== undefined && nearest.distance >= ROAD_GEOMETRY.edgeWidth / 2 + 85 &&
      terrainKindAt(terrain, position) !== 'water'
  }
  const uniqueCount = points.length - 1
  // Scatter biome-specific props on the verge, never across a nearby road arm.
  const scenery = props.flatMap((kind, index) => {
    const vertex = Math.floor((index + 0.5) * uniqueCount / props.length) % uniqueCount
    const point = points[vertex]!
    const before = points[(vertex + uniqueCount - 1) % uniqueCount]!
    const after = points[(vertex + 1) % uniqueCount]!
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy)
    if (!length) return []
    const offset = ROAD_GEOMETRY.edgeWidth / 2 + 120 + (index % 3) * 40
    const candidate = { kind, x: Math.round(point.x + dy / length * offset),
      y: Math.round(point.y - dx / length * offset) }
    return clearOfRoad(candidate) ? [candidate] : []
  })
  for (const [kind, x, y] of landmarks) {
    const candidate = { kind, x: Math.round(x * scale), y: Math.round(y * scale) }
    if (clearOfRoad(candidate)) scenery.push(candidate)
  }
  const trees = (design.groves ?? []).map(([x, y]) => ({ x: Math.round(x * scale), y: Math.round(y * scale) })).filter(clearOfRoad)
  return {
    id: asTrackId(id), name, version: 8, points, environmentId: environment,
    terrain, trees, scenery,
    recoveryCheckpoints: [0.25, 0.5, 0.75],
    autoCheckpoints: true, start: { ratio: 0, reversed: false },
    lighting: 'day', routeKind: 'circuit', createdAt: 0, updatedAt: 0,
    origin: 'seeded', creator: TRACK_FORGE_CREATOR,
  }
}

export const OFFICIAL_CIRCUITS = [
  {
    // Long city boulevard, offset block and a sequence of right-angle bends.
    track: officialTrack({
      id: 'official-harbor-grid', name: 'Harbor Grid', environment: 'cityscape', scale: 16,
      controls: [
        [-15, -48], [30, -48], [63, -35], [70, -10], [58, 13],
        [22, 13], [8, 27], [22, 48], [57, 48], [65, 68],
        [43, 84, 'street', 'overpass'], [-57, 84], [-80, 63], [-80, -23], [-65, -48], [-15, -48],
      ],
      props: ['city-building', 'city-bus-stop', 'city-house', 'city-trash-bin',
        'city-building', 'city-house', 'city-bus-stop', 'city-building',
        'city-house', 'city-trash-bin', 'city-building', 'city-house'],
      // Canal along the waterfront; the southern boulevard crosses on a bridge.
      landforms: [['water', -6, 94, 10, 35]],
      landmarks: [['city-building', -53, -23], ['city-building', -28, -23],
        ['city-house', -48, 12], ['city-house', -24, 12], ['city-bus-stop', 14, -32],
        ['city-building', -40, 55], ['city-building', 33, 65], ['city-trash-bin', 31, -15]],
    }),
    target: 30,
  },
  {
    // Extended off-road sweeps and a wide rally switchback; mixed grip.
    track: officialTrack({
      id: 'official-canyon-run', name: 'Canyon Run', environment: 'desert', scale: 15,
      controls: [
        [-94, -26], [-61, -28, 'dirt'], [-26, -5, 'dirt'], [14, 4, 'dirt'],
        [54, -24, 'dirt'], [110, -32], [136, -10], [136, 19], [106, 39],
        [62, 42, 'dirt'], [22, 62, 'dirt'], [-19, 62, 'dirt'],
        [-51, 34], [-102, 25], [-131, 12], [-140, -9], [-125, -24], [-94, -26],
      ],
      props: ['desert-cactus', 'desert-boulder', 'desert-rock-spire', 'desert-rock-cluster',
        'desert-cactus', 'desert-boulder', 'desert-rock-spire', 'desert-cactus',
        'desert-rock-cluster', 'desert-boulder', 'desert-cactus', 'desert-rock-spire'],
      // Mesa ridge, dirt-road climb and a sheltered oasis inside the circuit.
      landforms: [['hill', 88, -55, 36, 19], ['hill', -105, 53, 34, 20],
        ['hill', 36, -11, 19, 14], ['hill', 100, 65, 27, 15], ['water', -5, 34, 16, 10]],
      landmarks: [['desert-rock-spire', 80, -55], ['desert-rock-cluster', 110, -53],
        ['desert-cactus', -24, 32], ['desert-cactus', 14, 38], ['desert-boulder', -104, 52],
        ['desert-rock-spire', 102, 66], ['desert-cactus', -55, 9]],
    }),
    target: 30,
  },
  {
    // Four actual rounded leaves with deep, non-intersecting inward notches.
    // The four interior islands each have a distinct toy-room landmark.
    track: officialTrack({
      id: 'official-playroom-clover', name: 'Playroom Clover', environment: 'kids-room', scale: 15,
      controls: [
        [-26, -60], [0, -27], [26, -60], [53, -69], [69, -53],
        [60, -26], [27, 0], [60, 26], [69, 53], [53, 69],
        [26, 60], [0, 27], [-26, 60], [-53, 69], [-69, 53],
        [-60, 26], [-27, 0], [-60, -26], [-69, -53], [-53, -69], [-26, -60],
      ],
      props: ['kids-blocks', 'kids-teddy', 'kids-dinosaur', 'kids-book',
        'kids-crayons', 'kids-top', 'kids-blocks', 'kids-teddy',
        'kids-book', 'kids-dinosaur', 'kids-top', 'kids-crayons'],
      landforms: [['hill', 40, -40, 13, 11], ['hill', -40, 40, 13, 12],
        ['water', 39, 39, 8, 7]],
      landmarks: [['kids-teddy', -41, -41], ['kids-blocks', -34, -33],
        ['kids-book', 40, -40], ['kids-crayons', 29, -30],
        ['kids-dinosaur', -40, 40], ['kids-top', -28, 31],
        ['kids-blocks', 28, 31], ['kids-crayons', 43, 24], ['kids-top', 0, 0]],
    }),
    target: 30,
  },
  {
    // Sweeping countryside circuit with asymmetric bends and a broad downhill-shaped loop.
    track: officialTrack({
      id: 'official-greenway', name: 'Greenway GP', environment: 'grass', scale: 20,
      controls: [
        [-45, -40], [-18, -48], [36, -42], [78, -18], [82, 12],
        [52, 36, 'street', 'overpass'], [8, 42], [-9, 70], [-45, 78], [-82, 55],
        [-94, 24], [-89, -9], [-72, -31], [-45, -40],
      ],
      props: ['grass-shrub', 'grass-wildflowers', 'grass-boulder', 'grass-log',
        'grass-wildflowers', 'grass-shrub', 'grass-boulder', 'grass-wildflowers',
        'grass-log', 'grass-shrub', 'grass-wildflowers', 'grass-boulder'],
      // Woodland, rolling slopes and the lake bridge on the east side.
      landforms: [['hill', -80, 36, 22, 27], ['hill', 84, -30, 20, 17],
        ['hill', -10, -15, 20, 15], ['water', 30, 40, 10, 17]],
      landmarks: [['grass-wildflowers', -32, 12], ['grass-boulder', -78, 34],
        ['grass-log', -60, 23], ['grass-shrub', 22, 15], ['grass-wildflowers', 45, 18]],
      groves: [[-106, -44], [-97, -56], [-82, -58], [-64, -65], [-46, -60],
        [-108, 2], [-105, 15], [-108, 42], [-97, 68], [-72, 88], [-49, 94], [-21, 91],
        [88, 42], [97, 28], [83, -42], [68, -56], [41, -57], [-39, 25], [-27, 40], [-48, 45]],
    }),
    target: 30,
  },
] as const

// Provisional single-lap Arcade targets; recalibrate with 60 Hz physical runs.
export const OFFICIAL_TIME_TARGETS = [
  { gold: 27, silver: 32, bronze: 38 },
  { gold: 27, silver: 32, bronze: 38 },
  { gold: 27, silver: 32, bronze: 38 },
  { gold: 27, silver: 32, bronze: 38 },
] as const
