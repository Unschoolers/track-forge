import { asTrackId, type SurfaceId, type Track, type TrackPoint } from '@/domain/model'
import type { SceneryPropKind, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { ROAD_GEOMETRY } from '@/domain/config'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { TRACK_FORGE_CREATOR } from '@/domain/track/trackCreator'

type Control = readonly [x: number, y: number, surface?: SurfaceId]

interface CircuitDesign {
  readonly id: string
  readonly name: string
  readonly environment: TrackEnvironmentId
  readonly scale: number
  readonly controls: readonly Control[]
  readonly props: readonly SceneryPropKind[]
}

/** Explicitly authored silhouettes, with the start halfway along a straight.
 * The final control repeats the first; all four are simple closed circuits. */
function officialTrack(design: CircuitDesign): Track {
  const { id, name, environment, controls, scale, props } = design
  const points: TrackPoint[] = controls.map(([x, y, surface], index) => ({
    id: `${id}-${index}`, x: Math.round(x * scale), y: Math.round(y * scale),
    surface: surface ?? 'street', curve: 'smooth', tension: 0.5,
  }))
  const path = buildRoadPath(points, EMPTY_TERRAIN)
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
    const nearest = nearestPathPoint(path, candidate)
    return nearest && nearest.distance >= ROAD_GEOMETRY.edgeWidth / 2 + 85 ? [candidate] : []
  })
  return {
    id: asTrackId(id), name, version: 8, points, environmentId: environment,
    terrain: EMPTY_TERRAIN, trees: [], scenery,
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
        [43, 84], [-57, 84], [-80, 63], [-80, -23], [-65, -48], [-15, -48],
      ],
      props: ['city-building', 'city-bus-stop', 'city-house', 'city-trash-bin',
        'city-building', 'city-house', 'city-bus-stop', 'city-building',
        'city-house', 'city-trash-bin', 'city-building', 'city-house'],
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
    }),
    target: 30,
  },
  {
    // Three lobes around a central toy island; linked alternating bends.
    track: officialTrack({
      id: 'official-playroom-clover', name: 'Playroom Clover', environment: 'kids-room', scale: 17,
      controls: [
        [-3, -72], [32, -72], [57, -51], [49, -23], [23, -7],
        [50, 12], [69, 41], [53, 68], [20, 72], [-1, 51],
        [-24, 73], [-61, 68], [-81, 37], [-70, 8], [-40, -7],
        [-62, -30], [-63, -54], [-38, -72], [-3, -72],
      ],
      props: ['kids-blocks', 'kids-teddy', 'kids-dinosaur', 'kids-book',
        'kids-crayons', 'kids-top', 'kids-blocks', 'kids-teddy',
        'kids-book', 'kids-dinosaur', 'kids-top', 'kids-crayons'],
    }),
    target: 30,
  },
  {
    // Sweeping countryside circuit with asymmetric bends and a broad downhill-shaped loop.
    track: officialTrack({
      id: 'official-greenway', name: 'Greenway GP', environment: 'grass', scale: 20,
      controls: [
        [-45, -40], [-18, -48], [36, -42], [78, -18], [82, 12],
        [52, 36], [8, 42], [-9, 70], [-45, 78], [-82, 55],
        [-94, 24], [-89, -9], [-72, -31], [-45, -40],
      ],
      props: ['grass-shrub', 'grass-wildflowers', 'grass-boulder', 'grass-log',
        'grass-wildflowers', 'grass-shrub', 'grass-boulder', 'grass-wildflowers',
        'grass-log', 'grass-shrub', 'grass-wildflowers', 'grass-boulder'],
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
