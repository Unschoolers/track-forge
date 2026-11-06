import { button } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createEditorMenuModal(actions: {
  readonly close: () => void
  readonly export: () => void
  readonly save: () => void
  readonly rename: () => void
  readonly choose: () => void
  readonly options: () => void
  readonly home: () => void
}): HTMLElement {
  const frame = createModalFrame(
    'Editor menu',
    'Track and application actions.',
    actions.close,
  )
  frame.body.classList.add('menu-buttons')
  frame.body.append(
    button(
      'SAVE TRACK',
      'menu-save',
      actions.save,
      'button button-primary',
    ),
    button('EXPORT TRACK', 'menu-export', actions.export, 'button'),
    button('RENAME TRACK', 'menu-rename', actions.rename, 'button'),
    button('CHOOSE ANOTHER TRACK', 'menu-choose', actions.choose, 'button'),
    button('OPTIONS', 'editor-options', actions.options, 'button'),
    button(
      'RETURN HOME',
      'editor-home',
      actions.home,
      'button button-danger',
    ),
  )
  return frame.overlay
}
