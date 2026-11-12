import type { RaceControlsPort } from '@/application/ports/input'
import type { SteeringSensitivity } from '@/application/ports/storage'
import { clamp } from '@/domain/geometry/math'

export const STEERING_RANGE_PX = 48
const STEERING_DEAD_ZONE = 0.08
/** More travel near center gives thumbs precise small corrections without losing full lock. */
export function steeringFromDrag(deltaPx: number): number {
  if (!Number.isFinite(deltaPx)) return 0
  const magnitude = Math.min(1, Math.abs(deltaPx) / STEERING_RANGE_PX)
  if (magnitude <= STEERING_DEAD_ZONE) return 0
  const normalized = (magnitude - STEERING_DEAD_ZONE) / (1 - STEERING_DEAD_ZONE)
  return Math.sign(deltaPx) * normalized ** 1.35
}

export interface RacePointerBinding {
  cancel(): void
  destroy(): void
}

/** Pointer coordinates are viewport CSS pixels, independent of canvas resolution. */
export function bindRacePointer(
  target: HTMLElement,
  role: 'steering' | 'brake',
  controls: RaceControlsPort,
  onChange: () => void = () => undefined,
  getSensitivity: () => SteeringSensitivity | undefined = () => 1,
): RacePointerBinding {
  const anchors = new Map<number, number>()

  const end = (id: number): void => {
    if (!anchors.delete(id)) return
    controls.endPointer(id)
    try {
      if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id)
    } catch {
      // The browser may already have discarded this pointer.
    }
    onChange()
  }
  const cancel = (): void => {
    for (const id of anchors.keys()) end(id)
  }
  const unsubscribeReset = controls.onReset(cancel)
  const onDown = (event: PointerEvent): void => {
    if (anchors.has(event.pointerId)) return
    // HUD buttons are separate DOM targets. Accept the whole exposed canvas:
    // a thumb can regrab on either side while another finger holds Brake.
    event.preventDefault()
    anchors.set(event.pointerId, event.clientX)
    // Capture can fail when a pointer has already gone away. Window listeners
    // still receive a release when capture is unavailable.
    try {
      target.setPointerCapture?.(event.pointerId)
    } catch {
      // Keep tracking through the window until release or focus loss.
    }
    if (role === 'steering') controls.beginSteering(event.pointerId, 0)
    else controls.beginBrake(event.pointerId)
    onChange()
  }
  const onMove = (event: PointerEvent): void => {
    const anchor = anchors.get(event.pointerId)
    if (anchor === undefined || role !== 'steering') return
    event.preventDefault()
    const sensitivity = getSensitivity() ?? 1
    const range = STEERING_RANGE_PX / sensitivity
    // Keep the origin one full-lock distance behind the thumb at most,
    // so a reversal reduces steering even after dragging past full lock.
    const delta = event.clientX - anchor
    const travel = Number.isFinite(delta) ? clamp(delta, -range, range) : 0
    if (Number.isFinite(delta) && delta !== travel) {
      anchors.set(event.pointerId, event.clientX - travel)
    }
    controls.updateSteering(event.pointerId, steeringFromDrag(travel * sensitivity))
    onChange()
  }
  const onUp = (event: PointerEvent): void => end(event.pointerId)
  const onOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null && !target.hasPointerCapture?.(event.pointerId)) {
      end(event.pointerId)
    }
  }
  const onVisibility = (): void => {
    if (document.hidden) cancel()
  }

  target.addEventListener('pointerdown', onDown)
  target.addEventListener('lostpointercapture', onUp)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  window.addEventListener('pointerout', onOut)
  window.addEventListener('blur', cancel)
  window.addEventListener('resize', cancel)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    cancel,
    destroy(): void {
      cancel()
      unsubscribeReset()
      target.removeEventListener('pointerdown', onDown)
      target.removeEventListener('lostpointercapture', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('pointerout', onOut)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
