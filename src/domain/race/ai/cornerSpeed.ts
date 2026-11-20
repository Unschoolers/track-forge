import { CAR_SPECS, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import type { CarId } from '@/domain/model'
import { VEHICLE_DYNAMICS_TUNING, type CarPhysicsSpec } from '@/domain/race/vehiclePhysicsConfig'
import { clamp } from '@/domain/geometry/math'
import { turnAmountAt } from '@/domain/race/trackContext'
import type { RoadPath } from '@/domain/track/pathBuilder'

const SHARP_BEND_SAFETY_BASE = 0.32
const SHARP_BEND_SAFETY_GAIN = 1.25
const SHARP_BEND_SAFETY_MAX = 0.9

const BRAKE_LOOKAHEAD = [0, 6, 12, 20, 30, 42, 58, 78, 100]
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
const RACING_PAVEMENT_FULL_PACE_TURN = 0.5
const RACING_PAVEMENT_BASE_PACE_TURN = 0.57

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
 * Predict a safe entry speed through the next bends. For every sampled apex,
 * allow only the speed that could still brake down to its corner speed.
 * Distances are actual path arc-lengths, including reverse/wrap races.
 */
export function safeEntrySpeedAhead(
  path: RoadPath,
  nearestIndex: number,
  reversed: boolean,
  cornerSafety: number,
  car: Pick<CarPhysicsSpec, 'max' | 'grip' | 'brake'> = CAR_SPECS.blue,
  pace = 1,
  carId: CarId = 'blue',
  useSharpBendSafety = false,
  fastCorners = false,
): number {
  const count = path.points.length
  if (!count || path.totalLength <= 0) return 225
  const at = path.points[((nearestIndex % count) + count) % count]
  if (!at) return 225
  const direction = reversed ? -1 : 1
  const cornerBaseline = fastCorners ? 270 : 225
  const straightSpeed = car.max * pace
  let allowed = straightSpeed
  for (const step of BRAKE_LOOKAHEAD) {
    const raw = nearestIndex + direction * step
    if (!path.closed && (raw < 0 || raw >= count)) break
    const index = ((raw % count) + count) % count
    const point = path.points[index]
    if (!point) continue
    const bend = Math.abs(turnAmountAt(path, index, 6))
    const surface = SURFACE_SPECS[point.surface]
    const terrain = VEHICLE_TERRAIN_SPECS[carId][point.surface]
    const grip = car.grip * surface.grip * terrain.grip
    const surfaceMax = straightSpeed * surface.max * terrain.max
    // Allow the chassis more time to rotate through tight bends, especially
    // when traffic places it away from the center of the racing line.
    const sharpBendSafety = clamp(
      SHARP_BEND_SAFETY_BASE + bend * SHARP_BEND_SAFETY_GAIN, 0, SHARP_BEND_SAFETY_MAX,
    )
    const effectiveSafety = useSharpBendSafety ? Math.max(cornerSafety, sharpBendSafety) : cornerSafety
    const apexSpeed = bend < 0.001 ? surfaceMax : Math.min(surfaceMax, clamp(
      (cornerBaseline - bend * (fastCorners ? 600 : 350) * effectiveSafety) * Math.sqrt(grip) +
        Math.max(0, straightSpeed - cornerBaseline) * Math.exp(-bend * (fastCorners ? 1.5 : 20)),
      70, straightSpeed,
    ))
    let distance = direction * (point.distance - at.distance)
    if (path.closed && distance < 0) distance += path.totalLength
    distance = Math.max(0, distance)
    const brakeDeceleration = Math.min(95 * car.brake * surface.brake * terrain.brake, grip * BRAKE_TRACTION)
    const entrySpeed = Math.sqrt(apexSpeed ** 2 + 2 * brakeDeceleration * distance)
    allowed = Math.min(allowed, entrySpeed)
  }
  return allowed
}
