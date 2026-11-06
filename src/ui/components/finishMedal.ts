import type { RaceOutcome } from '@/domain/race/raceState'

export type RaceMedal = 'GOLD' | 'SILVER' | 'BRONZE'

export function medalForFinish(outcome: RaceOutcome, position: number): RaceMedal | null {
  if (outcome !== 'finished') return null
  if (position === 1) return 'GOLD'
  if (position === 2) return 'SILVER'
  if (position === 3) return 'BRONZE'
  return null
}
