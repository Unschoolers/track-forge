import type { RandomSource } from '@/application/ports/random'
import { AI_OVERTAKE, CAR_SPECS, DIFFICULTY_SPECS, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { DifficultyId } from '@/domain/model'
import {
  createAiDriverState,
  type AiDriverState,
} from '@/domain/race/ai/aiState'
import { choosePassingLane } from '@/domain/race/ai/lanePlanner'
import type { TrafficState } from '@/domain/race/ai/traffic'
import type { RaceVehicle } from '@/domain/race/raceState'
import {
  getVehicleStepContext,
  turnAmountAt,
} from '@/domain/race/trackContext'
import { stepVehicle, type SpeedAssist } from '@/domain/race/vehiclePhysics'
import { racingPavementAllowance, safeEntrySpeedAhead, sweepingPavementAllowance } from '@/domain/race/ai/cornerSpeed'
import type { RoadPath } from '@/domain/track/pathBuilder'

const ARCADE_CORNER_MARGIN = { easy: 0.16, normal: 0.10, hard: 0 } as const
const HARD_LOOKAHEAD_SAMPLES = 4
const SIDESLIP_CORRECTION_GAIN = 0.65
const SIDESLIP_MIN_SPEED = 20

const BEND_LOOKAHEAD = [0, 6, 12, 20, 30]
const CENTER_LINE_TURN = 0.28
const LANE_CHANGE_LOOKAHEAD = 24
const LANE_CHANGE_CLEARANCE = 18
const CORNER_THROTTLE_WINDOW = 20
const HARD_PAVEMENT_LOOKAHEAD_SAMPLES = 5
const HARD_PAVEMENT_CORNER_PACE = 1.07
const HARD_PAVEMENT_THROTTLE_WINDOW = 13
const SWEEP_LOOKAHEAD_SAMPLES = 16
const SWEEP_CORNER_PACE = 0.4
const SWEEP_EDGE_MARGIN = 15
const SWEEP_EDGE_LIMIT = 36
const SWEEP_HEADING_MARGIN = 0.14
const SWEEP_HEADING_LIMIT = 0.46
const RACING_PAVEMENT_LOOKAHEAD_SAMPLES = 20
const RACING_PAVEMENT_SWEEP_SAMPLES = 2
const RACING_PAVEMENT_CORNER_PACE = 2.15
const RACING_PAVEMENT_SWEEP_PACE = 0.32
const RACING_PAVEMENT_THROTTLE_WINDOW = 5
const RACING_PAVEMENT_EDGE_MARGIN = 31
const RACING_PAVEMENT_EDGE_LIMIT = 42
const RACING_PAVEMENT_HEADING_MARGIN = 0.38
const RACING_PAVEMENT_HEADING_LIMIT = 0.8

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function advancePassingState(
  vehicle: RaceVehicle,
  ai: AiDriverState,
  traffic: TrafficState,
  difficulty: DifficultyId,
  deltaSeconds: number,
): AiDriverState {
  const tuning = AI_OVERTAKE[difficulty]
  const ahead = traffic.ahead
  const cooldownRemaining = Math.max(0, ai.cooldownRemaining - deltaSeconds)
  if (ai.phase === 'follow') {
    if (
      cooldownRemaining <= 0 &&
      ahead &&
      ahead.distance < tuning.triggerDistance *
        (ai.personality === 'cautious' ? 1 : ai.personality === 'opportunist' ? 1.4 : 1.25) &&
      ahead.vehicle.speed + (ai.personality === 'cautious' ? 12 : 4) < vehicle.speed
    ) {
      const passLane = choosePassingLane(vehicle, traffic, difficulty,
        ai.personality === 'opportunist' ? 1 : ai.personality === 'steady' ? -1 : 0, true)
      if (passLane !== vehicle.lane && passLane !== ai.baseLane) {
        return {
          ...ai,
          phase: 'passing',
          passTargetId: ahead.vehicle.id,
          passElapsed: 0,
          targetLane: passLane,
          passLane,
          holdRemaining: tuning.laneHold,
          cooldownRemaining,
          clearTime: 0,
        }
      }
    }
    return { ...ai, targetLane: ai.baseLane, cooldownRemaining }
  }
  const destinationClear = !traffic.nearby.some((entry) =>
    Math.abs(entry.vehicle.lane - ai.baseLane) < Math.max(18, tuning.passClearance) &&
    Math.abs(entry.signedDistance) < Math.max(18, tuning.completionDistance),
  )
  if (ai.phase === 'passing') {
    const holdRemaining = Math.max(0, ai.holdRemaining - deltaSeconds)
    const passElapsed = (ai.passElapsed ?? 0) + deltaSeconds
    const target = traffic.nearby.find((entry) => entry.vehicle.id === ai.passTargetId)
    const targetClear = !target || target.signedDistance < -tuning.completionDistance
    // A stuck pass eventually aborts, but never enters an occupied lane.
    const clear = destinationClear && (targetClear || passElapsed > 8)
    const clearTime = clear ? ai.clearTime + deltaSeconds : 0
    if (holdRemaining <= 0 && clearTime >= 0.25) {
      return {
        ...ai,
        phase: 'rejoin',
        targetLane: ai.baseLane,
        holdRemaining: 0,
        clearTime,
      }
    }
    return { ...ai, holdRemaining, clearTime, cooldownRemaining, passElapsed }
  }
  if (!destinationClear) {
    return { ...ai, phase: 'passing', targetLane: ai.passLane, clearTime: 0, cooldownRemaining }
  }
  if (Math.abs(vehicle.lane - ai.baseLane) < 3) {
    return {
      ...ai,
      phase: 'follow',
      targetLane: ai.baseLane,
      passLane: ai.baseLane,
      cooldownRemaining: tuning.laneHold * 2,
      clearTime: 0,
    }
  }
  return { ...ai, targetLane: ai.baseLane, cooldownRemaining }
}

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
  const drivingDifficulty = handling === 'arcade' || vehicle.racingLine ? 'hard' : difficulty
  const tuning = DIFFICULTY_SPECS[drivingDifficulty]
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
  let sweep = arcadePavement ? sweepingPavementAllowance(path, context.nearest.index, reversed) : 0
  let racingPace = arcadePavement ? racingPavementAllowance(path, context.nearest.index, reversed) : 0
  if (sweep > 0 || racingPace > 0) {
    // Back out smoothly if a rival is running wide or is still turning in.
    const roadHeading = Math.atan2(context.tangent.y * direction, context.tangent.x * direction)
    const headingError = Math.abs(wrapAngle(roadHeading - vehicle.angle))
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
  const pursuitSamples = Math.max(1, lookAheadSamples + extraSamples)
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
  const targetX = target.x + context.normal.x * pursuitLane
  const targetY = target.y + context.normal.y * pursuitLane
  const desiredAngle = !path.closed && Math.hypot(targetX - vehicle.x, targetY - vehicle.y) < 0.001
    ? Math.atan2(context.tangent.y * direction, context.tangent.x * direction)
    : Math.atan2(targetY - vehicle.y, targetX - vehicle.x)
  const sideslip = drivingDifficulty === 'hard' && vehicle.speed > SIDESLIP_MIN_SPEED
    ? wrapAngle(Math.atan2(vehicle.vy, vehicle.vx) - vehicle.angle) * SIDESLIP_CORRECTION_GAIN
    : 0
  const desiredSteer = clamp(
    wrapAngle(desiredAngle - vehicle.angle - sideslip) * tuning.steerGain -
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
  ) * cornerPace
  const practicedSpeedRatio = vehicle.racingLine?.speedRatio ?? 1
  let curveSpeed = practicedSpeedRatio < 1 ? Math.min(cornerTarget, car.max) * practicedSpeedRatio : cornerTarget
  const cornerMargin = arcade && !vehicle.racingLine ? ARCADE_CORNER_MARGIN[difficulty] : 0
  if (cornerMargin > 0 && context.surface !== 'grass') {
    // Add grip reserve as a bend approaches while allowing full speed on straights.
    const bendWeight = clamp((bend - 0.02) / 0.18, 0, 1)
    const roadSpeed = car.max * SURFACE_SPECS[context.surface].max * VEHICLE_TERRAIN_SPECS[vehicle.car][context.surface].max
    const gripReserve = Math.min(cornerTarget, roadSpeed) * cornerMargin
    const excessTarget = Math.max(0, cornerTarget - roadSpeed)
    curveSpeed -= bendWeight * (gripReserve + excessTarget)
  }
  // A faster straight-line chassis with weak grip needs extra entry margin.
  // Scale braking anticipation by the actual grip deficit and upcoming bend;
  // full speed is still available on straights and no physics cap is added.
  const gripDeficit = Math.max(0, 1 - car.grip)
  const cornerReserve = clamp(gripDeficit * bend / 0.09, 0, 0.17)
  curveSpeed *= 1 - cornerReserve
  const curveBraking = vehicle.speed > curveSpeed + 3
  // Ease off on approach so the tires can turn without repeated hard braking.
  const throttleWindow = fastCorners ? 5 : arcadePavement
    ? HARD_PAVEMENT_THROTTLE_WINDOW * basePace + RACING_PAVEMENT_THROTTLE_WINDOW * racingPace
    : CORNER_THROTTLE_WINDOW
  const curveThrottle = clamp((curveSpeed + 2 - vehicle.speed) / throttleWindow, 0, 1)
  const recovering = !context.onRoad
  const speedAssist = catchUp && !recovering && !emergency && !following && curveThrottle === 1 &&
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
            ? tuning.pace * 0.45
          : following
            ? tuning.pace * 0.72
            : curveThrottle,
      braking:
        emergency ||
        curveBraking ||
        (recovering &&
          context.nearest.distance > 72 &&
          vehicle.speed > 90),
    },
    context,
    deltaSeconds,
    handling,
    speedLimit,
    speedAssist,
  )
  return { ...stepped, ai }
}
