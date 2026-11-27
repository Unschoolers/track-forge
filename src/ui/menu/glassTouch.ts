type Press = { button: HTMLButtonElement; bounds: DOMRect }

const clamp = (value: number): number => Math.max(0, Math.min(100, value))

/** Decorative pointer feedback for every native button, including live HUD
 * controls. Never captures a pointer, consumes an event or changes hit areas. */
export function attachGlassTouch(root: HTMLElement): () => void {
  const presses = new Map<number, Press>()

  const paint = ({ button, bounds }: Press, event: PointerEvent) => {
    const x = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width) * 100)
    const y = clamp((event.clientY - bounds.top) / Math.max(1, bounds.height) * 100)
    button.style.setProperty('--glass-touch-x', x.toFixed(1) + '%')
    button.style.setProperty('--glass-touch-y', y.toFixed(1) + '%')
  }

  const release = (id: number) => {
    const press = presses.get(id)
    if (!press) return
    presses.delete(id)
    delete press.button.dataset.glassPressed
  }

  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (!button || !root.contains(button) || button.matches(':disabled, [aria-disabled="true"]')) return
    release(event.pointerId)
    if ([...presses.values()].some(press => press.button === button)) return
    const bounds = button.getBoundingClientRect()
    if (!button.hasAttribute('data-glass-touch')) {
      const position = getComputedStyle(button).position
      if (!position || position === 'static') button.dataset.glassTouchPosition = ''
      const overlay = document.createElement('span')
      overlay.className = 'tf-glass-touch'
      overlay.setAttribute('aria-hidden', 'true')
      button.append(overlay)
      button.dataset.glassTouch = ''
    }
    const press = { button, bounds }
    presses.set(event.pointerId, press)
    paint(press, event)
    button.dataset.glassPressed = ''
  }

  const move = (event: PointerEvent) => {
    const press = presses.get(event.pointerId)
    if (!press) return
    const { button, bounds } = press
    if (!root.contains(button) || button.matches(':disabled, [aria-disabled="true"]')) {
      release(event.pointerId)
      return
    }
    // Race controls retain feedback while their existing pointer capture is held.
    const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    if (outside && !button.hasPointerCapture?.(event.pointerId)) {
      release(event.pointerId)
      return
    }
    paint(press, event)
  }

  const end = (event: PointerEvent) => release(event.pointerId)
  const clear = () => { for (const id of presses.keys()) release(id) }
  root.addEventListener('pointerdown', down, true)
  root.addEventListener('lostpointercapture', end, true)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
  window.addEventListener('blur', clear)

  return () => {
    clear()
    root.removeEventListener('pointerdown', down, true)
    root.removeEventListener('lostpointercapture', end, true)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
    window.removeEventListener('blur', clear)
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-glass-touch]')) {
      button.querySelector(':scope > .tf-glass-touch')?.remove()
      delete button.dataset.glassTouch
      delete button.dataset.glassTouchPosition
      button.style.removeProperty('--glass-touch-x')
      button.style.removeProperty('--glass-touch-y')
    }
  }
}
