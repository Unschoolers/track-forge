import type { AppSnapshot } from '@/application/appState'
import type { RaceControlsPort } from '@/application/ports/input'
import type {
  RaceSessionPort,
  RaceSessionSnapshot,
} from '@/application/race/raceSession'
import type { Unsubscribe } from '@/application/eventBus'
import { countdownCue } from '@/domain/race/raceState'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { bindRacePointer, STEERING_RANGE_PX } from '@/phaser/input/racePointer'
import { driftCue } from '@/ui/screens/driftCue'

export interface RaceHudMount {
  readonly element: HTMLElement
  destroy(): void
}

export function createRaceHud(
  state: AppSnapshot,
  raceSession: RaceSessionPort,
  controls: RaceControlsPort,
  actions: { readonly pause: () => void },
): RaceHudMount {
  const screen = element('section', 'screen race-screen')
  screen.dataset.screen = 'race'
  const hud = element('header', 'race-hud')
  const position = element('div', 'hud-card race-position')
  const positionValue = element('strong', 'hud-value', '1/4')
  positionValue.dataset.racePosition = ''
  const positionLabel = element('span', 'label', 'POSITION')
  position.append(positionValue, positionLabel)

  const lap = element('div', 'hud-card race-timing align-right')
  const lapValue = element('strong', 'hud-value', '1/3')
  lapValue.dataset.raceLap = ''
  const timeValue = element('span', 'label', '00:00.000')
  timeValue.dataset.raceTime = ''
  const lapTimes = element('span', 'label')
  lapTimes.dataset.raceLapTimes = ''
  const splitTime = element('span', 'label')
  splitTime.dataset.raceSplit = ''
  const gap = element('span', 'label')
  gap.dataset.raceGhostGap = ''
  const pause = button('☰', 'pause', actions.pause, 'icon-button')
  pause.setAttribute('aria-label', raceSession.snapshot().setup?.mode === 'nearby' ? 'Race menu' : 'Pause race')
  position.append(gap)
  lap.append(lapValue, timeValue, lapTimes, splitTime)
  hud.append(position, pause, lap)

  const damage = element('div', 'damage-meter')
  damage.setAttribute('role', 'progressbar')
  damage.setAttribute('aria-label', 'Vehicle damage')
  const damageFill = element('i', 'damage-meter-fill')
  const damageText = element('span', 'label', '0/0')
  damageText.dataset.raceDamage = ''
  damage.append(damageFill, damageText)

  const raceBanner = element('div', 'race-event-banner')
  raceBanner.setAttribute('role', 'status')
  raceBanner.setAttribute('aria-live', 'polite')
  const slide = element('div', 'race-slide-cue')
  slide.dataset.raceDrift = ''
  slide.setAttribute('aria-hidden', 'true')
  const countdown = element('div', 'race-countdown')
  const countdownLights = element('div', 'countdown-lights')
  countdownLights.setAttribute('aria-hidden', 'true')
  for (const color of ['red', 'yellow', 'green']) {
    countdownLights.append(element('i', `countdown-light countdown-light-${color}`))
  }
  const countdownValue = element('span', 'countdown-value')
  countdownValue.dataset.raceCountdown = ''
  countdownValue.setAttribute('aria-live', 'polite')
  countdown.append(countdownLights, countdownValue)

  const controlsBar = element('footer', 'race-controls')
  controlsBar.dataset.layout = state.preferences.steeringLayout ?? 'drag'
  controlsBar.dataset.hand = state.preferences.steeringHand ?? 'left'
  controlsBar.dataset.size = state.preferences.controlSize ?? 'standard'
  const steeringGroup = element('div', 'race-steering')
  const steeringButtons = element('div', 'steering-buttons')
  const left = button('◀', 'steer-left', () => undefined, 'steer-button')
  const right = button('▶', 'steer-right', () => undefined, 'steer-button')
  left.setAttribute('aria-label', 'Steer left')
  right.setAttribute('aria-label', 'Steer right')
  steeringButtons.append(left, right)
  const steering = element('div', 'steering-pad')
  steering.dataset.raceSteering = ''
  steering.setAttribute('role', 'slider')
  steering.setAttribute('aria-label', 'Steering')
  steering.setAttribute('aria-valuemin', '-1')
  steering.setAttribute('aria-valuemax', '1')
  steering.setAttribute('aria-valuenow', '0')
  const steeringThumb = element('i', 'steering-thumb')
  steering.append(steeringThumb)
  const brake = button('BRAKE', 'brake', () => undefined, 'brake-button')
  brake.setAttribute('aria-label', 'Brake')
  const throttle = button('GAS', 'throttle', () => undefined, 'throttle-button')
  throttle.setAttribute('aria-label', 'Accelerate')
  const recoverPlayer = (): void => {
    const state = raceSession.snapshot().state
    if (state?.phase !== 'running' || state.paused) return
    controls.reset()
    updateControls()
    raceSession.resetPlayer()
  }
  const recover = button('RECOVER', 'recover', recoverPlayer, 'button recover-button')
  const checkpointWarning = element('div', 'checkpoint-warning')
  checkpointWarning.dataset.checkpointWarning = ''
  checkpointWarning.hidden = true
  const checkpointMessage = element('strong', 'checkpoint-message')
  const checkpointTimer = element('span', 'checkpoint-timer')
  checkpointTimer.setAttribute('aria-hidden', 'true')
  const checkpointAnnouncement = element('span', 'visually-hidden')
  checkpointAnnouncement.setAttribute('aria-live', 'polite')
  const resetNow = button('RESET NOW', 'reset-checkpoint', () => {
    const current = raceSession.snapshot().state
    if (current?.missedCheckpoint) recoverPlayer()
  }, 'button checkpoint-reset')
  checkpointWarning.append(checkpointMessage, checkpointTimer, resetNow)
  const pedals = element('div', 'race-pedals')
  pedals.append(recover, brake, throttle)
  const steeringHint = element('div', 'touch-steer-hint', '↔ DRAG TO STEER')
  steeringHint.setAttribute('aria-hidden', 'true')
  steeringGroup.append(steering, steeringHint, steeringButtons)
  controlsBar.append(steeringGroup, pedals)
  position.append(damage)
  screen.append(hud, raceBanner, slide, countdown, checkpointWarning, checkpointAnnouncement, controlsBar)

  const updateControls = (): void => {
    const input = controls.snapshot()
    steering.setAttribute('aria-valuenow', input.steering.toFixed(2))
    steeringThumb.style.transform = `translateX(${input.steering * STEERING_RANGE_PX}px)`
    left.classList.toggle('pressed', input.steering < 0)
    right.classList.toggle('pressed', input.steering > 0)
    brake.classList.toggle('pressed', input.braking)
    throttle.classList.toggle('pressed', input.throttle > 0)
  }
  const steeringBinding = bindRacePointer(
    steering, 'steering', controls, updateControls,
    () => state.preferences.steeringSensitivity,
  )
  const leftBinding = bindRacePointer(left, 'left', controls, updateControls)
  const rightBinding = bindRacePointer(right, 'right', controls, updateControls)
  const brakeBinding = bindRacePointer(brake, 'brake', controls, updateControls)
  const throttleBinding = bindRacePointer(throttle, 'throttle', controls, updateControls)
  const bindPedalKeyboard = (target: HTMLButtonElement, pedal: 'brake' | 'throttle'): (() => void) => {
    const keyChange = (event: KeyboardEvent, pressed: boolean): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      // A focused pedal owns its press. Keyup can also clear a global Space
      // press that began before focus moved to the pedal.
      if (pressed) event.stopPropagation()
      if (pressed && (target.disabled || event.repeat)) return
      controls.setPedalKeyboard(pedal, event.key, pressed)
      updateControls()
    }
    const down = (event: KeyboardEvent): void => keyChange(event, true)
    const up = (event: KeyboardEvent): void => keyChange(event, false)
    const blur = (): void => {
      controls.setPedalKeyboard(pedal, ' ', false)
      controls.setPedalKeyboard(pedal, 'Enter', false)
      updateControls()
    }
    target.addEventListener('keydown', down)
    target.addEventListener('keyup', up)
    target.addEventListener('blur', blur)
    return () => {
      blur()
      target.removeEventListener('keydown', down)
      target.removeEventListener('keyup', up)
      target.removeEventListener('blur', blur)
    }
  }
  const bindSteeringKeyboard = (target: HTMLButtonElement, direction: -1 | 1): (() => void) => {
    const change = (event: KeyboardEvent, pressed: boolean): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      if (pressed) event.stopPropagation()
      if (pressed && (event.repeat || target.disabled)) return
      controls.setSteeringButtonKeyboard(direction, event.key, pressed)
      updateControls()
    }
    const down = (event: KeyboardEvent): void => change(event, true)
    const up = (event: KeyboardEvent): void => change(event, false)
    const blur = (): void => {
      controls.setSteeringButtonKeyboard(direction, ' ', false)
      controls.setSteeringButtonKeyboard(direction, 'Enter', false)
      updateControls()
    }
    target.addEventListener('keydown', down)
    target.addEventListener('keyup', up)
    target.addEventListener('blur', blur)
    return () => { blur(); target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); target.removeEventListener('blur', blur) }
  }
  const unbindLeftKeyboard = bindSteeringKeyboard(left, -1)
  const unbindRightKeyboard = bindSteeringKeyboard(right, 1)
  const unbindBrakeKeyboard = bindPedalKeyboard(brake, 'brake')
  const unbindThrottleKeyboard = bindPedalKeyboard(throttle, 'throttle')
  const onBlur = (): void => {
    controls.reset()
    updateControls()
  }
  const onVisibility = (): void => {
    if (document.hidden) onBlur()
  }
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibility)

  let lastPosition: number | null = null
  let lastRunId = raceSession.snapshot().runId
  let lastLap: number | null = null
  let bannerUntil = 0
  let finalLapNotice = false
  let previousHandling: string | undefined
  let previousPaused: boolean | undefined
  let previousPhase: RaceSessionSnapshot['telemetry']['phase'] | undefined
  const announce = (
    label: string,
    title: string,
    detail: string,
    kind: 'gain' | 'lead' | 'loss' | 'lap',
    now: number,
    duration: number,
  ): void => {
    raceBanner.dataset.kind = kind
    // Fresh children restart the one-shot motion even for quick consecutive passes.
    raceBanner.replaceChildren(
      element('span', 'race-event-kicker', label),
      element('strong', 'race-event-title', title),
      element('span', 'race-event-detail', detail),
    )
    bannerUntil = now + duration
  }
  const update = (snapshot: RaceSessionSnapshot): void => {
    if (snapshot.runId !== lastRunId) {
      lastRunId = snapshot.runId
      lastPosition = null
      lastLap = null
      bannerUntil = 0
      finalLapNotice = false
    }
    const handling = snapshot.setup?.handling ?? 'arcade'
    const paused = snapshot.state?.paused ?? false
    const phase = snapshot.telemetry.phase
    if ((previousHandling !== undefined && handling !== previousHandling) ||
      (previousPaused !== undefined && paused !== previousPaused) ||
      (previousPhase !== undefined && phase !== previousPhase && (phase === 'finished' || previousPhase === 'finished'))) {
      controls.reset()
    }
    previousHandling = handling
    previousPaused = paused
    previousPhase = phase
    left.disabled = paused || phase === 'finished'
    right.disabled = paused || phase === 'finished'
    throttle.disabled = paused || phase === 'finished'
    brake.disabled = paused || phase === 'finished'
    throttle.hidden = handling !== 'simulation'
    pedals.classList.toggle('simulation', handling === 'simulation')
    updateControls()
    recover.disabled = snapshot.state?.phase !== 'running' || snapshot.state.paused
    const telemetry = snapshot.telemetry
    const missed = snapshot.state?.missedCheckpoint
    checkpointWarning.hidden = !missed || phase !== 'running' || paused
    resetNow.disabled = checkpointWarning.hidden
    if (missed && !checkpointWarning.hidden) {
      const message = `MISSED CHECKPOINT ${missed.gate}`
      if (checkpointMessage.textContent !== message) {
        checkpointMessage.textContent = message
        checkpointAnnouncement.textContent = `Missed checkpoint ${missed.gate}. Return to the checkpoint or reset now.`
      }
      const timerLabel = `Reset in ${Math.max(0, Math.ceil(missed.remainingSeconds))} s`
      if (checkpointTimer.textContent !== timerLabel) checkpointTimer.textContent = timerLabel
    } else {
      if (checkpointMessage.textContent) checkpointMessage.textContent = ''
      if (checkpointAnnouncement.textContent) checkpointAnnouncement.textContent = ''
    }
    const player = snapshot.state?.vehicles.find((car) => car.player)
    const cue = driftCue(player, telemetry.phase, snapshot.state?.paused ?? false)
    slide.textContent = cue ?? ''
    slide.classList.toggle('visible', cue !== null)
    const now = performance.now()
    const racing = phase === 'running' && !paused && telemetry.elapsed >= 0.7
    if (!racing) {
      bannerUntil = 0
      finalLapNotice = false
    } else if (telemetry.routeKind !== 'point-to-point' && lastLap !== null && telemetry.lap > lastLap &&
      telemetry.lap + 1 === telemetry.totalLaps) {
      finalLapNotice = true
      announce('THE DECIDING LAP', 'FINAL LAP!', 'EVERY SECOND COUNTS', 'lap', now, 1450)
    } else if (
      lastPosition !== null &&
      telemetry.position !== lastPosition &&
      (snapshot.setup?.mode ?? 'normal') === 'normal' &&
      telemetry.vehicleCount > 1 &&
      (!finalLapNotice || now >= bannerUntil)
    ) {
      finalLapNotice = false
      const gained = lastPosition - telemetry.position
      const count = Math.abs(gained)
      const detail = `${count} PLACE${count === 1 ? '' : 'S'} ${gained > 0 ? 'GAINED' : 'LOST'} · P${telemetry.position}/${telemetry.vehicleCount}`
      if (gained > 0) {
        const lead = telemetry.position === 1
        announce(lead ? 'YOU OWN THE FRONT' : 'NICE MOVE', lead ? 'LEAD TAKEN!' : 'OVERTAKE!', detail, lead ? 'lead' : 'gain', now, 1650)
      } else {
        announce('FIGHT BACK', 'YOU GOT PASSED!', detail, 'loss', now, 1400)
      }
    }
    const showBanner = racing && now < bannerUntil
    raceBanner.classList.toggle('visible', showBanner)
    if (!showBanner && raceBanner.textContent) raceBanner.replaceChildren()
    lastPosition = telemetry.position
    lastLap = telemetry.lap
    const ghostRace = snapshot.setup?.mode === 'ghost' && snapshot.ghostTime !== undefined
    const openRoute = telemetry.routeKind === 'point-to-point'
    const timeTrial = snapshot.setup?.mode === 'time-trial'
    const nearby = snapshot.setup?.mode === 'nearby'
    positionValue.textContent = nearby ? 'LIVE' : timeTrial ? 'SOLO' : ghostRace
      ? formatRaceTime(snapshot.ghostTime ?? 0)
      : `${telemetry.position}/${Math.max(telemetry.position, telemetry.vehicleCount)}`
    positionLabel.textContent = nearby ? 'NEARBY' : timeTrial ? 'TIME TRIAL' : ghostRace ? 'GHOST TARGET' : 'POSITION'
    lapValue.textContent = openRoute ? `${Math.round(Math.max(0, Math.min(1, telemetry.routeProgress ?? 0)) * 100)}%` : `${Math.min(telemetry.lap + 1, telemetry.totalLaps)}/${telemetry.totalLaps}`
    timeValue.textContent = formatRaceTime(telemetry.elapsed)
    const bestLap = telemetry.bestLapTime
    lapTimes.textContent = openRoute || bestLap == null || ghostRace ? '' : `BEST ${formatRaceTime(bestLap)}`
    lapTimes.hidden = !lapTimes.textContent
    const split = telemetry.latestSplit
    const splitLabel = split?.gate === 4 ? (openRoute ? 'FINISH' : `LAP ${split.lap + 1}`) : `CP ${split?.gate ?? ''}`
    splitTime.textContent = !missed && telemetry.missedCheckpoint !== undefined
      ? `MISSED CP ${telemetry.missedCheckpoint}`
      : split ? `${splitLabel} ${formatRaceTime(split.time)}` : ''
    splitTime.hidden = !splitTime.textContent
    const delta = telemetry.ghostGap
    gap.textContent = ghostRace && delta != null
      ? `GAP ${delta >= 0 ? '+' : '−'}${formatRaceTime(Math.abs(delta))}` : ''
    gap.hidden = !gap.textContent
    damage.hidden = handling !== 'simulation'
    damageText.textContent = `${telemetry.damage}/${telemetry.damageLimit}`
    const damageRatio =
      telemetry.damageLimit > 0
        ? telemetry.damage / telemetry.damageLimit
        : 0
    damageFill.style.width = `${Math.min(1, damageRatio) * 100}%`
    damage.setAttribute('aria-valuemin', '0')
    damage.setAttribute('aria-valuemax', String(telemetry.damageLimit))
    damage.setAttribute('aria-valuenow', String(telemetry.damage))
    const countdownText =
      telemetry.waitingForStart
        ? 'WAIT'
        : telemetry.phase === 'countdown'
          ? String(countdownCue(telemetry.countdown)).toUpperCase()
        : telemetry.phase === 'running' && telemetry.elapsed < 0.7
          ? 'GO'
          : ''
    if (countdownValue.textContent !== countdownText) countdownValue.textContent = countdownText
    countdown.dataset.signal = countdownText === 'GO' ? 'green' : countdownText === '3' ? 'red' : countdownText ? 'yellow' : ''
    countdown.classList.toggle('visible', countdownText !== '')
  }
  update(raceSession.snapshot())
  let unsubscribe: Unsubscribe | undefined = raceSession.subscribe(update)

  return {
    element: screen,
    destroy(): void {
      unsubscribe?.()
      unsubscribe = undefined
      steeringBinding.destroy()
      leftBinding.destroy()
      rightBinding.destroy()
      brakeBinding.destroy()
      throttleBinding.destroy()
      unbindLeftKeyboard()
      unbindRightKeyboard()
      unbindBrakeKeyboard()
      unbindThrottleKeyboard()
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      controls.reset()
    },
  }
}
