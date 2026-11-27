// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachGlassTouch } from '@/ui/menu/glassTouch'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.replaceChildren()
})

function pointer(target: EventTarget, type: string, id: number, x = 25, y = 10) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: id })
  target.dispatchEvent(event)
  return event
}

function setup() {
  const root = document.createElement('div')
  root.innerHTML = '<button class="button"><span>Race</span></button><button class="brake-button">Brake</button><button disabled>Disabled</button>'
  document.body.append(root)
  const buttons = [...root.querySelectorAll('button')]
  for (const button of buttons) vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 40))
  cleanup = attachGlassTouch(root)
  return { root, buttons }
}

describe('shared glass touch', () => {
  it('follows the contact on any button without consuming its events or click', () => {
    const { buttons } = setup()
    const [action, brake] = buttons
    if (!action || !brake) throw new Error('Missing buttons')
    const click = vi.fn()
    action.addEventListener('click', click)
    const event = pointer(action.firstElementChild ?? action, 'pointerdown', 1)
    expect(event.defaultPrevented).toBe(false)
    expect(action.dataset.glassPressed).toBe('')
    expect(action.style.getPropertyValue('--glass-touch-x')).toBe('25.0%')
    pointer(action, 'pointermove', 1, 75, 20)
    expect(action.style.getPropertyValue('--glass-touch-x')).toBe('75.0%')
    pointer(brake, 'pointerdown', 2)
    expect(brake.dataset.glassPressed).toBe('')
    pointer(window, 'pointerup', 1)
    expect(action.dataset.glassPressed).toBeUndefined()
    expect(brake.dataset.glassPressed).toBe('')
    action.click()
    expect(click).toHaveBeenCalledOnce()
    pointer(window, 'pointercancel', 2)
    expect(brake.dataset.glassPressed).toBeUndefined()
  })

  it('ignores disabled buttons and cleans up on cancellation, blur and teardown', () => {
    const { root, buttons } = setup()
    const [action, , disabled] = buttons
    if (!action || !disabled) throw new Error('Missing buttons')
    pointer(disabled, 'pointerdown', 1)
    expect(disabled.dataset.glassTouch).toBeUndefined()
    pointer(action, 'pointerdown', 2)
    pointer(action, 'pointermove', 2, 150, 20)
    expect(action.dataset.glassPressed).toBeUndefined()
    pointer(action, 'pointerdown', 3)
    window.dispatchEvent(new Event('blur'))
    expect(action.dataset.glassPressed).toBeUndefined()
    pointer(action, 'pointerdown', 4)
    cleanup?.()
    cleanup = undefined
    expect(root.querySelector('.tf-glass-touch')).toBeNull()
    expect(action.dataset.glassPressed).toBeUndefined()
    expect(action.dataset.glassTouch).toBeUndefined()
    pointer(action, 'pointerdown', 5)
    expect(action.dataset.glassTouch).toBeUndefined()
  })
})
