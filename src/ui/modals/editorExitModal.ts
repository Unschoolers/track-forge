import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createEditorExitModal(actions: {
  readonly save: () => void
  readonly saveAs: () => void
  readonly discard: () => void
  readonly cancel: () => void
}): HTMLElement {
  const frame = createModalFrame(
    'Unsaved track changes',
    'You have changes that are not saved. What would you like to do?',
    actions.cancel,
  )
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
