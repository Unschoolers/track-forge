import type { AppSnapshot } from '@/application/appState'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { normalizeDisplayName } from '@/domain/track/trackCreator'

export function createPlayerNameModal(state: AppSnapshot, submit: (name: string) => void): HTMLElement {
  const frame = createModalFrame(
    'Choose your player name',
    'This is how other racers will see your track creations. You can change it later in Options.',
    undefined,
    'player-name-modal',
  )
  const form = element('form', 'name-form')
  const label = element('label', 'name-label', 'PLAYER NAME')
  label.htmlFor = 'player-name-input'
  const input = element('input', 'name-input')
  input.id = 'player-name-input'
  input.name = 'player-name'
  input.maxLength = 24
  input.autocomplete = 'nickname'
  input.placeholder = 'Example: JulienQC'
  const error = element('div', 'name-error', state.notice ?? '')
  error.setAttribute('role', 'alert')
  const submitName = () => {
    if (!normalizeDisplayName(input.value)) {
      error.textContent = 'Use 2–24 letters, numbers or simple punctuation.'
      return
    }
    submit(input.value)
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); submitName() })
  form.append(label, input, error)
  frame.body.append(form, element('p', 'modal-subtitle', 'Existing uncredited tracks on this device will be credited to you. Previously imported uncredited tracks cannot be identified automatically.'))
  frame.footer.append(button('LET\'S RACE', 'confirm-player-name', submitName, 'button button-primary'))
  return frame.overlay
}
