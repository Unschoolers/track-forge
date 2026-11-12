import type { AppSnapshot } from '@/application/appState'
import { createToggleRow } from '@/ui/components/toggleRow'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createOptionsModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly preferences: (preferences: AppSnapshot['preferences']) => void
  },
): HTMLElement {
  const frame = createModalFrame(
    'Options',
    'Comfort and feedback settings.',
    actions.close,
  )
  frame.body.append(
    createToggleRow(
      'Sound',
      'Engine, tires, impacts, and UI sounds.',
      state.preferences.audioEnabled,
      'toggle-audio',
      () =>
        actions.preferences({
          ...state.preferences,
          audioEnabled: !state.preferences.audioEnabled,
        }),
    ),
    createToggleRow(
      'Haptics',
      'Surface, curb, and collision vibration.',
      state.preferences.hapticsEnabled,
      'toggle-haptics',
      () =>
        actions.preferences({
          ...state.preferences,
          hapticsEnabled: !state.preferences.hapticsEnabled,
        }),
    ),
    createToggleRow(
      'Dynamic zoom',
      'Zoom in for curves and out on long straights.',
      state.preferences.dynamicZoomEnabled,
      'toggle-zoom',
      () =>
        actions.preferences({
          ...state.preferences,
          dynamicZoomEnabled:
            !state.preferences.dynamicZoomEnabled,
        }),
    ),
  )
  const steering = element('section', 'setup-section')
  steering.append(element('h3', 'setup-label', 'Steering sensitivity'))
  const choices = element('div', 'choice-row')
  choices.setAttribute('role', 'group')
  choices.setAttribute('aria-label', 'Steering sensitivity')
  for (const [label, value] of [['Low', 0.75], ['Normal', 1], ['High', 1.5]] as const) {
    const selected = (state.preferences.steeringSensitivity ?? 1) === value
    const choice = button(
      label,
      `steering-sensitivity-${label.toLowerCase()}`,
      () => actions.preferences({ ...state.preferences, steeringSensitivity: value }),
      `setup-choice${selected ? ' active' : ''}`,
    )
    choice.setAttribute('aria-pressed', String(selected))
    choices.append(choice)
  }
  steering.append(choices)
  frame.body.append(steering)
  frame.footer.append(
    button('DONE', 'options-done', actions.close, 'button button-primary'),
  )
  return frame.overlay
}
