import type { RandomSource } from '@/domain/race/randomSource'
import { AI_OVERTAKE, CAR_SPECS, DIFFICULTY_SPECS, ROAD_GEOMETRY, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import { clamp, wrapAngleRadians } from '@/domain/geometry/math'
import type { DifficultyId } from '@/domain/model'
import {
  createAiDriverState,
  type AiDriverState,
} from '@/domain/race/ai/aiState'
import { advancePassingState } from '@/domain/race/ai/passingState'
import type { TrafficState } from '@/domain/race/ai/traffic'
import type { RaceVehicle } from '@/domain/race/raceState'
import {
  getVehicleStepContext,
  turnAmountAt,
} from '@/domain/race/trackContext'
import { stepVehicle, type SpeedAssist } from '@/domain/race/vehiclePhysics'
import { racingPavementAllowance, safeEntrySpeedAhead, sweepingPavementAllowance } from '@/domain/race/ai/cornerSpeed'
import { aiSteeringDifficulty, arcadeCornerMargin } from '@/domain/race/ai/difficultyPolicy'
import { planCornerTactics } from '@/domain/race/ai/cornerTactics'
import { plannedApexCut } from '@/domain/race/ai/apexCut'
import { AI_DRIVING_TUNING } from '@/domain/race/ai/aiDrivingTuning'
import type { RoadPath } from '@/domain/track/pathBuilder'

const {
  HARD_LOOKAHEAD_SAMPLES,
  SIDESLIP_CORRECTION_GAIN,
  SIDESLIP_MIN_SPEED,
  BEND_LOOKAHEAD,
  CENTER_LINE_TURN,
  LANE_CHANGE_LOOKAHEAD,
  LANE_CHANGE_CLEARANCE,
  CORNER_THROTTLE_WINDOW,
  HARD_PAVEMENT_LOOKAHEAD_SAMPLES,
  HARD_PAVEMENT_CORNER_PACE,
  HARD_PAVEMENT_THROTTLE_WINDOW,
  SWEEP_LOOKAHEAD_SAMPLES,
  SWEEP_CORNER_PACE,
  SWEEP_EDGE_MARGIN,
  SWEEP_EDGE_LIMIT,
  SWEEP_HEADING_MARGIN,
  SWEEP_HEADING_LIMIT,
  RACING_PAVEMENT_LOOKAHEAD_SAMPLES,
  RACING_PAVEMENT_SWEEP_SAMPLES,
  RACING_PAVEMENT_CORNER_PACE,
  RACING_PAVEMENT_SWEEP_PACE,
  RACING_PAVEMENT_THROTTLE_WINDOW,
  RACING_PAVEMENT_EDGE_MARGIN,
  RACING_PAVEMENT_EDGE_LIMIT,
  RACING_PAVEMENT_HEADING_MARGIN,
  RACING_PAVEMENT_HEADING_LIMIT,
  ARCADE_STEERING,
} = AI_DRIVING_TUNING

function advanceMistake(
  ai: AiDriverState,
  difficulty: DifficultyId,
  deltaSeconds: number,
  random: RandomSource,
): AiDriverState {
  const remaining = Math.max(0, ai.mistakeRemaining - deltaSeconds)
  if (remaining > 0) return { ...ai, mistakeRemaining: remaining }
  const tuning = DIFFICULTY_SPECS[difficulty]
  if (random.next() < tuning.mistakeRate * deltaSeconds) {
    return {
      ...ai,
      mistakeOffset: (random.next() * 2 - 1) * tuning.lineError,
      mistakeRemaining: 0.35 + random.next() * 0.35,
    }
  }
  return { ...ai, mistakeOffset: 0, mistakeRemaining: 0 }
}

export function stepAiVehicle(
  vehicle: RaceVehicle,
  path: RoadPath,
  traffic: TrafficState,
  difficulty: DifficultyId,
  deltaSeconds: number,
  random: RandomSource = { next: () => 0.5 },
  reversed = false,
  speedLimit = Number.POSITIVE_INFINITY,
  handling: 'arcade' | 'simulation' = 'simulation',
  catchUp?: SpeedAssist,
): RaceVehicle {
  if (path.points.length === 0) return vehicle
  // Arcade shares steering technique across difficulties. Traffic decisions
  // and driver mistakes still use the selected difficulty.
  const drivingDifficulty = aiSteeringDifficulty(difficulty, handling, Boolean(vehicle.racingLine))
  // Arcade drivers share steering technique across difficulty levels.
  // Stronger but slower-changing steering follows the next bend without the
  // instant counter-corrections that previously made the car over-brake.
  // Authored racing lines and Simulation retain their original policy.
  const tuning = handling === 'arcade' && !vehicle.racingLine
    ? { ...DIFFICULTY_SPECS[drivingDifficulty], ...ARCADE_STEERING,
        reaction: difficulty === 'hard' ? 16 : ARCADE_STEERING.reaction }
    : DIFFICULTY_SPECS[drivingDifficulty]
  const car = CAR_SPECS[vehicle.car]
  let ai = vehicle.ai ?? createAiDriverState(vehicle.lane)
  ai = advancePassingState(vehicle, ai, traffic, difficulty, deltaSeconds)
  ai = advanceMistake(ai, difficulty, deltaSeconds, random)

  const context = getVehicleStepContext(path, vehicle)
  const arcade = handling === 'arcade'
  // Carry more speed on high-grip roads. Authored lines already account for
  // their own approach, and loose surfaces need the usual braking margin.
  const arcadePavement = arcade && !vehicle.racingLine && context.surface === 'street'
  const direction = reversed ? -1 : 1
  const slipAngle = vehicle.speed > SIDESLIP_MIN_SPEED
    ? wrapAngleRadians(Math.atan2(vehicle.vy, vehicle.vx) - vehicle.angle)
    : 0
  const roadOffset =
    (vehicle.x - context.nearest.point.x) * context.normal.x +
    (vehicle.y - context.nearest.point.y) * context.normal.y
  const lateralVelocity = vehicle.vx * context.normal.x +
    vehicle.vy * context.normal.y
  const corner = planCornerTactics(path, context.nearest.index, reversed,
    vehicle.speed, slipAngle, roadOffset, ROAD_GEOMETRY.onRoadRadius, lateralVelocity)
  let sweep = arcadePavement ? sweepingPavementAllowance(path, context.nearest.index, reversed) : 0
  let racingPace = arcadePavement ? racingPavementAllowance(path, context.nearest.index, reversed) : 0
  if (sweep > 0 || racingPace > 0) {
    // Back out smoothly if a rival is running wide or is still turning in.
    const roadHeading = Math.atan2(context.tangent.y * direction, context.tangent.x * direction)
    const headingError = Math.abs(wrapAngleRadians(roadHeading - vehicle.angle))
    const edge = 1 - clamp((context.nearest.distance - SWEEP_EDGE_MARGIN) /
      (SWEEP_EDGE_LIMIT - SWEEP_EDGE_MARGIN), 0, 1)
    const alignment = 1 - clamp((headingError - SWEEP_HEADING_MARGIN) /
      (SWEEP_HEADING_LIMIT - SWEEP_HEADING_MARGIN), 0, 1)
    sweep *= edge * alignment
    const racingEdge = 1 - clamp((context.nearest.distance - RACING_PAVEMENT_EDGE_MARGIN) /
      (RACING_PAVEMENT_EDGE_LIMIT - RACING_PAVEMENT_EDGE_MARGIN), 0, 1)
    const racingAlignment = 1 - clamp((headingError - RACING_PAVEMENT_HEADING_MARGIN) /
      (RACING_PAVEMENT_HEADING_LIMIT - RACING_PAVEMENT_HEADING_MARGIN), 0, 1)
    racingPace *= racingEdge * racingAlignment
  }
  // A dynamic chassis needs a speed-scaled pursuit point on the road. When an
  // AI misses the surface, shorten the target so it returns instead of drawing
  // an enormous high-speed arc around a distant point.
  const hardLookAhead = drivingDifficulty === 'hard' ? HARD_LOOKAHEAD_SAMPLES : 0
  const lookAheadSamples = Math.round(
    context.onRoad
      ? clamp(5 + vehicle.speed / 18 + tuning.lookAhead + hardLookAhead, 5, 22)
      : 3,
  )
  const racingLine = context.onRoad ? vehicle.racingLine?.sections : undefined
  const notes = racingLine?.[context.nearest.point.segment]
  const basePace = 1 - racingPace
  const extraSamples = notes?.extraSamples ?? (arcadePavement ? Math.round(
    (HARD_PAVEMENT_LOOKAHEAD_SAMPLES + sweep * SWEEP_LOOKAHEAD_SAMPLES) * basePace +
    (RACING_PAVEMENT_LOOKAHEAD_SAMPLES + sweep * RACING_PAVEMENT_SWEEP_SAMPLES) * racingPace,
  ) : 0)
  // Hard arcade uses a longer pursuit target and can run wide if its
  // lateral momentum carries it toward the verge. Shorten that target only
  // when needed; never override easier drivers or authored racing lines.
  let edgeRisk = 0
  if (difficulty === 'hard' && arcade && !vehicle.racingLine) {
    if (!context.onRoad) {
      edgeRisk = 1
    } else {
      const lateralOffset =
        (vehicle.x - context.nearest.point.x) * context.normal.x +
        (vehicle.y - context.nearest.point.y) * context.normal.y
      const lateralVelocity = vehicle.vx * context.normal.x + vehicle.vy * context.normal.y
      const outwardVelocity = Math.max(0, Math.sign(lateralOffset) * lateralVelocity)
      const projectedEdge = Math.abs(lateralOffset) + outwardVelocity * 0.24
      edgeRisk = clamp((projectedEdge - 18) / (ROAD_GEOMETRY.onRoadRadius - 18), 0, 1)
    }
  }
  const pursuitSamples = Math.max(1, Math.round(
    (lookAheadSamples + extraSamples) * (1 - 0.5 * edgeRisk) *
      (arcade && !vehicle.racingLine ? corner.pursuitScale : 1),
  ))
  const rawTargetIndex = context.nearest.index + (reversed ? -pursuitSamples : pursuitSamples)
  const targetIndex = path.closed
    ? ((rawTargetIndex % path.points.length) + path.points.length) % path.points.length
    : clamp(rawTargetIndex, 0, path.points.length - 1)
  const target = path.points[targetIndex]
  if (!target) return { ...vehicle, ai }
  let bend = 0
  for (const sample of BEND_LOOKAHEAD) {
    bend = Math.max(bend, Math.abs(turnAmountAt(path, context.nearest.index + direction * sample, 6)))
  }
  // A wide passing line can point the car across the return arm of a
  // hairpin. Ease toward the center on approach if the space is clear.
  const lane = ai.targetLane + ai.mistakeOffset
  const centered = lane * (1 - clamp(bend / CENTER_LINE_TURN, 0, 1))
  const inner = Math.min(vehicle.lane, centered) - LANE_CHANGE_CLEARANCE
  const outer = Math.max(vehicle.lane, centered) + LANE_CHANGE_CLEARANCE
  const occupied = traffic.nearby.some((entry) =>
    Math.abs(entry.signedDistance) < LANE_CHANGE_LOOKAHEAD &&
    entry.vehicle.lane > inner && entry.vehicle.lane < outer)
  const pursuitLane = (occupied ? lane : centered) + (racingLine?.[target.segment]?.laneOffset ?? 0)
  // Legal shoulder cuts are a *target line*, not modified tire physics.
  // No shortcut during overtakes, uncontrolled slides, missed road contact,
  // or while using a track's authored racing line.
  const cut = arcade && !vehicle.racingLine && !occupied &&
    ai.phase === 'follow' && context.onRoad && vehicle.grounded &&
    Math.abs(slipAngle) < 0.24
      ? plannedApexCut(path, targetIndex, reversed, difficulty, vehicle.car,
        roadOffset, lateralVelocity)
      : { x: 0, y: 0 }
  const targetX = target.x + context.normal.x * pursuitLane + cut.x
  const targetY = target.y + context.normal.y * pursuitLane + cut.y
  const desiredAngle = (!path.closed && Math.hypot(targetX - vehicle.x, targetY - vehicle.y) < 0.001
    ? Math.atan2(context.tangent.y * direction, context.tangent.x * direction)
    : Math.atan2(targetY - vehicle.y, targetX - vehicle.x)) +
    (arcade && !vehicle.racingLine && context.onRoad ? corner.headingLead : 0)
  // Drift-aware countersteering follows the velocity vector without deleting
  // slip: the tire model still determines whether the car keeps sliding.
  const sideslip = drivingDifficulty === 'hard' && vehicle.speed > SIDESLIP_MIN_SPEED
    ? slipAngle * (arcade && !vehicle.racingLine ? corner.sideslipGain : SIDESLIP_CORRECTION_GAIN)
    : 0
  const desiredSteer = clamp(
    wrapAngleRadians(desiredAngle - vehicle.angle - sideslip) * tuning.steerGain -
      vehicle.yawRate * 0.38,
    -1,
    1,
  )
  const steer =
    ai.steer +
    (desiredSteer - ai.steer) *
      clamp(tuning.reaction * deltaSeconds, 0, 1)
  ai = { ...ai, steer }

  const ahead = traffic.ahead
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
  if (arcade) {
    for (let sample = -30; sample <= 60; sample += 10) {
      nearbyTurn += Math.abs(turnAmountAt(path, context.nearest.index + direction * sample, 6))
    }
  }
  const fastCorners = arcade && nearbyTurn < 1.15
  const cornerPace = notes?.cornerPace ?? (arcadePavement
    ? (HARD_PAVEMENT_CORNER_PACE + sweep * SWEEP_CORNER_PACE) * basePace +
      (RACING_PAVEMENT_CORNER_PACE + sweep * RACING_PAVEMENT_SWEEP_PACE) * racingPace : 1)
  // Brake for the tightest upcoming bend, not just one moving pursuit point.
  const cornerTarget = safeEntrySpeedAhead(
    path, context.nearest.index, reversed, tuning.cornerSafety,
    car, tuning.pace * vehicle.aiPace, vehicle.car, drivingDifficulty === 'hard', fastCorners,
    !vehicle.racingLine,
  ) * cornerPace
  const practicedSpeedRatio = vehicle.racingLine?.speedRatio ?? 1
  let curveSpeed = practicedSpeedRatio < 1 ? Math.min(cornerTarget, car.max) * practicedSpeedRatio : cornerTarget
  const cornerMargin = arcade && !vehicle.racingLine ? arcadeCornerMargin(difficulty) : 0
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
  if (ai.phase === 'passing' && !vehicle.racingLine) {
    curveSpeed *= 1 - 0.14 * clamp(bend / 0.12, 0, 1)
  }
  // A faster straight-line chassis with weak grip needs extra entry margin.
  // Scale braking anticipation by the actual grip deficit and upcoming bend;
  // full speed is still available on straights and no physics cap is added.
  const gripDeficit = Math.max(0, 1 - car.grip)
  const cornerReserve = clamp(gripDeficit * bend / 0.09, 0, 0.17)
  curveSpeed *= 1 - cornerReserve
  // Braking during turn-in consumes the same tire-force budget that rotates
  // the chassis. Finish the heavy braking on approach, then release it
  // progressively through a stable pavement apex. Emergency/traffic braking
  // still overrides this margin, and loose surfaces keep the conservative rule.
  const apexBrakeMargin = arcade && !vehicle.racingLine && context.onRoad &&
    context.surface === 'street' && (corner.phase === 'turn' || corner.phase === 'exit')
      ? 7 : 3
  const curveBrakeThreshold = Math.max(apexBrakeMargin, corner.drifting && arcade ? 7 : 3)
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
  const throttleWindow = fastCorners ? 5 : arcadePavement
    ? HARD_PAVEMENT_THROTTLE_WINDOW * basePace + RACING_PAVEMENT_THROTTLE_WINDOW * racingPace
    : CORNER_THROTTLE_WINDOW
  const curveThrottle = clamp((curveSpeed + 2 - vehicle.speed) / throttleWindow, 0, 1)
  const settledSlide = arcade && !vehicle.racingLine && context.onRoad &&
    Math.abs(roadOffset) < ROAD_GEOMETRY.onRoadRadius * 0.5 && !curveBraking
  // A car still sliding toward the outside must complete its rotation
  // before applying exit power. In a clean line traction remains at 1.
  const plannedThrottle = (settledSlide
    ? Math.max(curveThrottle, corner.exitThrottle)
    : curveThrottle) * (arcade && !vehicle.racingLine ? corner.exitTraction : 1)
  const recovering = !context.onRoad
  const speedAssist = catchUp && !recovering && !emergency && !following && plannedThrottle === 1 &&
    vehicle.grounded && Math.abs(context.grade) < 0.025 && bend < 0.015
      ? catchUp
      : undefined
  const stepped = stepVehicle(
    vehicle,
    {
      steering: steer,
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
        ? 1 : cornerBrakePressure,
    },
    context,
    deltaSeconds,
    handling,
    speedLimit,
    speedAssist,
  )
  return { ...stepped, ai }
}
