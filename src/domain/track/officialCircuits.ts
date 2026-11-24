import { asTrackId, type SurfaceId, type Track, type TrackPoint } from '@/domain/model'
import type { SceneryPropKind, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { ROAD_GEOMETRY } from '@/domain/config'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { TRACK_FORGE_CREATOR } from '@/domain/track/trackCreator'

/** Three new, simple, crossing-free circuits. Authored checkpoints are the only timing gates. */
function officialTrack(
  id: string, name: string, environmentId: TrackEnvironmentId,
  radiusX: number, radiusY: number, wobble: number,
  sceneryKinds: readonly SceneryPropKind[], dirtIndices: readonly number[] = [],
): Track {
  // Larger, forgiving bends yield about a 30-second Blue Arcade lap at 60 Hz.
  // Keep 24 authored segments and two checkpoint markers, as in the editor.
  const lapScale = 3.0
  const points: TrackPoint[] = Array.from({ length: 25 }, (_, index) => {
    const angle = index / 24 * Math.PI * 2
    const shape = 1 + wobble * Math.sin(angle * 3) + wobble * 0.4 * Math.cos(angle * 2)
    return {
      id: `${id}-${index}`,
      x: Math.round(Math.cos(angle) * radiusX * lapScale * shape),
      y: Math.round(Math.sin(angle) * radiusY * lapScale * shape),
      surface: (dirtIndices.includes(index) ? 'dirt' : 'street') as SurfaceId,
      curve: 'smooth',
      tension: 0.5,
    }
  })
  // Place scenery just outside the track rather than stranded at its centre
  // when the circuit is scaled for proper lap times.
  const scenery = sceneryKinds.map((kind, index) => {
    const vertex = Math.floor((index + 0.5) * 24 / sceneryKinds.length) % 24
    const point = points[vertex]!
    const before = points[(vertex + 23) % 24]!
    const after = points[(vertex + 1) % 24]!
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy)
    const offset = ROAD_GEOMETRY.edgeWidth / 2 + 100 + (index % 2) * 35
    return { kind, x: Math.round(point.x + dy / length * offset),
      y: Math.round(point.y - dx / length * offset) }
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
      'city-bus-stop',
      'city-trash-bin',
      'city-house',
      'city-building',
      'city-trash-bin',
    ]),
    target: 30,
  },
  {
    track: officialTrack('official-desert-sweep', 'Desert Sweep', 'desert', 720, 400, 0.045, [
      'desert-cactus',
      'desert-boulder',
      'desert-rock-spire',
      'desert-rock-cluster',
      'desert-cactus',
    ], [5, 6, 7, 8]),
    target: 30,
  },
  {
    track: officialTrack('official-toy-box', 'Toy Box Dash', 'kids-room', 640, 450, 0.055, [
      'kids-blocks',
      'kids-teddy',
      'kids-dinosaur',
      'kids-book',
      'kids-crayons',
      'kids-top',
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
