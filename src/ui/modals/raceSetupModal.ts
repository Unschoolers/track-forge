import type { LightingMode } from '@/domain/model'
import { CAR_SPECS, DIFFICULTY_SPECS } from '@/domain/config'
import type { GhostAvailability } from '@/application/race/ghostReplay'
import type { AppSnapshot } from '@/application/appState'
import { createCarPicker } from '@/ui/components/carPicker'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { formatRaceTime } from '@/ui/format'

export function createRaceSetupModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly preferences: (preferences: AppSnapshot['preferences']) => void
    readonly lighting: (lighting: LightingMode) => void
    readonly start: () => void
    readonly options: () => void
  },
  availability: GhostAvailability | number | null = null,
  flyover?: HTMLElement,
): HTMLElement {
  const ghost = typeof availability === 'number' ? { kind: 'exact' as const, time: availability } : availability ?? { kind: 'none' as const }
  const ghostTime = ghost.kind === 'exact' ? ghost.time : null
  const ghostAvailable = ghostTime !== null && Number.isFinite(ghostTime) && ghostTime > 0
  const raceMode = state.preferences.raceMode === 'ghost' && ghostAvailable ? 'ghost' : 'normal'
  const frame = createModalFrame(
    'Race setup',
    state.currentTrack?.name ?? 'Selected track',
    actions.close,
    'race-setup-modal',
  )
  if (flyover) frame.body.append(flyover)
  const lighting = state.raceLighting ?? state.currentTrack?.lighting ?? 'day'
  const lightingSection = element('section', 'setup-section')
  lightingSection.append(element('h3', 'setup-label', 'LIGHTING'))
  const lightingRow = element('div', 'choice-row')
  for (const value of ['day', 'night'] as const) {
    const choice = button(value.toUpperCase(), `lighting-${value}`, () => actions.lighting(value), `setup-choice${value === lighting ? ' active' : ''}`)
    choice.setAttribute('aria-pressed', String(value === lighting))
    lightingRow.append(choice)
  }
  lightingSection.append(lightingRow)
  frame.body.append(lightingSection)
  frame.body.append(
    createCarPicker(state.preferences.car, (car) =>
      actions.preferences({ ...state.preferences, car }),
    ),
  )
  const mode = element('section', 'setup-section')
  mode.append(element('h3', 'setup-label', 'RACE MODE'))
  const modeRow = element('div', 'choice-row')
  for (const [id, label] of [['normal', 'NORMAL RACE'], ['ghost', 'GHOST RACE']] as const) {
    const choice = button(label, `mode-${id}`,
      () => actions.preferences({ ...state.preferences, raceMode: id }),
      `setup-choice${id === raceMode ? ' active' : ''}`)
    choice.disabled = id === 'ghost' && !ghostAvailable
    choice.setAttribute('aria-disabled', String(choice.disabled))
    choice.setAttribute('aria-pressed', String(id === raceMode))
    choice.setAttribute('aria-describedby', 'ghost-availability')
    modeRow.append(choice)
  }
  const description = element('p', 'modal-subtitle', ghostAvailable
    ? `Best ghost: ${formatRaceTime(ghostTime)}. Ghost Race is you against your replay; Normal Race has AI opponents.`
    : ghost.kind === 'different-setup'
      ? `Saved ghost: ${CAR_SPECS[ghost.setup.car].name} · ${ghost.setup.laps} ${ghost.setup.laps === 1 ? 'lap' : 'laps'} · ${ghost.setup.handling === 'simulation' ? 'Simulation' : 'Arcade'}.`
      : 'Finish a race on this layout to save a ghost.')
  description.id = 'ghost-availability'
  mode.append(modeRow, description)
  frame.body.append(mode)
  const laps = state.preferences.raceLaps ?? 2
  const style = state.preferences.handling === 'simulation' ? 'Simulation' : 'Arcade'
  const lightLabel = lighting === 'night' ? 'Night' : 'Day'
  frame.body.append(element('p', 'modal-subtitle', `${style} · ${DIFFICULTY_SPECS[state.preferences.difficulty].name} · ${laps} ${laps === 1 ? 'lap' : 'laps'} · ${lightLabel}`))
  frame.footer.append(
    button('BACK', 'setup-back', actions.close, 'button'),
    button('OPTIONS', 'setup-options', actions.options, 'button'),
    button(
      raceMode === 'ghost' ? 'START GHOST RACE' : 'START RACE',
      'setup-start',
      actions.start,
      'button button-primary',
    ),
  )
  return frame.overlay
}
