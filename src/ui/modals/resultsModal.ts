import type { RaceResult } from '@/application/race/raceSession'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { createHighScores, createStandings } from '@/ui/components/scoreboard'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createResultsModal(
  result: RaceResult,
  actions: {
    readonly retry: () => void
    readonly edit: () => void
    readonly home: () => void
  },
): HTMLElement {
  const headline = result.outcome === 'water'
    ? 'SUNK'
    : result.outcome === 'wrecked'
      ? 'WRECKED'
      : result.newRecord
      ? 'NEW RECORD'
      : `FINISHED ${result.playerPlace}${ordinalSuffix(result.playerPlace)}`
  const subtitle =
    result.playerTime === null
      ? result.trackName
      : `${result.trackName} · ${formatRaceTime(result.playerTime)}`
  const frame = createModalFrame(headline, subtitle, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  frame.body.append(
    element('h3', 'results-heading', 'STANDINGS'),
    createStandings(result.standings),
    createHighScores(result.highScores),
  )
  frame.footer.append(
    button('EDIT TRACK', 'edit-race-track', actions.edit, 'button'),
    button('HOME', 'results-home', actions.home, 'button'),
    button(
      'RACE AGAIN',
      'retry-race',
      actions.retry,
      'button button-primary',
    ),
  )
  return frame.overlay
}

function ordinalSuffix(place: number): string {
  if (place % 100 >= 11 && place % 100 <= 13) return 'TH'
  if (place % 10 === 1) return 'ST'
  if (place % 10 === 2) return 'ND'
  if (place % 10 === 3) return 'RD'
  return 'TH'
}
