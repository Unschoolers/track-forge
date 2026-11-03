import type { AppSnapshot } from '@/application/appState'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createNameModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly submit: (name: string) => void
  },
): HTMLElement {
  if (state.overlay.type !== 'track-name') {
    throw new Error('Name dialog requires a track-name overlay')
  }
  const renaming = state.overlay.purpose === 'rename'
  const frame = createModalFrame(
    renaming ? 'Rename track' : 'Name your new track',
    'Track names are required and must be unique.',
    actions.close,
  )
  const form = element('form', 'name-form')
  const label = element('label', 'name-label', 'TRACK NAME')
  label.htmlFor = 'track-name-input'
  const input = element('input', 'name-input')
  input.id = 'track-name-input'
  input.name = 'track-name'
  input.maxLength = 32
  input.autocomplete = 'off'
  input.placeholder = 'Example: Midnight Harbor'
  input.value = renaming ? (state.currentTrack?.name ?? '') : ''
  const error = element('div', 'name-error', state.notice ?? '')
  error.setAttribute('role', 'alert')
  const submit = (): void => actions.submit(input.value)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submit()
  })
  form.append(label, input, error)
  frame.body.append(form)
  frame.footer.append(
    button('CANCEL', 'cancel-name', actions.close, 'button'),
    button(
      renaming ? 'SAVE' : 'CONTINUE',
      'save-name',
      submit,
      'button button-primary',
    ),
  )
  return frame.overlay
}
