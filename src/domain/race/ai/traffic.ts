import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'

// Vehicle contacts use an 18-unit center-to-center radius. Leave a little
// extra room for steering and discrete time steps without treating adjacent
// grid lanes (40 units apart) as an obstruction.
const TRAFFIC_CLEARANCE = 20
const ROAD_SAMPLE_MARGIN = 6
const LEVEL_COMPATIBILITY = WORLD_ELEVATION.levelHeight / 2

export interface TrafficObservation {
  readonly vehicle: RaceVehicle
  readonly signedDistance: number
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
      ? ((reversed
          ? vehicle.pathIndex - other.pathIndex
          : other.pathIndex - vehicle.pathIndex) +
          path) %
          path
      : Number.POSITIVE_INFINITY
  }
  const length = path.totalLength
  if (length <= 0) return Number.POSITIVE_INFINITY
  const vehicleDistance = path.points[vehicle.pathIndex]?.distance ?? 0
  const otherDistance = path.points[other.pathIndex]?.distance ?? 0
  // Traffic measures the physical gap, independent of the relocated lap line.
  const direct = (otherDistance - vehicleDistance) * (reversed ? -1 : 1)
  if (direct === 0 && vehicle.pathIndex === other.pathIndex) {
    const count = path.points.length
    const indexAt = (index: number) =>
      path.closed
        ? (index + count) % count
        : Math.max(0, Math.min(count - 1, index))
    const before = path.points[indexAt(vehicle.pathIndex - 1)]
    const after = path.points[indexAt(vehicle.pathIndex + 1)]
    if (before && after) {
      const dx = after.x - before.x
      const dy = after.y - before.y
      const tangentLength = Math.hypot(dx, dy)
      if (tangentLength > 0) {
        const projection =
          (((other.x - vehicle.x) * dx + (other.y - vehicle.y) * dy) /
            tangentLength) *
          (reversed ? -1 : 1)
        // Preserve the local signed gap, including side-by-side overlap.
        return projection
      }
    }
  }
  return path.closed && direct < 0 ? direct + length : direct
}

function sharesRoad(
  vehicle: RaceVehicle,
  other: RaceVehicle,
  path: RoadPath,
): boolean {
  const point = path.points[vehicle.pathIndex]
  const otherPoint = path.points[other.pathIndex]
  if (!point || !otherPoint) return false
  const roadLimit = ROAD_GEOMETRY.onRoadRadius + ROAD_SAMPLE_MARGIN
  if (
    Math.hypot(vehicle.x - point.x, vehicle.y - point.y) > roadLimit ||
    Math.hypot(other.x - otherPoint.x, other.y - otherPoint.y) > roadLimit
  )
    return false

  // Compare height above the local road, so cars on the same ramp remain
  // relevant even when the road rises between their sampled positions.
  if (Math.abs(other.z - vehicle.z) > LEVEL_COMPATIBILITY) {
    const roadHeight = path.roadSurface.at(vehicle.pathIndex, vehicle).height
    const otherRoadHeight = path.roadSurface.at(other.pathIndex, other).height
    if (
      Math.abs(other.z - otherRoadHeight - (vehicle.z - roadHeight)) >
      LEVEL_COMPATIBILITY
    )
      return false
  }

  return !path.crossings.some((crossing) => {
    const differentArms =
      (point.segment === crossing.firstSegment &&
        otherPoint.segment === crossing.secondSegment) ||
      (point.segment === crossing.secondSegment &&
        otherPoint.segment === crossing.firstSegment)
    if (!differentArms) return false
    const radius = crossing.bridgeHalfLength + ROAD_GEOMETRY.onRoadRadius
    return (
      Math.hypot(
        vehicle.x - crossing.position.x,
        vehicle.y - crossing.position.y,
      ) <= radius &&
      Math.hypot(
        other.x - crossing.position.x,
        other.y - crossing.position.y,
      ) <= radius
    )
  })
}

export function getTrafficState(
  vehicle: RaceVehicle,
  others: readonly RaceVehicle[],
  path: RoadPath | number,
  reversed = false,
): TrafficState {
  const nearby = others
    .filter(
      (other) =>
        other.id !== vehicle.id &&
        !other.wrecked &&
        other.finishedAt === null &&
        (typeof path === 'number' || sharesRoad(vehicle, other, path)),
    )
    .map((other) => {
      const distance = forwardDistance(vehicle, other, path, reversed)
      const relativeSpeed = Math.max(0, vehicle.speed - other.speed)
      const length = typeof path === 'number' ? path : path.totalLength
      const closed = typeof path === 'number' || path.closed
      const signedDistance = closed && distance > length / 2 ? distance - length : distance
      return {
        signedDistance,
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
    .filter(
      (observation) =>
        typeof path !== 'number' || observation.distance > 0,
    )
    .sort((left, right) => left.distance - right.distance)
  return {
    ahead:
      nearby.find((observation) => observation.signedDistance >= 0 && observation.laneGap <= TRAFFIC_CLEARANCE) ??
      null,
    nearby,
  }
}
