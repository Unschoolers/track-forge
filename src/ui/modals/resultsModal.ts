import type { TimeMedal } from '@/application/race/raceRecords'
import { cupRoundCount, cupStandings, type CircuitCup } from '@/application/race/circuitCup'
import type { RaceResult } from '@/application/race/raceSession'
import { button, element } from '@/ui/dom'
import { formatRaceTime, ordinalSuffix } from '@/ui/format'
import { createHighScores, createStandings } from '@/ui/components/scoreboard'
import { createModalFrame, type ModalFrame } from '@/ui/modals/modalFrame'
import { createFinishCelebration, medalForFinish } from '@/ui/components/finishMedal'

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
  playerName?: string,
): HTMLElement {
  const timeTrial = result.mode === 'time-trial'
  const headline = result.outcome === 'water'
    ? 'SUNK'
    : result.outcome === 'wrecked'
      ? 'WRECKED'
      : result.ghostTime !== undefined && result.playerTime !== null
        ? Math.abs(result.playerTime - result.ghostTime) < 0.0005 ? 'GHOST TIED'
          : result.playerTime < result.ghostTime ? 'GHOST BEATEN' : 'GHOST WINS'
      : !timeTrial && result.playerPlace === 1 && result.outcome === 'finished' && result.ghostTime === undefined
      ? 'VICTORY!'
      : result.newRecord
      ? 'NEW RECORD'
      : timeTrial ? 'TIME TRIAL COMPLETE' : `FINISHED ${result.playerPlace}${ordinalSuffix(result.playerPlace)}`
  const hasStandings = result.ghostTime === undefined && !timeTrial && result.standings.length > 0
  const subtitle = result.playerTime === null || hasStandings
    ? result.trackName
    : `${result.trackName} · ${formatRaceTime(result.playerTime)}`
  const frame = createModalFrame(headline, subtitle, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  // The player's name and finish time are already visible in the standings.
  if (playerName && !hasStandings) frame.body.append(element('p', 'modal-subtitle', `DRIVER · ${playerName}`))
  const medal = result.ghostTime === undefined && !timeTrial ? medalForFinish(result.outcome, result.playerPlace) : null
  if (medal) frame.body.append(createFinishCelebration(medal, result.newRecord))
  if (result.playerTime !== null && result.previousBestTime !== undefined) {
    const delta = result.playerTime - result.previousBestTime
    const copy = delta < 0
      ? `${result.newRecord ? 'Personal best by' : 'Faster by'} ${formatRaceTime(-delta)}`
      : delta === 0 ? 'Personal best matched' : `Gap to best: ${formatRaceTime(delta)}`
    frame.body.append(element('p', 'modal-subtitle', copy))
  }
  if (newTimeMedal) frame.body.append(element('p', 'race-finish-medal', `NEW ${newTimeMedal.toUpperCase()} TIME MEDAL`))
  if (result.ghostTime !== undefined) {
    frame.body.append(element('p', 'modal-subtitle', `Ghost target: ${formatRaceTime(result.ghostTime)}`))
  } else if (!timeTrial) {
    frame.body.append(element('h3', 'results-heading', 'STANDINGS'), createStandings(result.standings, result.rivalsFinishing, playerName))
  }
  const detailsBar = element('div', 'results-details-bar')
  addSplitsDetails(frame, result, detailsBar)
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
    detailsBar.append(target, panel)
  } else {
    detailsBar.append(replayStatus)
  }
  frame.body.append(detailsBar)
  // A single freshly recorded time repeats the finish/standings. Keep history
  // available only when there is another run worth comparing.
  if (result.highScores.some(score => result.playerTime === null || Math.abs(score.time - result.playerTime) > 0.0005)) {
    const history = element('details', 'results-history')
    history.append(
      element('summary', 'results-history-toggle', `TOP TIMES · ${result.highScores.length}`),
      createHighScores(result.highScores, false),
    )
    frame.body.append(history)
  }
  if (cupAction) {
    frame.body.append(element('h3', 'results-heading', `CUP STANDINGS · RACE ${cupAction.cup.index + 1}/${cupRoundCount(cupAction.cup)}`))
    for (const [index, driver] of cupStandings(cupAction.cup).entries()) {
      frame.body.append(element('p', 'modal-subtitle', `${index + 1}. ${driver.id === 'player' ? playerName ?? driver.label : driver.label} · ${driver.points} points`))
    }
    frame.footer.append(
      button('LEAVE CUP', 'results-home', actions.home, 'button'),
      button('RETRY', 'retry-race', actions.retry, 'button'),
      button(cupAction.cup.index === cupRoundCount(cupAction.cup) - 1 ? 'FINISH CUP' : 'NEXT RACE', 'next-cup-race', cupAction.next, 'button button-primary'),
    )
    return frame.overlay
  }
  frame.footer.classList.add('results-footer')
  const primary = element('div', 'results-primary-actions')
  primary.append(button('RETRY', 'retry-race', actions.retry, 'button button-primary'))
  if (actions.raceBestGhost) primary.append(
    button('RACE GHOST', 'race-best-ghost', actions.raceBestGhost, 'button'),
  )
  primary.append(button('CHANGE TRACK', 'change-track', actions.changeTrack ?? actions.home, 'button'))
  const secondary = element('div', 'results-secondary')
  secondary.append(
    button('EDIT TRACK', 'edit-race-track', actions.edit, 'button'),
    button('HOME', 'results-home', actions.home, 'button'),
  )
  // All navigation stays fixed even when the results body needs to scroll.
  frame.footer.append(primary, secondary)
  return frame.overlay
}

/**
 * Advanced timing stays out of the results summary. Swap the single dialog's
 * card instead of stacking dialogs, so focus and Escape remain predictable.
 */
function addSplitsDetails(frame: ModalFrame, result: RaceResult, container: HTMLElement): void {
  const splits = result.splits
  if (!splits?.length) return

  const summaryCard = frame.overlay.querySelector<HTMLElement>('.modal-card')
  const details = createModalFrame('RACE SPLITS', result.trackName, undefined, 'results-splits-modal')
  const detailsCard = details.overlay.querySelector<HTMLElement>('.modal-card')
  if (!summaryCard || !detailsCard) throw new Error('Race results modal is missing its dialog card')

  const header = element('div', 'results-splits-columns')
  header.append(
    element('span', undefined, 'CHECKPOINT'),
    element('span', undefined, 'SEGMENT'),
    element('span', undefined, 'ELAPSED'),
  )
  const list = element('div', 'results-splits-list')
  const hint = element('p', 'results-splits-instruction')
  list.append(...splits.map((split, index) => {
    const label = result.routeKind === 'point-to-point'
      ? (split.gate === 4 ? 'FINISH' : `CHECKPOINT ${split.gate}`)
      : `LAP ${split.lap + 1} · ${split.gate === 4 ? 'FINISH' : `CHECKPOINT ${split.gate}`}`
    const segment = split.time - (splits[index - 1]?.time ?? 0)
    const row = element('div', 'results-splits-detail-row')
    row.append(
      element('strong', undefined, label),
      element('span', undefined, formatRaceTime(segment)),
      element('span', undefined, formatRaceTime(split.time)),
    )
    return row
  }))
  details.body.append(hint, header, list)

  let timer: ReturnType<typeof setTimeout> | undefined
  let paused = false
  let overflowing = false
  const stop = (): void => { clearTimeout(timer); timer = undefined }
  const updateHint = (): void => {
    hint.textContent = !overflowing ? `${splits.length} splits recorded`
      : paused ? 'PAUSED · TAP TO RESUME' : 'AUTO-SCROLL · TAP TO PAUSE'
    if (overflowing) {
      list.setAttribute('role', 'button')
      list.setAttribute('tabindex', '0')
      list.setAttribute('aria-pressed', String(paused))
      list.setAttribute('aria-label', paused ? 'Splits paused. Tap to resume.' : 'Splits auto-scrolling. Tap to pause.')
    } else {
      list.removeAttribute('role')
      list.removeAttribute('tabindex')
      list.removeAttribute('aria-pressed')
      list.removeAttribute('aria-label')
    }
  }
  const schedule = (): void => {
    if (paused || !overflowing) return
    timer = setTimeout(() => {
      timer = undefined
      if (!frame.overlay.isConnected || frame.overlay.firstElementChild !== detailsCard || paused) return
      const bottom = list.scrollHeight - list.clientHeight
      const step = list.firstElementChild?.getBoundingClientRect().height || 42
      list.style.scrollBehavior = list.scrollTop >= bottom - 1 ? 'auto' : 'smooth'
      list.scrollTop = list.scrollTop >= bottom - 1 ? 0 : Math.min(bottom, list.scrollTop + step)
      schedule()
    }, 2700)
  }
  const toggle = (): void => {
    if (!overflowing) return
    paused = !paused
    stop()
    updateHint()
    schedule()
  }
  list.addEventListener('click', toggle)
  list.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && overflowing) {
      event.preventDefault()
      toggle()
    }
  })

  const openButton = button(`VIEW SPLITS · ${splits.length}`, 'open-race-splits', () => {
    frame.overlay.replaceChildren(detailsCard)
    frame.overlay.classList.add('results-splits-open')
    frame.overlay.dataset.modal = 'race-splits'
    list.scrollTop = 0
    overflowing = list.scrollHeight > list.clientHeight + 1
    paused = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    updateHint()
    schedule()
    closeButton.focus()
  }, 'button results-splits-action')
  const close = (): void => {
    stop()
    frame.overlay.replaceChildren(summaryCard)
    frame.overlay.classList.remove('results-splits-open')
    frame.overlay.dataset.modal = 'results'
    openButton.focus()
  }
  const closeButton = button('BACK TO RESULTS', 'close-race-splits', close, 'button button-primary')
  details.footer.append(closeButton)
  detailsCard.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  container.append(openButton)
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

export function createCupFinalModal(cup: CircuitCup, finish: () => void, playerName?: string): HTMLElement {
  const frame = createModalFrame('CUP STANDINGS', 'Final results', undefined, 'results-modal')
  frame.overlay.dataset.modal = 'cup-final'
  for (const [index, driver] of cupStandings(cup).entries()) frame.body.append(element('p', 'modal-subtitle', `${index + 1}. ${driver.id === 'player' ? playerName ?? driver.label : driver.label} · ${driver.points} points`))
  frame.footer.append(button('FINISH CUP', 'next-cup-race', finish, 'button button-primary'))
  return frame.overlay
}
