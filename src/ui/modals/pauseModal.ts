import { button } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createPauseModal(actions: {
  readonly resume: () => void
  readonly restart: () => void
  readonly options: () => void
  readonly home: () => void
}): HTMLElement {
  const frame = createModalFrame(
    'Race paused',
    'Controls stay hidden until you resume.',
    undefined,
  )
  frame.body.classList.add('menu-buttons')
  frame.body.append(
    button(
      'RESUME',
      'resume-race',
      actions.resume,
      'button button-primary',
    ),
    button('RESTART RACE', 'restart-race', actions.restart, 'button'),
    button('OPTIONS', 'race-options', actions.options, 'button'),
    button(
      'QUIT TO HOME',
      'quit-race',
      actions.home,
      'button button-danger',
    ),
  )
  return frame.overlay
}
