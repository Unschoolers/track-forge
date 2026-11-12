import { AI_OVERTAKE, ROAD_GEOMETRY } from '@/domain/config'
import type { DifficultyId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { TrafficState } from '@/domain/race/ai/traffic'

export function scorePassingLane(
  lane: number,
  traffic: TrafficState,
  difficulty: DifficultyId,
): number {
  const tuning = AI_OVERTAKE[difficulty]
  let score = 100 - Math.abs(lane) * 0.05
  for (const observation of traffic.nearby) {
    const distance = Math.abs(observation.signedDistance)
    const laneGap = Math.abs(observation.vehicle.lane - lane)
    if (
      distance < tuning.triggerDistance &&
      laneGap < tuning.passClearance
    ) {
      score -= (tuning.triggerDistance - distance) * 3
    }
  }
  return score
}

export function choosePassingLane(
  vehicle: RaceVehicle,
  traffic: TrafficState,
  difficulty: DifficultyId,
): number {
  const candidates = ROAD_GEOMETRY.lanes.filter(
    (lane) => lane !== vehicle.lane,
  )
  return candidates.reduce(
    (best, lane) =>
      scorePassingLane(lane, traffic, difficulty) >
      scorePassingLane(best, traffic, difficulty)
        ? lane
        : best,
    candidates[0] ?? vehicle.lane,
  )
}
