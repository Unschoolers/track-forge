import type { RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'

export interface TrafficObservation {
  readonly vehicle: RaceVehicle
  readonly distance: number
  readonly laneGap: number
  readonly relativeSpeed: number
  readonly timeToCollision: number
}

export interface TrafficState {
  readonly ahead: TrafficObservation | null
  readonly nearby: readonly TrafficObservation[]
}

function forwardDistance(
  vehicle: RaceVehicle,
  other: RaceVehicle,
  path: RoadPath | number,
  reversed: boolean,
): number {
  if (typeof path === 'number') {
    return path > 0
      ? ((reversed ? vehicle.pathIndex - other.pathIndex : other.pathIndex - vehicle.pathIndex) + path) % path
      : Number.POSITIVE_INFINITY
  }
  const length = path.totalLength
  if (length <= 0) return Number.POSITIVE_INFINITY
  const vehicleDistance = path.points[vehicle.pathIndex]?.distance ?? 0
  const otherDistance = path.points[other.pathIndex]?.distance ?? 0
  // Traffic measures the physical gap, independent of the relocated lap line.
  const direct = (otherDistance - vehicleDistance) * (reversed ? -1 : 1)
  return direct > 0 ? direct : direct + length
}

export function getTrafficState(
  vehicle: RaceVehicle,
  others: readonly RaceVehicle[],
  path: RoadPath | number,
  reversed = false,
): TrafficState {
  const nearby = others
    .filter((other) => other.id !== vehicle.id && !other.wrecked)
    .map((other) => {
      const distance = forwardDistance(vehicle, other, path, reversed)
      const relativeSpeed = Math.max(0, vehicle.speed - other.speed)
      return {
        vehicle: other,
        distance,
        laneGap: Math.abs(other.lane - vehicle.lane),
        relativeSpeed,
        timeToCollision:
          relativeSpeed > 0
            ? distance / relativeSpeed
            : Number.POSITIVE_INFINITY,
      }
    })
    .filter((observation) => observation.distance > 0)
    .sort((left, right) => left.distance - right.distance)
  return { ahead: nearby[0] ?? null, nearby }
}
