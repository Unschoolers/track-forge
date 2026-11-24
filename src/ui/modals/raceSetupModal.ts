import type { LightingMode } from '@/domain/model'
import { CAR_SPECS, DIFFICULTY_SPECS } from '@/domain/config'
import type { GhostAvailability } from '@/application/race/ghostReplay'
import type { AppSnapshot } from '@/application/appState'
import { populateRacePreparation } from '@/ui/components/racePreparationLayout'
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
  const openRoute = state.currentTrack?.routeKind === 'point-to-point'
  const preferredMode = state.preferences.raceMode
  const raceMode = preferredMode === 'ghost' && !ghostAvailable
    ? openRoute ? 'time-trial' : 'normal'
    : preferredMode === 'time-trial' && !openRoute ? 'normal' : preferredMode ?? 'normal'
  const frame = createModalFrame(
    'Race setup',
    state.currentTrack?.name ?? 'Selected track',
    actions.close,
    'race-setup-modal race-preparation-modal',
  )
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
  const mode = element('section', 'setup-section')
  mode.append(element('h3', 'setup-label', 'RACE MODE'))
  const modeRow = element('div', 'choice-row race-mode-row')
  const modes = openRoute
    ? [['normal', 'RACE AI'], ['time-trial', 'TIME TRIAL'], ['ghost', 'GHOST RACE']] as const
    : [['normal', 'NORMAL RACE'], ['ghost', 'GHOST RACE']] as const
  for (const [id, label] of modes) {
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
    ? `Best ghost: ${formatRaceTime(ghostTime)}. Ghost Race is you against your replay; ${openRoute ? 'Race AI' : 'Normal Race'} has AI opponents.`
    : ghost.kind === 'different-setup'
      ? `Saved ghost: ${CAR_SPECS[ghost.setup.car].name} · ${openRoute ? 'single run' : `${ghost.setup.laps} ${ghost.setup.laps === 1 ? 'lap' : 'laps'}`}.`
      : 'Finish a race on this layout to save a ghost.')
  description.id = 'ghost-availability'
  mode.append(modeRow, description)
  const laps = state.preferences.raceLaps ?? 2
  const lightLabel = lighting === 'night' ? 'Night' : 'Day'
  populateRacePreparation(frame.body, {
    car: state.preferences.car,
    selectCar: car => actions.preferences({ ...state.preferences, car }),
    preview: flyover,
    metadata: `${DIFFICULTY_SPECS[state.preferences.difficulty].name} · ${openRoute ? 'Single run' : `${laps} ${laps === 1 ? 'lap' : 'laps'}`} · ${lightLabel}`,
    sections: [lightingSection, mode],
  })
  frame.footer.append(
    button('BACK', 'setup-back', actions.close, 'button'),
    button('OPTIONS', 'setup-options', actions.options, 'button'),
    button(
      raceMode === 'ghost' ? 'START GHOST RACE' : raceMode === 'time-trial' ? 'START TIME TRIAL' : 'START RACE',
      'setup-start',
      actions.start,
      'button button-primary',
    ),
  )
  return frame.overlay
}
