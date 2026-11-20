import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { asTrackId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { reachedRecoveryCheckpoint } from '@/domain/race/recoveryCheckpoints'
import { updateOpenRouteProgress } from '@/domain/race/progress'
import { buildRoadPath, type RoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'

const terrain = createStarterTrack(asTrackId('diagonal-checkpoints'), 1).terrain

function diagonalPath(slope: number): RoadPath {
  return buildRoadPath([
    { x: 0, y: 0, surface: 'street' },
    { x: 800, y: 800 * slope, surface: 'street' },
  ], terrain, undefined, 'point-to-point')
}

function crossing(path: RoadPath, index: number, lateralOffset: number) {
  const lower = Math.min(path.points.length - 2, Math.floor(index))
  const a = path.points[lower]!
  const b = path.points[lower + 1]!
  const fraction = index - lower
  const gx = a.x + (b.x - a.x) * fraction
  const gy = a.y + (b.y - a.y) * fraction
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const tx = (b.x - a.x) / length
  const ty = (b.y - a.y) / length
  return {
    before: { x: gx - tx * 8 - ty * lateralOffset, y: gy - ty * 8 + tx * lateralOffset, pathIndex: lower },
    after: { x: gx + tx * 8 - ty * lateralOffset, y: gy + ty * 8 + tx * lateralOffset, pathIndex: lower + 1 },
  }
}

describe('diagonal checkpoint crossing', () => {
  it.each([1, -1])('accepts the painted timing gate when the edge changes on-road classification (slope %s)', slope => {
    const path = diagonalPath(slope)
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const player = race.vehicles[0]!
    const gate = (path.points.length - 1) / 4
    const { before, after } = crossing(path, gate, 28)
    const result = updateOpenRouteProgress(
      { ...player, ...before }, { ...player, ...after },
      path, after.pathIndex, 12, false, true, ROAD_GEOMETRY.onRoadRadius,
    )
    expect(result.nextSector).toBe(2)

    const outside = crossing(path, gate, ROAD_GEOMETRY.checkpointHalfWidth + 6)
    const bypass = updateOpenRouteProgress(
      { ...player, ...outside.before }, { ...player, ...outside.after },
      path, outside.after.pathIndex, 12, false, true, ROAD_GEOMETRY.onRoadRadius,
    )
    expect(bypass.nextSector).toBe(1)
    const backwards = updateOpenRouteProgress(
      { ...player, ...after }, { ...player, ...before },
      path, before.pathIndex, 12, false, false, ROAD_GEOMETRY.onRoadRadius,
    )
    expect(backwards.nextSector).toBe(1)
  })

  it.each([1, -1])('records a diagonal recovery checkpoint with a valid swept crossing (slope %s)', slope => {
    const path = diagonalPath(slope)
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const player = race.vehicles[0]!
    const index = Math.floor((path.points.length - 1) * 0.15)
    const { before, after } = crossing(path, index, 28)
    const course = {
      path, routeKind: 'point-to-point' as const, startPathIndex: 0, reversed: false,
      recoveryCheckpoints: [index],
    }
    expect(reachedRecoveryCheckpoint(
      course, { ...player, ...before, nextSector: 2 }, { ...player, ...after, nextSector: 2 }, false,
    )).toBe(index)

    const outside = crossing(path, index, ROAD_GEOMETRY.checkpointHalfWidth + 6)
    expect(reachedRecoveryCheckpoint(
      course, { ...player, ...outside.before, nextSector: 2 },
      { ...player, ...outside.after, nextSector: 2 }, false,
    )).toBeNull()
  })
  it('does not award a painted overpass gate to a car passing beneath it', () => {
    const base = diagonalPath(1)
    const road = base.roadSurface
    const bridge = {
      ...base,
      roadSurface: {
        ...road,
        at: (index: number, position?: { x: number; y: number }) => ({
          ...road.at(index, position),
          height: 24,
          structureHeight: 24,
        }),
      },
    }
    const race = createRace({ path: base, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const player = race.vehicles[0]!
    const gate = (base.points.length - 1) / 4
    const { before, after } = crossing(base, gate, 0)
    const under = updateOpenRouteProgress(
      { ...player, ...before, z: 0 }, { ...player, ...after, z: 0 },
      bridge, after.pathIndex, 12, false, false, ROAD_GEOMETRY.onRoadRadius,
    )
    expect(under.nextSector).toBe(1)
    const over = updateOpenRouteProgress(
      { ...player, ...before, z: 24 }, { ...player, ...after, z: 24 },
      bridge, after.pathIndex, 12, false, false, ROAD_GEOMETRY.onRoadRadius,
    )
    expect(over.nextSector).toBe(2)
  })

})
