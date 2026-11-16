import type { RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'

export function updateProgress(
  vehicle: RaceVehicle,
  nextPathIndex: number,
  pathLength: number,
  elapsed: number,
  totalLaps: number,
  startPathIndex = 0,
  reversed = false,
): RaceVehicle {
  if (pathLength <= 0 || vehicle.finishedAt !== null) return vehicle
  const directed = (index: number): number => {
    const value = reversed
      ? startPathIndex - index
      : index - startPathIndex
    return ((value % pathLength) + pathLength) % pathLength
  }
  const previous = directed(vehicle.pathIndex)
  const next = directed(nextPathIndex)
  const travel = (next - previous + pathLength) % pathLength
  if (travel > pathLength / 2) {
    return { ...vehicle, pathIndex: nextPathIndex }
  }
  const crossed = (gate: number): boolean => {
    const distance = (gate - previous + pathLength) % pathLength
    return distance > 0 && distance <= travel
  }
  let nextSector = vehicle.nextSector
  for (const sector of [1, 2, 3] as const) {
    if (
      nextSector === sector &&
      crossed((pathLength * sector) / 4)
    ) {
      nextSector = (sector + 1) as 2 | 3 | 4
    }
  }
  const crossedStart = next < previous && travel > 0
  const completedLap = crossedStart && nextSector === 4
  const lap = vehicle.lap + (completedLap ? 1 : 0)
  if (crossedStart) nextSector = 1
  return {
    ...vehicle,
    pathIndex: nextPathIndex,
    lap,
    nextSector,
    finishedAt: lap >= totalLaps ? elapsed : null,
  }
}

export function lastSampleBeforeCheckpoint(path: RoadPath, checkpoint: RaceVehicle['nextSector']): number {
  return Math.max(0, Math.ceil((path.points.length - 1) * checkpoint / 4) - 1)
}

export function passedPendingCheckpoint(path: RoadPath, vehicle: RaceVehicle): boolean {
  return vehicle.nextSector < 4 &&
    vehicle.pathIndex > lastSampleBeforeCheckpoint(path, vehicle.nextSector) + 2
}

/** Accept an open-route gate only when the driven segment crosses its road line. */
export function updateOpenRouteProgress(
  previous: RaceVehicle,
  vehicle: RaceVehicle,
  path: RoadPath,
  nextPathIndex: number,
  elapsed: number,
  onRoadBefore: boolean,
  onRoadAfter: boolean,
  roadRadius: number,
): RaceVehicle {
  const last = path.points.length - 1
  const index = Math.max(0, Math.min(last, nextPathIndex))
  const result = { ...vehicle, pathIndex: index }
  if (last < 1 || previous.finishedAt !== null || !onRoadBefore || !onRoadAfter) return result
  const gate = previous.nextSector
  const gatePosition = last * gate / 4
  const lower = Math.min(last - 1, Math.floor(gatePosition))
  const upper = lower + 1
  const a = path.points[lower]
  const b = path.points[upper]
  if (!a || !b) return result
  const fraction = gatePosition - lower
  const gx = a.x + (b.x - a.x) * fraction
  const gy = a.y + (b.y - a.y) * fraction
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 0.001 || Math.abs(previous.pathIndex - gatePosition) > 12 || Math.abs(index - gatePosition) > 12) return result
  const tx = (b.x - a.x) / length
  const ty = (b.y - a.y) / length
  const before = (previous.x - gx) * tx + (previous.y - gy) * ty
  const after = (vehicle.x - gx) * tx + (vehicle.y - gy) * ty
  if (before >= 0 || after < 0 || after <= before) return result
  const t = -before / (after - before)
  const x = previous.x + (vehicle.x - previous.x) * t - gx
  const y = previous.y + (vehicle.y - previous.y) * t - gy
  if (Math.abs(-x * ty + y * tx) > roadRadius) return result
  return gate === 4
    ? { ...result, lap: previous.lap + 1, finishedAt: elapsed }
    : { ...result, nextSector: (gate + 1) as 2 | 3 | 4 }
}
