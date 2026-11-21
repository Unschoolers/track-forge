import type { RaceOutcome } from '@/domain/race/raceState'
import { element } from '@/ui/dom'

export type RaceMedal = 'GOLD' | 'SILVER' | 'BRONZE'

export function medalForFinish(outcome: RaceOutcome, position: number): RaceMedal | null {
  if (outcome !== 'finished') return null
  if (position === 1) return 'GOLD'
  if (position === 2) return 'SILVER'
  if (position === 3) return 'BRONZE'
  return null
}

/** Shared single-player / nearby podium visual, without coupling either race mode to the other. */
export function createFinishCelebration(medal: RaceMedal, newRecord = false): HTMLElement {
  const podium = element('section', 'results-celebration')
  podium.dataset.medal = medal
  podium.dataset.resultCelebration = medal === 'GOLD' ? 'victory' : 'podium'
  const sparkles = element('div', 'results-celebration-sparks')
  sparkles.setAttribute('aria-hidden', 'true')
  if (medal === 'GOLD') {
    for (let i = 0; i < 8; i += 1) sparkles.append(element('i'))
  }
  const accolade = medal === 'GOLD' ? 'CHAMPION' : medal === 'SILVER' ? 'BRILLIANT DRIVE' : 'ON THE PODIUM'
  const placement = medal === 'GOLD' ? '1ST PLACE' : medal === 'SILVER' ? '2ND PLACE' : '3RD PLACE'
  podium.append(
    sparkles,
    element('span', 'results-celebration-kicker', accolade),
    element('strong', 'results-celebration-place', placement),
    element('span', 'results-celebration-detail', medal === 'GOLD' ? 'YOU WON THE RACE' : 'YOU EARNED YOUR MEDAL'),
  )
  if (newRecord) podium.append(element('span', 'results-celebration-record', '★ NEW RECORD'))
  return podium
}
