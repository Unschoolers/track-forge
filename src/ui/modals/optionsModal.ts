import type { AppSnapshot } from '@/application/appState'
import { DIFFICULTY_IDS } from '@/domain/model'
import { DIFFICULTY_SPECS } from '@/domain/config'
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
    state.overlay.type === 'options' && state.overlay.returnTo === 'race'
      ? 'Comfort and feedback settings.'
      : 'Race, comfort, and feedback settings.',
    actions.close,
  )
  if (state.overlay.type !== 'options' || state.overlay.returnTo !== 'race') {
    const raceSettings = element('section', 'options-race-settings')
    raceSettings.append(element('h3', 'setup-label', 'Race settings'))
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
    lighting.append(lightingRow, element('p', 'modal-subtitle', 'Lighting follows the selected track; choosing another track loads its lighting.'))
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
      element('p', 'modal-subtitle', 'Arcade accelerates automatically. Simulation: hold GAS or W / ↑ to accelerate. Focused pedals: hold Space or Enter.'),
    )
    const raceLength = element('section', 'setup-section')
    raceLength.append(element('h3', 'setup-label', 'RACE LENGTH'))
    const raceLengthRow = element('div', 'choice-row')
    for (const [laps, label] of [[1, 'SPRINT · 1 LAP'], [2, 'CLASSIC · 2'], [3, 'ENDURANCE · 3']] as const) {
      const selected = (state.preferences.raceLaps ?? 2) === laps
      const choice = button(
        label,
        `laps-${laps}`,
        () => actions.preferences({ ...state.preferences, raceLaps: laps }),
        `setup-choice${selected ? ' active' : ''}`,
      )
      choice.dataset.raceLaps = String(laps)
      choice.setAttribute('aria-pressed', String(selected))
      raceLengthRow.append(choice)
    }
    raceLength.append(raceLengthRow)
    raceSettings.append(difficulty, raceLength, lighting, handling)
    frame.body.append(raceSettings)
  }
  frame.body.append(element('h3', 'setup-label', 'Comfort & feedback'))
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
