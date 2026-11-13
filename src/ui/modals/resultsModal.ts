import type { TimeMedal } from '@/application/race/raceRecords'
import { CUP_CIRCUITS, cupStandings, type CircuitCup } from '@/application/race/circuitCup'
import type { RaceResult } from '@/application/race/raceSession'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { createHighScores, createStandings } from '@/ui/components/scoreboard'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { medalForFinish } from '@/ui/components/finishMedal'

export function createResultsModal(
  result: RaceResult,
  actions: {
    readonly retry: () => void
    readonly raceBestGhost?: (() => void) | undefined
    readonly changeTrack?: () => void
    readonly edit: () => void
    readonly home: () => void
  },
  cupAction?: { readonly cup: CircuitCup; readonly next: () => void },
  newTimeMedal?: TimeMedal | null,
): HTMLElement {
  const headline = result.outcome === 'water'
    ? 'SUNK'
    : result.outcome === 'wrecked'
      ? 'WRECKED'
      : result.ghostTime !== undefined && result.playerTime !== null
        ? Math.abs(result.playerTime - result.ghostTime) < 0.0005 ? 'GHOST TIED'
          : result.playerTime < result.ghostTime ? 'GHOST BEATEN' : 'GHOST WINS'
      : result.newRecord
      ? 'NEW RECORD'
      : `FINISHED ${result.playerPlace}${ordinalSuffix(result.playerPlace)}`
  const subtitle =
    result.playerTime === null
      ? result.trackName
      : `${result.trackName} · ${formatRaceTime(result.playerTime)}`
  const frame = createModalFrame(headline, subtitle, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  const medal = result.ghostTime === undefined ? medalForFinish(result.outcome, result.playerPlace) : null
  if (result.playerTime !== null && result.previousBestTime !== undefined) {
    const delta = result.playerTime - result.previousBestTime
    const copy = delta < 0
      ? `${result.newRecord ? 'Personal best by' : 'Faster by'} ${formatRaceTime(-delta)}`
      : delta === 0 ? 'Personal best matched' : `Gap to best: ${formatRaceTime(delta)}`
    frame.body.append(element('p', 'modal-subtitle', copy))
  }
  if (medal) {
    frame.body.append(element('p', 'race-finish-medal', `${medal} MEDAL`))
  }
  if (newTimeMedal) frame.body.append(element('p', 'race-finish-medal', `NEW ${newTimeMedal.toUpperCase()} TIME MEDAL`))
  if (result.ghostTime !== undefined) {
    frame.body.append(element('p', 'modal-subtitle', `Ghost target: ${formatRaceTime(result.ghostTime)}`))
  } else {
    frame.body.append(element('h3', 'results-heading', 'STANDINGS'), createStandings(result.standings))
  }
  if (result.scoreSaveFailed) {
    frame.body.append(element('p', 'modal-subtitle', 'Race time could not be saved on this device.'))
  }
  if (result.ghostSaveFailed) {
    frame.body.append(element('p', 'modal-subtitle', 'Replay could not be saved on this device.'))
  }
  if (result.ghostSaved) {
    frame.body.append(element('p', 'modal-subtitle ghost-save-status', 'BEST GHOST SAVED'))
  } else if (result.savedGhostTime !== undefined) {
    frame.body.append(element('p', 'modal-subtitle', `Best ghost ready: ${formatRaceTime(result.savedGhostTime)}`))
  } else if (result.ghostSaved === false && !result.ghostSaveFailed) {
    frame.body.append(element('p', 'modal-subtitle', 'Replay could not be saved on this device.'))
  }
  frame.body.append(createHighScores(result.highScores))
  if (cupAction) {
    frame.body.append(element('h3', 'results-heading', `CUP STANDINGS · RACE ${cupAction.cup.index + 1}/${CUP_CIRCUITS.length}`))
    for (const [index, driver] of cupStandings(cupAction.cup).entries()) {
      frame.body.append(element('p', 'modal-subtitle', `${index + 1}. ${driver.label} · ${driver.points} points`))
    }
    frame.footer.append(
      button('LEAVE CUP', 'results-home', actions.home, 'button'),
      button('RETRY', 'retry-race', actions.retry, 'button'),
      button(cupAction.cup.index === CUP_CIRCUITS.length - 1 ? 'FINISH CUP' : 'NEXT RACE', 'next-cup-race', cupAction.next, 'button button-primary'),
    )
    return frame.overlay
  }
  frame.footer.append(button('RETRY', 'retry-race', actions.retry, 'button button-primary'))
  if (actions.raceBestGhost) frame.footer.append(
    button('RACE GHOST', 'race-best-ghost', actions.raceBestGhost, 'button'),
  )
  const secondary = element('div', 'results-secondary')
  secondary.append(
    button('EDIT TRACK', 'edit-race-track', actions.edit, 'button'),
    button('HOME', 'results-home', actions.home, 'button'),
  )
  frame.body.append(secondary)
  frame.footer.append(button('CHANGE TRACK', 'change-track', actions.changeTrack ?? actions.home, 'button'))
  return frame.overlay
}

function ordinalSuffix(place: number): string {
  if (place % 100 >= 11 && place % 100 <= 13) return 'TH'
  if (place % 10 === 1) return 'ST'
  if (place % 10 === 2) return 'ND'
  if (place % 10 === 3) return 'RD'
  return 'TH'
}

export function createCupFinalModal(cup: CircuitCup, finish: () => void): HTMLElement {
  const frame = createModalFrame('CUP STANDINGS', 'Final results', undefined, 'results-modal')
  frame.overlay.dataset.modal = 'cup-final'
  for (const [index, driver] of cupStandings(cup).entries()) frame.body.append(element('p', 'modal-subtitle', `${index + 1}. ${driver.label} · ${driver.points} points`))
  frame.footer.append(button('FINISH CUP', 'next-cup-race', finish, 'button button-primary'))
  return frame.overlay
}
