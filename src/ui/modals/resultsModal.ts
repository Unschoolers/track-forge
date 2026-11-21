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
    readonly exportRace?: (() => void) | undefined
    readonly diagnosticsOpened?: (() => void) | undefined
    readonly changeTrack?: () => void
    readonly edit: () => void
    readonly home: () => void
  },
  cupAction?: { readonly cup: CircuitCup; readonly next: () => void },
  newTimeMedal?: TimeMedal | null,
): HTMLElement {
  const timeTrial = result.mode === 'time-trial'
  const headline = result.outcome === 'water'
    ? 'SUNK'
    : result.outcome === 'wrecked'
      ? 'WRECKED'
      : result.ghostTime !== undefined && result.playerTime !== null
        ? Math.abs(result.playerTime - result.ghostTime) < 0.0005 ? 'GHOST TIED'
          : result.playerTime < result.ghostTime ? 'GHOST BEATEN' : 'GHOST WINS'
      : result.newRecord
      ? 'NEW RECORD'
      : timeTrial ? 'TIME TRIAL COMPLETE' : `FINISHED ${result.playerPlace}${ordinalSuffix(result.playerPlace)}`
  const subtitle =
    result.playerTime === null
      ? result.trackName
      : `${result.trackName} · ${formatRaceTime(result.playerTime)}`
  const frame = createModalFrame(headline, subtitle, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  const medal = result.ghostTime === undefined && !timeTrial ? medalForFinish(result.outcome, result.playerPlace) : null
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
  } else if (!timeTrial) {
    frame.body.append(element('h3', 'results-heading', 'STANDINGS'), createStandings(result.standings, result.rivalsFinishing))
  }
  if (result.splits?.length) {
    frame.body.append(element('h3', 'results-heading', 'SPLITS'))
    for (const split of result.splits) {
      const label = result.routeKind === 'point-to-point' ? (split.gate === 4 ? 'FINISH' : `CHECKPOINT ${split.gate}`) : `LAP ${split.lap + 1} · ${split.gate === 4 ? 'FINISH' : `CHECKPOINT ${split.gate}`}`
      frame.body.append(element('p', 'modal-subtitle', `${label} · ${formatRaceTime(split.time)}`))
    }
  }
  if (result.scoreSaveFailed) {
    frame.body.append(element('p', 'modal-subtitle', 'Race time could not be saved on this device.'))
  }
  if (result.ghostSaveFailed) {
    frame.body.append(element('p', 'modal-subtitle', 'Replay could not be saved on this device.'))
  }
  const replayStatus = result.ghostSaved
    ? element('p', 'modal-subtitle ghost-save-status', 'BEST GHOST SAVED')
    : result.savedGhostTime !== undefined
      ? element('p', 'modal-subtitle', `Best ghost ready: ${formatRaceTime(result.savedGhostTime)}`)
      : element('p', 'modal-subtitle race-diagnostics-label', 'RACE DATA READY')
  if (result.ghostSaved === false && !result.ghostSaveFailed) {
    frame.body.append(element('p', 'modal-subtitle', 'Best ghost could not be saved on this device.'))
  }
  if (actions.exportRace) {
    const target = element('div', 'race-diagnostics-target')
    target.dataset.action = 'race-diagnostics'
    target.setAttribute('role', 'button')
    target.setAttribute('tabindex', '0')
    target.setAttribute('aria-label', 'Race diagnostics. Press and hold to open.')
    target.append(replayStatus)
    const panel = element('div', 'race-diagnostics-panel')
    panel.hidden = true
    panel.append(
      element('p', 'modal-subtitle', 'ADVANCED · ALL-CAR RACE REPLAY'),
      element('p', 'modal-subtitle', 'Includes the track, player, rivals and AI telemetry.'),
      button('EXPORT RACE FILE', 'export-race-diagnostics', actions.exportRace, 'button button-primary'),
      button('CLOSE', 'close-race-diagnostics', () => { panel.hidden = true }),
    )
    const open = (): void => {
      if (!target.isConnected || !panel.hidden) return
      panel.hidden = false
      actions.diagnosticsOpened?.()
    }
    bindDiagnosticsHold(target, open)
    frame.body.append(target, panel)
  } else {
    frame.body.append(replayStatus)
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

/** Hidden on mobile (800 ms hold); right-click and keyboard remain accessible on desktop. */
function bindDiagnosticsHold(target: HTMLElement, open: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pointerId: number | undefined
  let startX = 0
  let startY = 0
  const cancel = (): void => {
    clearTimeout(timer)
    timer = undefined
    pointerId = undefined
  }
  target.addEventListener('pointerdown', event => {
    if (pointerId !== undefined || event.button !== 0) { cancel(); return }
    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    timer = setTimeout(() => {
      timer = undefined
      pointerId = undefined
      open()
    }, 800)
  })
  target.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 12) cancel()
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    target.addEventListener(type, cancel)
  }
  target.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); open() })
  target.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  })
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
