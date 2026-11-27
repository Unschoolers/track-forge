import { button } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createAppExitModal(stay: () => void, exit?: () => Promise<void>): HTMLElement {
  const frame = createModalFrame('Exit Track Forge?', 'Ready to leave the game?', undefined, 'app-exit-modal')
  frame.body.setAttribute('role', 'alert')
  const cancel = button('Stay', 'app-exit-stay', stay, 'button')
  const confirm = button('Exit', 'app-exit-confirm', () => {
    if (!exit) {
      frame.body.textContent = 'Native app exit is unavailable.'
      return
    }
    confirm.disabled = true
    frame.body.textContent = ''
    void exit().catch((error: unknown) => {
      console.error('Track Forge app exit failed', error)
      frame.body.textContent = error instanceof Error ? error.message : 'Could not exit Track Forge.'
      confirm.disabled = false
    })
  }, 'button button-primary')
  frame.footer.append(cancel, confirm)
  return frame.overlay
}
