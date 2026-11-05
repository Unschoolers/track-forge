import type { AppSnapshot } from '@/application/appState'
import { DIFFICULTY_IDS } from '@/domain/model'
import { DIFFICULTY_SPECS } from '@/domain/config'
import { createCarPicker } from '@/ui/components/carPicker'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createRaceSetupModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly preferences: (preferences: AppSnapshot['preferences']) => void
    readonly start: () => void
  },
): HTMLElement {
  const frame = createModalFrame(
    'Race setup',
    state.currentTrack?.name ?? 'Selected track',
    actions.close,
    'race-setup-modal',
  )
  frame.body.append(
    createCarPicker(state.preferences.car, (car) =>
      actions.preferences({ ...state.preferences, car }),
    ),
  )
  const difficulty = element('section', 'setup-section')
  difficulty.append(element('h3', 'setup-label', 'AI DIFFICULTY'))
  const difficultyRow = element('div', 'choice-row')
  for (const id of DIFFICULTY_IDS) {
    const choice = button(
      DIFFICULTY_SPECS[id].name.toUpperCase(),
      `difficulty-${id}`,
      () =>
        actions.preferences({
          ...state.preferences,
          difficulty: id,
        }),
      `setup-choice${id === state.preferences.difficulty ? ' active' : ''}`,
    )
    choice.dataset.difficulty = id
    choice.setAttribute(
      'aria-pressed',
      String(id === state.preferences.difficulty),
    )
    difficultyRow.append(choice)
  }
  difficulty.append(
    difficultyRow,
    element(
      'p',
      'modal-subtitle',
      DIFFICULTY_SPECS[state.preferences.difficulty].description,
    ),
  )
  const lighting = element('section', 'setup-section')
  lighting.append(element('h3', 'setup-label', 'LIGHTING'))
  const lightingRow = element('div', 'choice-row')
  for (const mode of ['day', 'night'] as const) {
    const choice = button(
      mode.toUpperCase(),
      `lighting-${mode}`,
      () =>
        actions.preferences({
          ...state.preferences,
          lighting: mode,
        }),
      `setup-choice${mode === state.preferences.lighting ? ' active' : ''}`,
    )
    choice.dataset.lighting = mode
    choice.setAttribute(
      'aria-pressed',
      String(mode === state.preferences.lighting),
    )
    lightingRow.append(choice)
  }
  lighting.append(lightingRow)
  const handling = element('section', 'setup-section')
  handling.append(element('h3', 'setup-label', 'DRIVING STYLE'))
  const handlingRow = element('div', 'choice-row')
  for (const mode of ['arcade', 'simulation'] as const) {
    const selected = (state.preferences.handling ?? 'arcade') === mode
    const choice = button(
      mode.toUpperCase(),
      `handling-${mode}`,
      () => actions.preferences({ ...state.preferences, handling: mode }),
      `setup-choice${selected ? ' active' : ''}`,
    )
    choice.setAttribute('aria-pressed', String(selected))
    handlingRow.append(choice)
  }
  handling.append(
    handlingRow,
    element('p', 'modal-subtitle', 'Arcade responds faster to touch steering. Simulation preserves the original tire behavior.'),
  )
  frame.body.append(difficulty, lighting, handling)
  frame.footer.append(
    button('BACK', 'setup-back', actions.close, 'button'),
    button(
      'START RACE',
      'setup-start',
      actions.start,
      'button button-primary',
    ),
  )
  return frame.overlay
}
