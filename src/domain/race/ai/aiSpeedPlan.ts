import { AI_OVERTAKE, CAR_SPECS, ROAD_GEOMETRY, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { DifficultyId } from '@/domain/model'
import type { AiDriverState } from '@/domain/race/ai/aiState'
import type { TrafficState } from '@/domain/race/ai/traffic'
import type { RaceVehicle, DriverInput } from '@/domain/race/raceState'
import { turnAmountAt, type VehicleStepContext } from '@/domain/race/trackContext'
import type { SpeedAssist } from '@/domain/race/vehiclePhysics'
import { correctionBrakePressure, safeEntrySpeedAhead } from '@/domain/race/ai/cornerSpeed'
import { arcadeCornerMargin } from '@/domain/race/ai/difficultyPolicy'
import type { CornerTactics } from '@/domain/race/ai/cornerTactics'
import { AI_DRIVING_TUNING } from '@/domain/race/ai/aiDrivingTuning'
import type { CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import type { RoadPath } from '@/domain/track/pathBuilder'

const {
  CORNER_THROTTLE_WINDOW,
  HARD_PAVEMENT_CORNER_PACE,
  HARD_PAVEMENT_THROTTLE_WINDOW,
  SWEEP_CORNER_PACE,
  RACING_PAVEMENT_CORNER_PACE,
  RACING_PAVEMENT_SWEEP_PACE,
  RACING_PAVEMENT_THROTTLE_WINDOW,
} = AI_DRIVING_TUNING

interface SpeedPlanContext {
  readonly vehicle: RaceVehicle
  readonly path: RoadPath
  readonly relevantTraffic: TrafficState
  readonly difficulty: DifficultyId
  readonly reversed: boolean
  readonly direction: number
  readonly tuning: { readonly followDistance: number; readonly cornerSafety: number; readonly pace: number }
  readonly hardProfile: CarDrivingProfile
  readonly ai: AiDriverState
  readonly context: VehicleStepContext
  readonly corner: CornerTactics
  readonly arcadePavement: boolean
  readonly bend: number
  readonly sweep: number
  readonly basePace: number
  readonly racingPace: number
  readonly slipAngle: number
  readonly roadOffset: number
  readonly lateralVelocity: number
  readonly edgeRisk: number
  readonly catchUp: SpeedAssist | undefined
}

/** Longitudinal control requests only. Tire forces remain in vehiclePhysics. */
export function planAiSpeed({
  vehicle, path, relevantTraffic, difficulty, reversed, direction, tuning,
  hardProfile, ai, context, corner, arcadePavement, bend, sweep, basePace,
  racingPace, slipAngle, roadOffset, lateralVelocity, edgeRisk, catchUp,
}: SpeedPlanContext): { input: Pick<DriverInput, 'throttle' | 'braking' | 'brakePressure'>; speedAssist: SpeedAssist | undefined } {
  const car = CAR_SPECS[vehicle.car]
  const ahead = relevantTraffic.ahead
  const emergency =
    ahead !== null &&
    (ahead.distance <= AI_OVERTAKE[difficulty].emergencyDistance ||
      ahead.timeToCollision <= AI_OVERTAKE[difficulty].emergencyTTC)
  const following =
    ahead !== null &&
    ahead.distance < tuning.followDistance &&
    ahead.vehicle.speed < vehicle.speed
  // Leave more margin when the road changes direction repeatedly: a car
  // needs time to settle before it can turn in for the next corner.
  let nearbyTurn = 0
  for (let sample = -30; sample <= 60; sample += 10) {
    nearbyTurn += Math.abs(turnAmountAt(path, context.nearest.index + direction * sample, 6))
  }
  const fastCorners = nearbyTurn < 1.15
  const cornerPace = arcadePavement
    ? (HARD_PAVEMENT_CORNER_PACE + sweep * SWEEP_CORNER_PACE) * basePace +
      (RACING_PAVEMENT_CORNER_PACE + sweep * RACING_PAVEMENT_SWEEP_PACE) * racingPace : 1
  // Brake for the tightest upcoming bend, not just one moving pursuit point.
  const cornerTarget = safeEntrySpeedAhead(
    path, context.nearest.index, reversed, tuning.cornerSafety,
    car, tuning.pace * vehicle.aiPace, vehicle.car, true, fastCorners,
    true,
  ) * cornerPace
  let curveSpeed = cornerTarget
  // A tight pavement hairpin may need more entry caution than an ordinary
  // corner. Reserve it for high-curvature approaches so a low-grip chassis
  // keeps its pace on sweeping and mixed-surface bends. Speed target only;
  // the existing physical brakes and tires still do the work.
  const hairpinSharpness = clamp((bend - 0.16) / 0.12, 0, 1)
  const hairpinReserve = difficulty === 'hard' &&
    context.surface === 'street'
      ? (hardProfile.hardHairpinReserve ?? 0) * hairpinSharpness ** 2
      : 0
  const cornerMargin = arcadeCornerMargin(difficulty, vehicle.car, hardProfile) + hairpinReserve
  if (cornerMargin > 0 && context.surface !== 'grass') {
    // Add grip reserve as a bend approaches while allowing full speed on straights.
    const bendWeight = clamp((bend - 0.02) / 0.18, 0, 1)
    const roadSpeed = car.max * SURFACE_SPECS[context.surface].max * VEHICLE_TERRAIN_SPECS[vehicle.car][context.surface].max
    const gripReserve = Math.min(cornerTarget, roadSpeed) * cornerMargin
    const excessTarget = Math.max(0, cornerTarget - roadSpeed)
    // Medium reserves the full safety margin at hairpins, but may carry
    // more speed through gentler paved turns. Difficulty ordering still owns
    // the base reserve and physical grip remains unchanged.
    const sharpness = clamp((bend - 0.09) / 0.16, 0, 1)
    const reserveFraction = 0.4 + 0.6 * sharpness
    curveSpeed -= bendWeight * (gripReserve * reserveFraction + excessTarget)
  }
  // Passing at the outside edge consumes cornering room. Hold a little
  // extra reserve in bends instead of assuming the centerline racing pace.
  if (ai.phase === 'passing') {
    curveSpeed *= 1 - 0.14 * clamp(bend / 0.12, 0, 1)
  }
  // A faster straight-line chassis with weak grip needs extra entry margin.
  // Scale braking anticipation by the actual grip deficit and upcoming bend;
  // full speed is still available on straights and no physics cap is added.
  const gripDeficit = Math.max(0, 1 - car.grip)
  // A chassis with stronger service brakes can release a fraction of its
  // *extra* low-grip entry margin while aligned on a non-icy road. The tires
  // still supply every newton of braking/turning force; unstable or wide
  // entries retain the full conservative margin.
  const stableLateBrake = difficulty === 'hard' &&
    context.onRoad && context.surface !== 'ice' &&
    Math.abs(slipAngle) < 0.085 &&
    Math.abs(roadOffset) < ROAD_GEOMETRY.onRoadRadius * 0.45 &&
    Math.abs(lateralVelocity) < 22
  const serviceBrakeRelease = stableLateBrake
    ? clamp((car.brakingTractionScale - 1) * 0.7, 0, 0.27)
    : 0
  const cornerReserve = clamp(gripDeficit * bend / 0.09, 0, 0.17) *
    (1 - serviceBrakeRelease)
  curveSpeed *= 1 - cornerReserve
  // A strong driver can *request* a more ambitious entry speed when their
  // line is under control. This changes the target used by braking/throttle,
  // never the tire forces, speed limit, off-road drag or recovery behavior.
  // Back out when drifting outward; do not reward unstable or off-road lines.
  if (difficulty === 'normal' && context.onRoad &&
    Math.abs(slipAngle) < 0.08) {
    // Blue needed one 60 Hz tick to remain within its player-relative Normal
    // pace budget. Adjust the planned speed, never the actual tire forces.
    curveSpeed *= 1 + (hardProfile.normalCornerTargetBonus ?? 0)
  }
  if (difficulty === 'hard' && context.onRoad) {
    const controlled = (1 - edgeRisk) *
      (1 - clamp((Math.abs(slipAngle) - 0.045) / 0.11, 0, 1))
    curveSpeed *= 1 + (hardProfile.hardCornerTargetBonus ?? 0) * controlled
  }
  // Braking during turn-in consumes the same tire-force budget that rotates
  // the chassis. Finish the heavy braking on approach, then release it
  // progressively through a stable pavement apex. Emergency/traffic braking
  // still overrides this margin, and loose surfaces keep the conservative rule.
  const apexBrakeMargin = context.onRoad &&
    context.surface === 'street' && (corner.phase === 'turn' || corner.phase === 'exit')
      ? 7 : 3
  const curveBrakeThreshold = Math.max(apexBrakeMargin, corner.drifting ? 7 : 3)
  const curveOverspeed = vehicle.speed - curveSpeed
  const curveBraking = curveOverspeed > curveBrakeThreshold
  // The former all-or-nothing AI brake rapidly toggled full force in bends,
  // spending lateral tire grip on tiny speed corrections. Modulate pressure
  // by the actual overspeed; reserve full brakes for sharp approaches,
  // emergencies, and genuine off-road recovery. Tire physics is unchanged.
  const cornerBrakePressure = curveBraking
    ? clamp((curveOverspeed - curveBrakeThreshold + 4) / 18, 0.22, 1)
    : 0
  // Ease off on approach so the tires can turn without repeated hard braking.
  const plannedBrakePressure = correctionBrakePressure(car, context.surface, cornerBrakePressure)
  const throttleWindow = fastCorners ? 5 : arcadePavement
    ? HARD_PAVEMENT_THROTTLE_WINDOW * basePace + RACING_PAVEMENT_THROTTLE_WINDOW * racingPace
    : CORNER_THROTTLE_WINDOW
  const curveThrottle = clamp((curveSpeed + 2 - vehicle.speed) / throttleWindow, 0, 1)
  const settledSlide = context.onRoad &&
    Math.abs(roadOffset) < ROAD_GEOMETRY.onRoadRadius * 0.5 && !curveBraking
  // A car still sliding toward the outside must complete its rotation
  // before applying exit power. In a clean line traction remains at 1.
  // Quick-turning, high-grip cars may use a modest exit throttle floor once
  // the chassis and velocity are aligned inside the road. Do not push through
  // a reversal, ice, active brake demand, or an outward slide.
  const cleanCornerExit = difficulty === 'hard' &&
    corner.phase === 'exit' && !corner.reversal && !corner.drifting &&
    context.onRoad && context.surface !== 'ice' && !curveBraking &&
    Math.abs(slipAngle) < 0.055 &&
    Math.abs(roadOffset) < ROAD_GEOMETRY.onRoadRadius * 0.4
  const exitPowerFloor = cleanCornerExit
    ? clamp((car.grip - 1) * 3, 0, 0.42)
    : 0
  const plannedThrottle = (settledSlide
    ? Math.max(curveThrottle, corner.exitThrottle, exitPowerFloor)
    : curveThrottle) * corner.exitTraction
  const recovering = !context.onRoad
  const speedAssist = catchUp && !recovering && !emergency && !following && plannedThrottle === 1 &&
    vehicle.grounded && Math.abs(context.grade) < 0.025 && bend < 0.015
      ? catchUp
      : undefined
  return {
    input: {
      throttle:
        emergency || curveBraking
          ? 0
          : recovering
            // Coasting preserves lateral tire force; braking while turning
            // would starve steering through the friction circle.
            ? vehicle.speed > 90 ? 0 : tuning.pace * 0.45
          : following
            ? tuning.pace * 0.72
            : plannedThrottle,
      braking:
        emergency ||
        curveBraking ||
        (recovering &&
          context.nearest.distance > 72 &&
          vehicle.speed > 90),
      brakePressure: emergency || (recovering &&
        context.nearest.distance > 72 && vehicle.speed > 90)
        ? 1 : plannedBrakePressure,
    },
    speedAssist,
  }
}
