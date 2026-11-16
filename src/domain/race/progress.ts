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
  if (!crossesRoadGate(path, previous, result, last * gate / 4, roadRadius)) return result
  return gate === 4
    ? { ...result, lap: previous.lap + 1, finishedAt: elapsed }
    : { ...result, nextSector: (gate + 1) as 2 | 3 | 4 }
}

/** A forward crossing must stay on the route near this gate, even at crossings. */
export function crossesRoadGate(
  path: RoadPath,
  previous: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'>,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'>,
  gatePosition: number,
  roadRadius: number,
  reversed = false,
): boolean {
  const count = path.points.length
  const sampleDistance = (index: number): number => {
    const distance = Math.abs(index - gatePosition)
    return path.closed ? Math.min(distance, count - distance) : distance
  }
  if (sampleDistance(previous.pathIndex) > 12 || sampleDistance(vehicle.pathIndex) > 12) return false
  const lower = Math.min(path.closed ? count - 1 : count - 2, Math.floor(gatePosition))
  const a = path.points[lower]
  const b = path.points[(lower + 1) % count]
  if (!a || !b) return false
  const fraction = gatePosition - lower
  const gx = a.x + (b.x - a.x) * fraction
  const gy = a.y + (b.y - a.y) * fraction
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 0.001) return false
  const direction = reversed ? -1 : 1
  const tx = direction * (b.x - a.x) / length
  const ty = direction * (b.y - a.y) / length
  const before = (previous.x - gx) * tx + (previous.y - gy) * ty
  const after = (vehicle.x - gx) * tx + (vehicle.y - gy) * ty
  if (before >= 0 || after < 0 || after <= before) return false
  const t = -before / (after - before)
  const x = previous.x + (vehicle.x - previous.x) * t - gx
  const y = previous.y + (vehicle.y - previous.y) * t - gy
  return Math.abs(-x * ty + y * tx) <= roadRadius
}
