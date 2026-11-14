import type { AppSnapshot } from '@/application/appState'
import { audioVolumes, type AudioVolumeSetting } from '@/application/audioVolume'
import { DIFFICULTY_IDS } from '@/domain/model'
import { DIFFICULTY_SPECS } from '@/domain/config'
import { createToggleRow } from '@/ui/components/toggleRow'
import { createVolumeRow } from '@/ui/components/volumeRow'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createOptionsModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly preferences: (preferences: AppSnapshot['preferences']) => void
    readonly previewVolume: (setting: AudioVolumeSetting, volume: number) => void
    readonly setVolume: (setting: AudioVolumeSetting, volume: number) => void
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
    raceSettings.append(difficulty, raceLength, handling)
    frame.body.append(raceSettings)
  }
  const volumes = audioVolumes(state.preferences)
  frame.body.append(element('h3', 'setup-label', 'Audio'))
  for (const [setting, label] of [['musicVolume', 'Music'], ['soundEffectsVolume', 'Sound Effects']] as const) {
    frame.body.append(createVolumeRow(
      label,
      setting,
      volumes[setting],
      (volume) => actions.previewVolume(setting, volume),
      (volume) => actions.setVolume(setting, volume),
    ))
  }
  frame.body.append(element('h3', 'setup-label', 'Comfort & feedback'))
  frame.body.append(
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
  frame.body.append(element('h3', 'setup-label', 'Controls'))
  const controlChoices = <K extends 'steeringLayout' | 'steeringHand' | 'controlSize'>(
    title: string, key: K, values: readonly NonNullable<AppSnapshot['preferences'][K]>[], fallback: NonNullable<AppSnapshot['preferences'][K]>,
  ): void => {
    const section = element('section', 'setup-section')
    section.append(element('h3', 'setup-label', title))
    const row = element('div', 'choice-row')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', title)
    for (const value of values) {
      const selected = (state.preferences[key] ?? fallback) === value
      const choice = button(value.toUpperCase(), `${key}-${value}`, () => actions.preferences({ ...state.preferences, [key]: value }), `setup-choice${selected ? ' active' : ''}`)
      choice.setAttribute('aria-pressed', String(selected))
      row.append(choice)
    }
    section.append(row)
    frame.body.append(section)
  }
  controlChoices('Steering layout', 'steeringLayout', ['drag', 'buttons'], 'drag')
  controlChoices('Steering hand', 'steeringHand', ['left', 'right'], 'left')
  controlChoices('Control size', 'controlSize', ['standard', 'large'], 'standard')
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
  if ((state.preferences.steeringLayout ?? 'drag') === 'drag') frame.body.append(steering)
  frame.footer.append(
    button('DONE', 'options-done', actions.close, 'button button-primary'),
  )
  return frame.overlay
}
