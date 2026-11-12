import { clamp } from '@/domain/geometry/math'
import type { CarId } from '@/domain/model'
import {
  ARCADE_ASSIST_BRAKING,
  ARCADE_DYNAMICS_TUNING,
  CAR_PHYSICS_SPECS,
  SURFACE_PHYSICS_SPECS,
  VEHICLE_TERRAIN_PHYSICS_SPECS,
} from '@/domain/race/vehiclePhysicsConfig'
import type { RoadPath } from '@/domain/track/pathBuilder'

// RoadPath is compiled once and treated as immutable throughout a race. A
// weak key avoids retaining discarded tracks or rebuilding the envelope on
// every physics step. Each car and direction has different grip and grade.
const envelopes = new WeakMap<RoadPath, Map<string, readonly number[]>>()

function buildEnvelope(path: RoadPath, reversed: boolean, carId: CarId): readonly number[] {
  const count = path.points.length
  const car = CAR_PHYSICS_SPECS[carId]
  const forces = ARCADE_DYNAMICS_TUNING.forces
  const pointAt = (index: number) => {
    if (!path.closed && (index < 0 || index >= count)) return undefined
    return path.points[((index % count) + count) % count]
  }
  const curvature = path.points.map((point, index) => {
    const before = pointAt(index - 1)
    const after = pointAt(index + 1)
    if (!before || !after) return 0
    const a = Math.hypot(point.x - before.x, point.y - before.y)
    const b = Math.hypot(after.x - point.x, after.y - point.y)
    const c = Math.hypot(after.x - before.x, after.y - before.y)
    if (a < 0.001 || b < 0.001 || c < 0.001) return 0
    const cross = (point.x - before.x) * (after.y - before.y) - (point.y - before.y) * (after.x - before.x)
    return 2 * cross / (a * b * c)
  })
  const limits = path.points.map((point, index) => {
    // Smooth isolated resampling spikes without erasing a real tight bend.
    const previous = path.closed ? curvature[(index - 1 + count) % count] : curvature[index - 1]
    const next = path.closed ? curvature[(index + 1) % count] : curvature[index + 1]
    const bend = Math.abs(((previous ?? 0) + 2 * (curvature[index] ?? 0) + (next ?? 0)) / 4)
    if (bend < 0.00001) return Infinity
    const surface = SURFACE_PHYSICS_SPECS[point.surface]
    const terrain = VEHICLE_TERRAIN_PHYSICS_SPECS[carId][point.surface]
    const grip = car.grip * surface.grip * terrain.grip
    return forces.gravityAcceleration * forces.lateralGripScale * grip / bend
  })
  const direction = reversed ? -1 : 1
  // Assistance is proportional and ramps up gradually. Plan with half of
  // its maximum pressure so the envelope remains achievable before saturation.
  const pressure = ARCADE_ASSIST_BRAKING.maxPressure * 0.5
  // Back-propagate squared speed in travel order. Two laps propagate every
  // constraint around a closed circuit; open paths only need one pass.
  const passes = path.closed ? 2 : 1
  for (let offset = count * passes - 1; offset >= 0; offset -= 1) {
    const ordinal = offset % count
    const index = reversed ? count - 1 - ordinal : ordinal
    const nextIndex = index + direction
    const point = pointAt(index)
    const next = pointAt(nextIndex)
    if (!point || !next) continue
    const normalizedNext = ((nextIndex % count) + count) % count
    let distance = (next.distance - point.distance) * direction
    if (path.closed && distance < 0) distance += path.totalLength
    distance = Math.max(0, distance)
    const surface = SURFACE_PHYSICS_SPECS[point.surface]
    const terrain = VEHICLE_TERRAIN_PHYSICS_SPECS[carId][point.surface]
    const grip = car.grip * surface.grip * terrain.grip
    const brakeGrip = car.brake * surface.brake * terrain.brake
    const tireLimit = forces.gravityAcceleration * Math.max(forces.minimumGrip, grip) * forces.brakeGripUsage
    const forceLimit = car.brakeForce / car.mass * brakeGrip
    const grade = path.roadSurface.gradeAt(index) * direction
    const gravity = forces.gravityAcceleration *
      Math.sin(clamp(grade, -forces.maximumGrade, forces.maximumGrade))
    const deceleration = Math.max(0, pressure * Math.min(tireLimit, forceLimit) + gravity)
    limits[index] = Math.min(limits[index] ?? Infinity, (limits[normalizedNext] ?? Infinity) + 2 * deceleration * distance)
  }
  return limits.map((squared) => Math.sqrt(squared))
}

/** Returns the route speed envelope in vehicle speed units; Infinity means no corner. */
export function planArcadeSpeed(
  path: RoadPath,
  startIndex: number,
  reversed: boolean,
  carId: CarId = 'blue',
): number {
  const count = path.points.length
  if (count < 3 || !Number.isFinite(startIndex)) return Infinity
  const index = path.closed
    ? ((Math.round(startIndex) % count) + count) % count
    : Math.max(0, Math.min(count - 1, Math.round(startIndex)))
  let cache = envelopes.get(path)
  if (!cache) {
    cache = new Map()
    envelopes.set(path, cache)
  }
  const key = `${carId}:${reversed}`
  let envelope = cache.get(key)
  if (!envelope) {
    envelope = buildEnvelope(path, reversed, carId)
    cache.set(key, envelope)
  }
  return envelope[index] ?? Infinity
}
