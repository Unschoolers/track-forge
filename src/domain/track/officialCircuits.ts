import { asTrackId, type SurfaceId, type Track, type TrackPoint } from '@/domain/model'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { TRACK_FORGE_CREATOR } from '@/domain/track/trackCreator'

/** Three new, simple, crossing-free circuits. Authored checkpoints are the only timing gates. */
function officialTrack(
  id: string, name: string, environmentId: TrackEnvironmentId,
  radiusX: number, radiusY: number, wobble: number,
  scenery: readonly SceneryProp[], dirtIndices: readonly number[] = [],
): Track {
  // 24 equally spaced authored segments (plus their closing vertex) gives
  // two markers at the same ten-control-point cadence as the editor.
  const points: TrackPoint[] = Array.from({ length: 25 }, (_, index) => {
    const angle = index / 24 * Math.PI * 2
    const shape = 1 + wobble * Math.sin(angle * 3) + wobble * 0.4 * Math.cos(angle * 2)
    return {
      id: `${id}-${index}`,
      x: Math.round(Math.cos(angle) * radiusX * shape),
      y: Math.round(Math.sin(angle) * radiusY * shape),
      surface: (dirtIndices.includes(index) ? 'dirt' : 'street') as SurfaceId,
      curve: 'smooth',
      tension: 0.5,
    }
  })
  const path = buildRoadPath(points, EMPTY_TERRAIN)
  const recoveryCheckpoints = [9, 19].map(index => {
    const sample = nearestPathPoint(path, points[index]!)
    if (!sample || path.totalLength <= 0) throw new Error(`Invalid official checkpoint for ${id}`)
    return sample.point.distance / path.totalLength
  })
  return {
    ...createStarterTrack(asTrackId(id), 0),
    name,
    points,
    environmentId,
    trees: [],
    scenery,
    recoveryCheckpoints,
    autoCheckpoints: true,
    origin: 'seeded',
    creator: TRACK_FORGE_CREATOR,
  }
}

export const OFFICIAL_CIRCUITS = [
  {
    track: officialTrack('official-city-sprint', 'City Sprint', 'cityscape', 660, 410, 0.04, [
      { kind: 'city-bus-stop', x: 40, y: -80 },
      { kind: 'city-trash-bin', x: -160, y: 10 },
      { kind: 'city-house', x: 870, y: -120 },
      { kind: 'city-building', x: -920, y: 190 },
      { kind: 'city-trash-bin', x: 190, y: 80 },
    ]),
    target: 30,
  },
  {
    track: officialTrack('official-desert-sweep', 'Desert Sweep', 'desert', 720, 400, 0.045, [
      { kind: 'desert-cactus', x: -200, y: -20 },
      { kind: 'desert-boulder', x: 180, y: 60 },
      { kind: 'desert-rock-spire', x: -960, y: -110 },
      { kind: 'desert-rock-cluster', x: 910, y: 110 },
      { kind: 'desert-cactus', x: 20, y: 130 },
    ], [5, 6, 7, 8]),
    target: 30,
  },
  {
    track: officialTrack('official-toy-box', 'Toy Box Dash', 'kids-room', 640, 450, 0.055, [
      { kind: 'kids-blocks', x: -210, y: -25 },
      { kind: 'kids-teddy', x: 180, y: 30 },
      { kind: 'kids-dinosaur', x: 930, y: 20 },
      { kind: 'kids-book', x: 20, y: -95 },
      { kind: 'kids-crayons', x: -910, y: 75 },
      { kind: 'kids-top', x: 40, y: 120 },
    ]),
    target: 30,
  },
] as const

// Provisional single-lap Arcade targets; recalibrate with 60 Hz physical runs.
export const OFFICIAL_TIME_TARGETS = [
  { gold: 27, silver: 32, bronze: 38 },
  { gold: 27, silver: 32, bronze: 38 },
  { gold: 27, silver: 32, bronze: 38 },
] as const
