import type { RandomSource } from '@/application/ports/random'
import { AI_OVERTAKE, CAR_SPECS, DIFFICULTY_SPECS } from '@/domain/config'
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
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { safeEntrySpeedAhead } from '@/domain/race/ai/cornerSpeed'
import type { RoadPath } from '@/domain/track/pathBuilder'

const BEND_LOOKAHEAD = [0, 6, 12, 20, 30]
const CENTER_LINE_TURN = 0.28
const LANE_CHANGE_LOOKAHEAD = 24
const LANE_CHANGE_CLEARANCE = 18

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
): RaceVehicle {
  if (path.points.length === 0) return vehicle
  const tuning = DIFFICULTY_SPECS[difficulty]
  let ai = vehicle.ai ?? createAiDriverState(vehicle.lane)
  ai = advancePassingState(vehicle, ai, traffic, difficulty, deltaSeconds)
  ai = advanceMistake(ai, difficulty, deltaSeconds, random)

  const context = getVehicleStepContext(path, vehicle)
  // A dynamic chassis needs a speed-scaled pursuit point on the road. When an
  // AI misses the surface, shorten the target so it returns instead of drawing
  // an enormous high-speed arc around a distant point.
  const lookAheadSamples = Math.round(
    context.onRoad
      ? clamp(5 + vehicle.speed / 18 + tuning.lookAhead, 5, 22)
      : 3,
  )
  const targetIndex =
    (context.nearest.index + (reversed ? -lookAheadSamples : lookAheadSamples) + path.points.length) % path.points.length
  const target = path.points[targetIndex]
  if (!target) return { ...vehicle, ai }
  let bend = 0
  const direction = reversed ? -1 : 1
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
  const pursuitLane = occupied ? lane : centered
  const targetX = target.x + context.normal.x * pursuitLane
  const targetY = target.y + context.normal.y * pursuitLane
  const desiredAngle = Math.atan2(targetY - vehicle.y, targetX - vehicle.x)
  const desiredSteer = clamp(
    wrapAngle(desiredAngle - vehicle.angle) * tuning.steerGain -
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
  // Brake for the tightest upcoming bend, not just one moving pursuit point.
  const curveSpeed = safeEntrySpeedAhead(
    path, context.nearest.index, reversed, tuning.cornerSafety,
    CAR_SPECS[vehicle.car], tuning.pace * vehicle.aiPace, vehicle.car,
  )
  const curveBraking = vehicle.speed > curveSpeed + 3
  const recovering = !context.onRoad
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
            : tuning.pace * vehicle.aiPace,
      braking:
        emergency ||
        curveBraking ||
        (recovering &&
          context.nearest.distance > 72 &&
          vehicle.speed > 90),
    },
    context,
    deltaSeconds,
    'simulation',
    speedLimit,
  )
  return { ...stepped, ai }
}
