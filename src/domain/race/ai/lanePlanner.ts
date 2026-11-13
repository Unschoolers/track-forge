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
  preferredSide: -1 | 0 | 1 = 0,
  requireClearance = false,
): number {
  const candidates = ROAD_GEOMETRY.lanes.filter(
    (lane) => lane !== vehicle.lane && (!requireClearance || (Math.abs(lane - vehicle.lane) >= 20 && !traffic.nearby.some(
      (entry) => Math.abs(entry.signedDistance) < 20 && Math.abs(entry.vehicle.lane - lane) < 20,
    ))),
  )
  return candidates.reduce(
    (best, lane) =>
      scorePassingLane(lane, traffic, difficulty) + preferredSide * lane * 0.01 >
      scorePassingLane(best, traffic, difficulty) + preferredSide * best * 0.01
        ? lane
        : best,
    candidates[0] ?? vehicle.lane,
  )
}
