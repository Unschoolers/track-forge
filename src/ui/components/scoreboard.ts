import { scoreCategoryLabel } from '@/application/race/raceRecords'
import type {
  RaceStanding,
} from '@/application/race/raceSession'
import type { ScoreEntry } from '@/application/ports/storage'
import { CAR_SPECS } from '@/domain/config'
import { element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'

export function createStandings(
  standings: readonly RaceStanding[],
): HTMLElement {
  const list = element('ol', 'scoreboard')
  list.dataset.resultsStandings = ''
  for (const standing of standings) {
    const item = element('li', 'scoreboard-row')
    if (standing.player) item.classList.add('player')
    const outcome = standing.wrecked
      ? 'WRECKED'
      : standing.finishTime === null
        ? 'DNF'
        : formatRaceTime(standing.finishTime)
    item.append(
      element('strong', undefined, `${standing.place}. ${CAR_SPECS[standing.car].name}`),
      element('span', undefined, outcome),
    )
    list.append(item)
  }
  return list
}

export function createHighScores(scores: readonly ScoreEntry[]): HTMLElement {
  const section = element('section', 'results-scores')
  section.append(element('h3', 'results-heading', 'TOP TIMES'))
  const list = element('ol', 'scoreboard compact')
  for (const score of scores.slice(0, 5)) {
    const item = element('li', 'scoreboard-row')
    item.append(
      element('strong', undefined, formatRaceTime(score.time)),
      element(
        'span',
        undefined,
        scoreCategoryLabel(score),
      ),
    )
    list.append(item)
  }
  if (scores.length === 0) {
    list.append(element('li', 'empty-state', 'No completed races yet.'))
  }
  section.append(list)
  return section
}
