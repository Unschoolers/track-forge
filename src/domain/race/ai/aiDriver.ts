import type { RandomSource } from '@/application/ports/random'
import { AI_OVERTAKE, DIFFICULTY_SPECS } from '@/domain/config'
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
import type { RoadPath } from '@/domain/track/pathBuilder'

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
      ahead.distance < tuning.triggerDistance * 1.25 &&
      ahead.vehicle.speed + 4 < vehicle.speed
    ) {
      const passLane = choosePassingLane(vehicle, traffic, difficulty)
      if (passLane !== ai.baseLane) {
        return {
          ...ai,
          phase: 'passing',
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
  if (ai.phase === 'passing') {
    const holdRemaining = Math.max(0, ai.holdRemaining - deltaSeconds)
    const clear =
      !ahead || ahead.distance > tuning.completionDistance * 2.2
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
    return { ...ai, holdRemaining, clearTime, cooldownRemaining }
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
    (context.nearest.index + lookAheadSamples) % path.points.length
  const target = path.points[targetIndex]
  if (!target) return { ...vehicle, ai }
  const targetX =
    target.x + context.normal.x * (ai.targetLane + ai.mistakeOffset)
  const targetY =
    target.y + context.normal.y * (ai.targetLane + ai.mistakeOffset)
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
  const curve =
    Math.abs(turnAmountAt(path, targetIndex, 6)) * tuning.cornerSafety
  const curveSpeed = clamp(225 - curve * 230, 92, 225)
  const curveBraking = vehicle.speed > curveSpeed
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
  )
  return { ...stepped, ai }
}
