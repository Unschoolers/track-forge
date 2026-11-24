import type { RandomSource } from '@/domain/race/randomSource'
import { DIFFICULTY_SPECS, ROAD_GEOMETRY } from '@/domain/config'
import { clamp, wrapAngleRadians } from '@/domain/geometry/math'
import type { DifficultyId } from '@/domain/model'
import {
  createAiDriverState,
  type AiDriverState,
} from '@/domain/race/ai/aiState'
import { advancePassingState } from '@/domain/race/ai/passingState'
import { compactAiTraffic, aiCourtesyNudge } from '@/domain/race/ai/aiRivalClearance'
import type { TrafficState } from '@/domain/race/ai/traffic'
import type { RaceVehicle } from '@/domain/race/raceState'
import {
  getVehicleStepContext,
  turnAmountAt,
} from '@/domain/race/trackContext'
import { stepVehicle, type SpeedAssist } from '@/domain/race/vehiclePhysics'
import { racingPavementAllowance, sweepingPavementAllowance } from '@/domain/race/ai/cornerSpeed'
import { planAiSpeed } from '@/domain/race/ai/aiSpeedPlan'
import { planCornerTactics, technicalCornerScale } from '@/domain/race/ai/cornerTactics'
import { plannedApexCut } from '@/domain/race/ai/apexCut'
import { AI_DRIVING_TUNING } from '@/domain/race/ai/aiDrivingTuning'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import { CAR_PASSING_POLICIES, type CarPassingPolicy } from '@/domain/race/ai/aiCarPassingPolicies'
import type { RoadPath } from '@/domain/track/pathBuilder'

const {
  HARD_LOOKAHEAD_SAMPLES,
  SIDESLIP_MIN_SPEED,
  BEND_LOOKAHEAD,
  CENTER_LINE_TURN,
  LANE_CHANGE_LOOKAHEAD,
  LANE_CHANGE_CLEARANCE,
  HARD_PAVEMENT_LOOKAHEAD_SAMPLES,
  SWEEP_LOOKAHEAD_SAMPLES,
  SWEEP_EDGE_MARGIN,
  SWEEP_EDGE_LIMIT,
  SWEEP_HEADING_MARGIN,
  SWEEP_HEADING_LIMIT,
  RACING_PAVEMENT_LOOKAHEAD_SAMPLES,
  RACING_PAVEMENT_SWEEP_SAMPLES,
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
  catchUp?: SpeedAssist,
  hardProfileOverride?: CarDrivingProfile,
  passingPolicyOverride?: CarPassingPolicy,
  /** Test-only comparison switch; all production AI rivals use compact clearance. */
  aiAiTrafficMode: 'legacy' | 'compact' = 'compact',
): RaceVehicle {
  if (path.points.length === 0) return vehicle
  // Arcade shares steering technique across difficulties. Traffic decisions
  // and driver mistakes still use the selected difficulty.
  // Arcade drivers share steering technique across difficulty levels.
  // Stronger but slower-changing steering follows the next bend without the
  // instant counter-corrections that previously made the car over-brake.
  // Each physical chassis needs its own Hard cornering technique.
  // Tuning steering *decisions* never alters the car's actual tire forces.
  const hardProfile: CarDrivingProfile = hardProfileOverride ?? CAR_DRIVING_PROFILES[vehicle.car]
  const tuning = { ...DIFFICULTY_SPECS.hard, ...ARCADE_STEERING,
        reaction: difficulty === 'hard' ? hardProfile.hardReaction : ARCADE_STEERING.reaction,
        steerGain: difficulty === 'hard' ? hardProfile.hardSteerGain : ARCADE_STEERING.steerGain }
  // Every AI uses the same compact rival envelope. Only human-driven
  // vehicles warrant full avoidance and overtaking maneuvers. The legacy
  // switch is restricted to offline comparison runs.
  const relaxedAiRivals = aiAiTrafficMode !== 'legacy'
  const relevantTraffic = relaxedAiRivals ? compactAiTraffic(traffic) : traffic
  let ai = vehicle.ai ?? createAiDriverState(vehicle.lane)
  // An AI dot may influence short-range speed, but only the player
  // can trigger a large lane-changing overtake in Arcade.
  const passingTraffic = relaxedAiRivals && !relevantTraffic.ahead?.vehicle.player
    ? { ...relevantTraffic, ahead: null }
    : relevantTraffic
  ai = advancePassingState(vehicle, ai, passingTraffic, difficulty, deltaSeconds,
    passingPolicyOverride ?? CAR_PASSING_POLICIES[vehicle.car])
  ai = advanceMistake(ai, difficulty, deltaSeconds, random)

  const context = getVehicleStepContext(path, vehicle)
  // Carry more speed on high-grip roads; loose surfaces need the usual braking margin.
  const arcadePavement = context.surface === 'street'
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
  const hardLookAhead = difficulty === 'hard'
    ? hardProfile.hardLookAheadSamples : HARD_LOOKAHEAD_SAMPLES
  const lookAheadSamples = Math.round(
    context.onRoad
      ? clamp(5 + vehicle.speed / 18 + tuning.lookAhead + hardLookAhead, 5, 22)
      : 3,
  )
  const basePace = 1 - racingPace
  const extraSamples = arcadePavement ? Math.round(
    (HARD_PAVEMENT_LOOKAHEAD_SAMPLES + sweep * SWEEP_LOOKAHEAD_SAMPLES) * basePace +
    (RACING_PAVEMENT_LOOKAHEAD_SAMPLES + sweep * RACING_PAVEMENT_SWEEP_SAMPLES) * racingPace,
  ) : 0
  // Hard arcade uses a longer pursuit target and can run wide if its
  // lateral momentum carries it toward the verge. Shorten that target only
  // when needed; never override easier drivers.
  let edgeRisk = 0
  if (difficulty === 'hard') {
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
    (lookAheadSamples + extraSamples) *
      (1 - 0.5 * edgeRisk * (difficulty === 'hard' ? hardProfile.hardEdgeAvoidanceScale ?? 1 : 1)) *
      corner.pursuitScale * technicalCornerScale(corner.bend, hardProfile.technicalCornerPursuitScale),
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
  // Hard and Normal make no AI↔AI dodges: their sprites may overlap without
  // physical contact. Easy retains a tiny low-speed courtesy adjustment.
  const lane = ai.targetLane + ai.mistakeOffset + (relaxedAiRivals &&
    difficulty === 'easy' && ai.phase === 'follow'
    ? aiCourtesyNudge(vehicle, traffic, bend, context.onRoad) : 0)
  const centered = lane * (1 - clamp(bend / CENTER_LINE_TURN, 0, 1))
  const inner = Math.min(vehicle.lane, centered) - LANE_CHANGE_CLEARANCE
  const outer = Math.max(vehicle.lane, centered) + LANE_CHANGE_CLEARANCE
  const occupied = relevantTraffic.nearby.some((entry) =>
    Math.abs(entry.signedDistance) < LANE_CHANGE_LOOKAHEAD &&
    entry.vehicle.lane > inner && entry.vehicle.lane < outer)
  const pursuitLane = occupied ? lane : centered
  // Legal shoulder cuts are a *target line*, not modified tire physics.
  // No shortcut during overtakes, uncontrolled slides or missed road contact.
  const cut = !occupied &&
    ai.phase === 'follow' && context.onRoad && vehicle.grounded &&
    context.surface === 'street' &&
    context.nearest.distance < ROAD_GEOMETRY.onRoadRadius * 0.62 &&
    Math.abs(slipAngle) < 0.12
      ? plannedApexCut(path, targetIndex, reversed, difficulty, vehicle.car,
        roadOffset, lateralVelocity, vehicle.speed)
      : { x: 0, y: 0 }
  // This controls an intended racing line, never the actual friction,
  // road support or checkpoint collision geometry.
  const cutScale = difficulty === 'hard' ? hardProfile.hardApexCutScale ?? 1 : 1
  const terminalApproach = !path.closed && rawTargetIndex >= path.points.length - 1
  const terminalBefore = terminalApproach ? path.points[path.points.length - 2] : undefined
  const terminalLength = terminalBefore ? Math.hypot(target.x - terminalBefore.x, target.y - terminalBefore.y) : 0
  // Aim beyond the physical finish plane, rather than braking/turning at its last sample.
  const extension = terminalLength > 0 ? ROAD_GEOMETRY.onRoadRadius : 0
  const targetX = terminalBefore && terminalLength > 0
    ? target.x + (target.x - terminalBefore.x) / terminalLength * extension
    : target.x + context.normal.x * pursuitLane + cut.x * cutScale
  const targetY = terminalBefore && terminalLength > 0
    ? target.y + (target.y - terminalBefore.y) / terminalLength * extension
    : target.y + context.normal.y * pursuitLane + cut.y * cutScale
  const desiredAngle = (!path.closed && Math.hypot(targetX - vehicle.x, targetY - vehicle.y) < 0.001
    ? Math.atan2(context.tangent.y * direction, context.tangent.x * direction)
    : Math.atan2(targetY - vehicle.y, targetX - vehicle.x)) +
    (context.onRoad ? corner.headingLead : 0)
  // Drift-aware countersteering follows the velocity vector without deleting
  // slip: the tire model still determines whether the car keeps sliding.
  const sideslip = vehicle.speed > SIDESLIP_MIN_SPEED
    ? slipAngle * corner.sideslipGain
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

  const { input, speedAssist } = planAiSpeed({
    vehicle, path, relevantTraffic, difficulty, reversed, direction, tuning,
    hardProfile, ai, context, corner, arcadePavement, bend, sweep, basePace,
    racingPace, slipAngle, roadOffset,
    lateralVelocity, edgeRisk, catchUp,
  })
  const stepped = stepVehicle(
    vehicle,
    { steering: steer, ...input },
    context,
    deltaSeconds,
    speedLimit,
    speedAssist,
  )
  return { ...stepped, ai }
}
