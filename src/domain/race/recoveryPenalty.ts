import type { RaceVehicle } from '@/domain/race/raceState'

export const RECOVERY_TIME_PENALTY_SECONDS = 0.1

/** Only a recovered car's official time advances; the simulation clock stays untouched. */
export function penalizedRaceTime(elapsed: number, vehicle: RaceVehicle): number {
  return elapsed + (vehicle.recoveryPenaltySeconds ?? 0)
}

/** Add once per recovery, including a finish on the same tick. */
export function addRecoveryTimePenalty(vehicle: RaceVehicle): RaceVehicle {
  return {
    ...vehicle,
    recoveryPenaltySeconds: (vehicle.recoveryPenaltySeconds ?? 0) + RECOVERY_TIME_PENALTY_SECONDS,
  }
}
