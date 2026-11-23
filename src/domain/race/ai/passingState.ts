import { AI_OVERTAKE } from '@/domain/config'
import { CAR_DRIVING_PROFILES } from '@/domain/race/ai/aiCarDrivingProfiles'
import type { DifficultyId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { AiDriverState } from '@/domain/race/ai/aiState'
import type { TrafficState } from '@/domain/race/ai/traffic'
import { choosePassingLane } from '@/domain/race/ai/lanePlanner'

/** Pure overtake state machine. Vehicle integration remains in the AI driver. */
export function advancePassingState(
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
    // Red's high straight-line speed and limited grip make a futile, wide
    // pass costly. Only its calibrated profile opts into an early abort.
    // Keep the lane hold and clear base-lane requirement for every car.
    const abortScale = CAR_DRIVING_PROFILES[vehicle.car].lostPassAbortDistanceScale
    const targetLost = abortScale !== undefined && target !== undefined &&
      target.signedDistance > tuning.triggerDistance * abortScale
    // Other cars retain the stable eight-second fallback until calibrated.
    const clear = destinationClear && (targetClear || targetLost || passElapsed > 8)
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

