import { CAR_SPECS, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import type { CarId, SurfaceId } from '@/domain/model'
import { brakingTractionForSurface, VEHICLE_DYNAMICS_TUNING, type CarPhysicsSpec } from '@/domain/race/vehiclePhysicsConfig'
import { clamp } from '@/domain/geometry/math'
import { turnAmountAt } from '@/domain/race/trackContext'
import type { RoadPath } from '@/domain/track/pathBuilder'

const SHARP_BEND_SAFETY_BASE = 0.32
const SHARP_BEND_SAFETY_GAIN = 1.25
const SHARP_BEND_SAFETY_MAX = 0.9

const BRAKE_LOOKAHEAD = [0, 6, 12, 20, 30, 42, 58, 78, 100]
// Ice and loose dirt offer much less braking force than pavement. At racing
// speed the stopping distance can exceed the ordinary 600-unit preview.
// Check only those low-traction hazards farther ahead: widening the entire
// scan would over-brake fast asphalt courses.
// Six-unit spacing matches resampled road arc-length. A sparse long scan can
// skip a sharp icy apex entirely, falsely permitting full-speed approach.
const LOW_GRIP_BRAKE_LOOKAHEAD = Array.from({ length: 18 }, (_, i) => 106 + i * 6)
const BRAKE_TRACTION = VEHICLE_DYNAMICS_TUNING.forces.gravityAcceleration *
  VEHICLE_DYNAMICS_TUNING.forces.brakeGripUsage
const PAVEMENT_PREVIEW = [0, 6, 12, 20, 30, 39, 48, 58]
const RECENT_SURFACE_SAMPLES = [8, 18]
const PAVEMENT_FULL_PACE_TURN = 0.23
const PAVEMENT_BASE_PACE_TURN = 0.68
const PAVEMENT_SWITCHBACK_TURN = 0.32
const pavementPreviewByPath = new WeakMap<RoadPath, Map<number, number>>()
const smoothRoadByPath = new WeakMap<RoadPath, boolean>()
const racingPavementByPath = new WeakMap<RoadPath, Map<number, number>>()
const SHARP_LOCAL_TURN = 0.2
const MAX_SHARP_SAMPLE_FRACTION = 0.012
const MIN_PAVED_SAMPLE_FRACTION = 0.95
// High-speed pavement pursuit can only increase corner pace on true sweeps.
// At the western Roundabout hairpin, six-sample curvature reaches ~0.41:
// the old 0.50/0.57 gate incorrectly granted the full 2.15x pace multiplier,
// so Red and Blue reached the turn at 300+ without meaningful braking.
// Fade this allowance *before* tight turn-in; steering and tire physics stay unchanged.
const RACING_PAVEMENT_FULL_PACE_TURN = 0.2
const RACING_PAVEMENT_BASE_PACE_TURN = 0.34

/** Fraction of extra pavement pace a sweeping approach can support. */
export function sweepingPavementAllowance(path: RoadPath, index: number, reversed: boolean): number {
  let preview = pavementPreviewByPath.get(path)
  if (!preview) {
    preview = new Map()
    pavementPreviewByPath.set(path, preview)
  }
  const key = reversed ? -index - 1 : index
  const cached = preview.get(key)
  if (cached !== undefined) return cached

  const count = path.points.length
  const direction = reversed ? -1 : 1
  let paved = count > 0
  let peakTurn = 0
  let absoluteTurn = 0
  let netTurn = 0
  for (const offset of PAVEMENT_PREVIEW) {
    const rawIndex = index + direction * offset
    if (!path.closed && (rawIndex < 0 || rawIndex >= count)) break
    const sample = path.points[((rawIndex % count) + count) % count]
    if (sample?.surface !== 'street') {
      paved = false
      break
    }
    const turn = turnAmountAt(path, rawIndex, 6)
    peakTurn = Math.max(peakTurn, Math.abs(turn))
    absoluteTurn += Math.abs(turn)
    netTurn += turn
  }
  // Keep a margin through surface transitions in either travel direction.
  for (const offset of RECENT_SURFACE_SAMPLES) {
    const rawIndex = index - direction * offset
    if (!path.closed && (rawIndex < 0 || rawIndex >= count)) break
    if (path.points[((rawIndex % count) + count) % count]?.surface !== 'street') paved = false
  }
  const sweep = 1 - clamp((peakTurn - PAVEMENT_FULL_PACE_TURN) /
    (PAVEMENT_BASE_PACE_TURN - PAVEMENT_FULL_PACE_TURN), 0, 1)
  // Signed turn cancels through a switchback even though both bends need grip.
  const directionChanges = absoluteTurn - Math.abs(netTurn)
  const allowance = paved ? sweep * (1 - clamp(directionChanges / PAVEMENT_SWITCHBACK_TURN, 0, 1)) : 0
  preview.set(key, allowance)
  return allowance
}

/** Wider steering targets work best where the road bends and grip stay consistent. */
export function racingPavementAllowance(path: RoadPath, index: number, reversed: boolean): number {
  const count = path.points.length
  if (!count || !supportsWidePursuit(path)) return 0

  let preview = racingPavementByPath.get(path)
  if (!preview) {
    preview = new Map()
    racingPavementByPath.set(path, preview)
  }
  const key = reversed ? -index - 1 : index
  const cached = preview.get(key)
  if (cached !== undefined) return cached

  const direction = reversed ? -1 : 1
  let peakTurn = 0
  let paved = true
  // Look back through the corner exit and ahead through the braking horizon.
  for (let offset = -15; offset <= 100; offset += 3) {
    const raw = index + direction * offset
    if (!path.closed && (raw < 0 || raw >= count)) continue
    const sample = ((raw % count) + count) % count
    if (path.points[sample]?.surface !== 'street') {
      paved = false
      break
    }
    peakTurn = Math.max(peakTurn, Math.abs(turnAmountAt(path, sample, 6)))
  }
  const allowance = paved ? 1 - clamp((peakTurn - RACING_PAVEMENT_FULL_PACE_TURN) /
    (RACING_PAVEMENT_BASE_PACE_TURN - RACING_PAVEMENT_FULL_PACE_TURN), 0, 1) : 0
  preview.set(key, allowance)
  return allowance
}

function supportsWidePursuit(path: RoadPath): boolean {
  const cached = smoothRoadByPath.get(path)
  if (cached !== undefined) return cached

  let pavedSamples = 0
  let sharpSamples = 0
  for (const [index, point] of path.points.entries()) {
    if (point.surface === 'street') pavedSamples++
    if (Math.abs(turnAmountAt(path, index, 2)) > SHARP_LOCAL_TURN) sharpSamples++
  }
  const count = path.points.length
  // Stay on the shorter steering profile when tight turns or loose surfaces
  // recur. Frequent transitions can unsettle the car between corners.
  const supportsWide = pavedSamples / count >= MIN_PAVED_SAMPLE_FRACTION &&
    sharpSamples / count <= MAX_SHARP_SAMPLE_FRACTION
  smoothRoadByPath.set(path, supportsWide)
  return supportsWide
}

/**
 * Translate a small speed correction into a brake-pedal command. A stronger
 * service brake needs less pressure for the same correction. Blend back to
 * full pressure for severe overspeed; emergency braking bypasses this helper.
 */
export function correctionBrakePressure(car: CarPhysicsSpec, surface: SurfaceId | 'grass', pressure: number): number {
  const multiplier = brakingTractionForSurface(car, surface) / car.brakingTractionScale
  if (multiplier <= 1) return pressure
  return pressure * (1 / multiplier + (1 - 1 / multiplier) * pressure ** 2)
}

/**
 * Predict a safe entry speed through the next bends. For every sampled apex,
 * allow only the speed that could still brake down to its corner speed.
 * Distances are actual path arc-lengths, including reverse/wrap races.
 */
export function safeEntrySpeedAhead(
  path: RoadPath,
  nearestIndex: number,
  reversed: boolean,
  cornerSafety: number,
  car: Pick<CarPhysicsSpec, 'max' | 'grip' | 'brake' | 'steer' | 'yawInertia'> = CAR_SPECS.blue,
  pace = 1,
  carId: CarId = 'blue',
  useSharpBendSafety = false,
  fastCorners = false,
  useChassisYawSafety = true,
): number {
  const count = path.points.length
  if (!count || path.totalLength <= 0) return 225
  const at = path.points[((nearestIndex % count) + count) % count]
  if (!at) return 225
  const direction = reversed ? -1 : 1
  const cornerBaseline = fastCorners ? 270 : 225
  const straightSpeed = car.max * pace
  // Higher tire grip does not make a heavy, slow-yaw chassis turn instantly.
  // Apply the correction only near bends; straight-line pace is untouched.
  const steeringResponse = Math.sqrt(
    (car.steer / CAR_SPECS.blue.steer) *
    (CAR_SPECS.blue.yawInertia / Math.max(1, car.yawInertia)),
  )
  // Keep the cautious yaw penalty for slower chassis. Agile, high-grip cars
  // can rotate through an apex more quickly, but only when the CURRENT
  // surface has enough real tire grip to support it. This deliberately gives
  // no bonus on ice and does not change car physics or surface speed limits.
  const turningPace = useChassisYawSafety ? clamp(steeringResponse, 0.84, 1) : 1
  let allowed = straightSpeed
  for (const step of [...BRAKE_LOOKAHEAD, ...LOW_GRIP_BRAKE_LOOKAHEAD]) {
    const raw = nearestIndex + direction * step
    if (!path.closed && (raw < 0 || raw >= count)) break
    const index = ((raw % count) + count) % count
    const point = path.points[index]
    if (!point) continue
    const bend = Math.abs(turnAmountAt(path, index, 6))
    const surface = SURFACE_SPECS[point.surface]
    const terrain = VEHICLE_TERRAIN_SPECS[carId][point.surface]
    if (step > 100 && surface.grip * terrain.grip >= 0.82) continue
    const grip = car.grip * surface.grip * terrain.grip
    const surfaceMax = straightSpeed * surface.max * terrain.max
    // Allow the chassis more time to rotate through tight bends, especially
    // when traffic places it away from the center of the racing line.
    const sharpBendSafety = clamp(
      SHARP_BEND_SAFETY_BASE + bend * SHARP_BEND_SAFETY_GAIN, 0, SHARP_BEND_SAFETY_MAX,
    )
    const effectiveSafety = useSharpBendSafety ? Math.max(cornerSafety, sharpBendSafety) : cornerSafety
    // Green's very quick-yaw, high-grip chassis can safely retain a little
    // more speed at the tightest dirt/pavement apexes. Keep the historical
    // minimum on ice and for less responsive cars; this is a target speed,
    // never a physics or traction exemption.
    const nimbleGrip = Math.max(0, steeringResponse - 1) *
      clamp((grip - 0.75) / 0.2, 0, 1)
    const apexMinimum = 70 + Math.min(14, nimbleGrip * 35)
    const apexSpeed = bend < 0.001 ? surfaceMax : Math.min(surfaceMax, clamp(
      (cornerBaseline - bend * (fastCorners ? 600 : 350) * effectiveSafety) * Math.sqrt(grip) +
        Math.max(0, straightSpeed - cornerBaseline) * Math.exp(-bend * (fastCorners ? 1.5 : 20)),
      apexMinimum, straightSpeed,
    ))
    let distance = direction * (point.distance - at.distance)
    if (path.closed && distance < 0) distance += path.totalLength
    distance = Math.max(0, distance)
    // Peak pavement service-brake force is not a cornering capability.
    // Red needs time to release the brake and rotate before a tight apex.
    // Keep its proven approach budget through technical bends/transitions;
    // exploit the added straight-line braking capacity on gentle paved sweeps.
    const chassis = CAR_SPECS[carId]
    const serviceTraction = brakingTractionForSurface(chassis, point.surface)
    const extraBrakeAllowance = serviceTraction > chassis.brakingTractionScale
      ? (1 - clamp((bend - 0.045) / 0.10, 0, 1)) *
        sweepingPavementAllowance(path, nearestIndex, reversed)
      : 0
    const plannedBrakeTraction = chassis.brakingTractionScale +
      (serviceTraction - chassis.brakingTractionScale) * extraBrakeAllowance
    const brakeDeceleration = Math.min(95 * car.brake * surface.brake * terrain.brake, grip * BRAKE_TRACTION) *
      VEHICLE_DYNAMICS_TUNING.forces.brakingTractionScale * plannedBrakeTraction
    const agileGripBonus = useChassisYawSafety
      ? Math.min(0.12, Math.max(0, steeringResponse - 1) * 0.3) *
        clamp((grip - 0.75) / 0.2, 0, 1)
      : 0
    const corneringPace = 1 - (1 - turningPace - agileGripBonus) * clamp(bend / 0.1, 0, 1)
    const entrySpeed = Math.sqrt((apexSpeed * corneringPace) ** 2 + 2 * brakeDeceleration * distance)
    allowed = Math.min(allowed, entrySpeed)
  }
  return allowed
}
