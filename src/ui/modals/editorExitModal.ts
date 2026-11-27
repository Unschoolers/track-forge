import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createEditorExitModal(actions: {
  readonly save: () => void
  readonly saveAs: () => void
  readonly discard: () => void
  readonly cancel: () => void
}, failure?: string | null): HTMLElement {
  const frame = createModalFrame(
    'Unsaved track changes',
    'You have changes that are not saved. What would you like to do?',
    actions.cancel,
    'editor-exit-modal',
  )
  if (failure) {
    const error = element('p', 'editor-exit-error', failure)
    error.setAttribute('role', 'alert')
    frame.body.append(error)
  }
  frame.body.classList.add('menu-buttons')
  frame.body.append(
    button('SAVE', 'editor-exit-save', actions.save, 'button button-primary'),
    button('SAVE AS NEW TRACK', 'editor-exit-save-as', actions.saveAs, 'button'),
    button('DISCARD CHANGES', 'editor-exit-discard', actions.discard, 'button button-danger'),
  )
  frame.footer.append(
    button('CANCEL — KEEP EDITING', 'editor-exit-cancel', actions.cancel, 'button'),
  )
  return frame.overlay
}
