import type { AppSnapshot } from '@/application/appState'
import type { RaceControlsPort } from '@/application/ports/input'
import type {
  RaceSessionPort,
  RaceSessionSnapshot,
} from '@/application/race/raceSession'
import type { Unsubscribe } from '@/application/eventBus'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'

export interface RaceHudMount {
  readonly element: HTMLElement
  destroy(): void
}

export function createRaceHud(
  _state: AppSnapshot,
  raceSession: RaceSessionPort,
  controls: RaceControlsPort,
  actions: { readonly pause: () => void },
): RaceHudMount {
  const screen = element('section', 'screen race-screen')
  screen.dataset.screen = 'race'
  const hud = element('header', 'race-hud')
  const position = element('div', 'hud-card')
  const positionValue = element('strong', 'hud-value', '1/4')
  positionValue.dataset.racePosition = ''
  position.append(positionValue, element('span', 'label', 'POSITION'))

  const lap = element('div', 'hud-card align-right')
  const lapValue = element('strong', 'hud-value', '1/3')
  lapValue.dataset.raceLap = ''
  const timeValue = element('span', 'label', '00:00.000')
  timeValue.dataset.raceTime = ''
  lap.append(lapValue, timeValue)
  hud.append(position, button('☰', 'pause', actions.pause, 'icon-button'), lap)

  const damage = element('div', 'damage-meter')
  damage.setAttribute('role', 'progressbar')
  damage.setAttribute('aria-label', 'Vehicle damage')
  const damageFill = element('i', 'damage-meter-fill')
  const damageText = element('span', 'label', '0/0')
  damageText.dataset.raceDamage = ''
  damage.append(damageFill, damageText)

  const countdown = element('div', 'race-countdown')
  countdown.dataset.raceCountdown = ''
  countdown.setAttribute('aria-live', 'polite')

  const controlsBar = element('footer', 'race-controls')
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
  controlsBar.append(steering, brake)
  screen.append(hud, damage, countdown, controlsBar)

  const normalizedSteering = (event: PointerEvent): number => {
    const bounds = steering.getBoundingClientRect()
    return Math.max(
      -1,
      Math.min(1, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1),
    )
  }
  const steeringPointers = new Set<number>()
  const brakePointers = new Set<number>()
  const beginSteering = (event: PointerEvent): void => {
    event.preventDefault()
    steeringPointers.add(event.pointerId)
    steering.setPointerCapture?.(event.pointerId)
    const steeringValue = normalizedSteering(event)
    controls.beginSteering(event.pointerId, steeringValue)
    steering.setAttribute('aria-valuenow', steeringValue.toFixed(2))
  }
  const updateSteering = (event: PointerEvent): void => {
    if (!steeringPointers.has(event.pointerId)) return
    event.preventDefault()
    const steeringValue = normalizedSteering(event)
    controls.updateSteering(event.pointerId, steeringValue)
    steering.setAttribute('aria-valuenow', steeringValue.toFixed(2))
  }
  const endSteering = (event: PointerEvent): void => {
    if (!steeringPointers.delete(event.pointerId)) return
    event.preventDefault()
    controls.endPointer(event.pointerId)
    steering.setAttribute('aria-valuenow', '0')
  }
  const beginBrake = (event: PointerEvent): void => {
    event.preventDefault()
    brakePointers.add(event.pointerId)
    brake.setPointerCapture?.(event.pointerId)
    controls.beginBrake(event.pointerId)
    brake.classList.add('pressed')
  }
  const endBrake = (event: PointerEvent): void => {
    if (!brakePointers.delete(event.pointerId)) return
    event.preventDefault()
    controls.endPointer(event.pointerId)
    brake.classList.remove('pressed')
  }
  steering.addEventListener('pointerdown', beginSteering)
  steering.addEventListener('pointermove', updateSteering)
  steering.addEventListener('pointerup', endSteering)
  steering.addEventListener('pointercancel', endSteering)
  brake.addEventListener('pointerdown', beginBrake)
  brake.addEventListener('pointerup', endBrake)
  brake.addEventListener('pointercancel', endBrake)

  const update = (snapshot: RaceSessionSnapshot): void => {
    const telemetry = snapshot.telemetry
    positionValue.textContent = `${telemetry.position}/${Math.max(telemetry.position, telemetry.vehicleCount)}`
    lapValue.textContent = `${Math.min(telemetry.lap + 1, telemetry.totalLaps)}/${telemetry.totalLaps}`
    timeValue.textContent = formatRaceTime(telemetry.elapsed)
    damageText.textContent = `${telemetry.damage}/${telemetry.damageLimit}`
    const damageRatio =
      telemetry.damageLimit > 0
        ? telemetry.damage / telemetry.damageLimit
        : 0
    damageFill.style.width = `${Math.min(1, damageRatio) * 100}%`
    damage.setAttribute('aria-valuemin', '0')
    damage.setAttribute('aria-valuemax', String(telemetry.damageLimit))
    damage.setAttribute('aria-valuenow', String(telemetry.damage))
    countdown.textContent =
      telemetry.phase === 'countdown'
        ? String(Math.max(1, Math.ceil(telemetry.countdown)))
        : telemetry.phase === 'running' && telemetry.elapsed < 0.7
          ? 'GO'
          : ''
    countdown.classList.toggle('visible', countdown.textContent !== '')
  }
  update(raceSession.snapshot())
  let unsubscribe: Unsubscribe | undefined = raceSession.subscribe(update)

  return {
    element: screen,
    destroy(): void {
      unsubscribe?.()
      unsubscribe = undefined
      steeringPointers.clear()
      brakePointers.clear()
      controls.reset()
    },
  }
}
