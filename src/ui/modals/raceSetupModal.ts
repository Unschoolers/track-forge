import type { LightingMode } from '@/domain/model'
import { CAR_SPECS, DIFFICULTY_SPECS } from '@/domain/config'
import type { GhostAvailability, GhostSetup } from '@/application/race/ghostReplay'
import type { AppSnapshot } from '@/application/appState'
import { populateRacePreparation } from '@/ui/components/racePreparationLayout'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { appendGhostIndicator } from '@/ui/components/ghostIndicator'
import { formatRaceTime } from '@/ui/format'
import { BOOST_PRACTICE_AVAILABLE } from '@/application/race/boostPracticeConfig'

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
  availableSetups?: readonly GhostSetup[],
): HTMLElement {
  const ghost = typeof availability === 'number' ? { kind: 'exact' as const, time: availability } : availability ?? { kind: 'none' as const }
  const ghostTime = ghost.kind === 'exact' ? ghost.time : null
  const ghostAvailable = ghostTime !== null && Number.isFinite(ghostTime) && ghostTime > 0
  const creatorChallenge = state.currentTrack?.creatorChallenge
  const openRoute = state.currentTrack?.routeKind === 'point-to-point'
  const preferredMode = state.preferences.raceMode === 'boost-practice' && !BOOST_PRACTICE_AVAILABLE
    ? 'normal' : state.preferences.raceMode
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
  lightingSection.append(element('h3', 'setup-label', 'Lighting'))
  const lightingRow = element('div', 'choice-row')
  for (const value of ['day', 'night'] as const) {
    const choice = button(value === 'day' ? 'Day' : 'Night', `lighting-${value}`, () => actions.lighting(value), `setup-choice${value === lighting ? ' active' : ''}`)
    choice.setAttribute('aria-pressed', String(value === lighting))
    lightingRow.append(choice)
  }
  lightingSection.append(lightingRow)
  const mode = element('section', 'setup-section')
  mode.append(element('h3', 'setup-label', 'Race Mode'))
  const modeRow = element('div', 'choice-row race-mode-row')
  const modes = openRoute
    ? [['normal', 'Race AI'], ['time-trial', 'Time Trial'], ['ghost', 'Ghost Race'],
      ...(BOOST_PRACTICE_AVAILABLE ? [['boost-practice', 'Boost Practice']] as const : [])] as const
    : [['normal', 'Normal Race'], ['ghost', 'Ghost Race'],
      ...(BOOST_PRACTICE_AVAILABLE ? [['boost-practice', 'Boost Practice']] as const : [])] as const
  for (const [id, label] of modes) {
    const choice = button(label, `mode-${id}`,
      () => actions.preferences({ ...state.preferences, raceMode: id,
        ...(id === 'ghost' && creatorChallenge && !openRoute ? { raceLaps: creatorChallenge.laps } : {}) }),
      `setup-choice${id === raceMode ? ' active' : ''}`)
    choice.disabled = id === 'ghost' && !ghostAvailable && !creatorChallenge
    choice.setAttribute('aria-disabled', String(choice.disabled))
    choice.setAttribute('aria-pressed', String(id === raceMode))
    choice.setAttribute('aria-describedby', 'ghost-availability')
    modeRow.append(choice)
  }
  const description = element('p', 'modal-subtitle', raceMode === 'boost-practice'
    ? 'Solo, unranked Arcade run. Tap and release BRAKE while turning at speed to drift and charge boost.'
    : creatorChallenge && ghost.kind === 'exact'
      ? `Creator challenge: ${formatRaceTime(creatorChallenge.time)} · ${CAR_SPECS[creatorChallenge.car].name} · ${creatorChallenge.laps} ${creatorChallenge.laps === 1 ? 'lap' : 'laps'}. Ghost Race is solo against this replay; your selected car can differ.`
      : creatorChallenge && ghost.kind === 'different-setup'
        ? `Creator target: ${formatRaceTime(creatorChallenge.time)} · ${CAR_SPECS[creatorChallenge.car].name} · ${creatorChallenge.laps} ${creatorChallenge.laps === 1 ? 'lap' : 'laps'}. Choose Ghost Race to apply the target laps and race this replay.`
      : ghostAvailable
      ? `Best ghost: ${formatRaceTime(ghostTime)}. Ghost Race is you against your replay; ${openRoute ? 'Race AI' : 'Normal Race'} has AI opponents.`
      : ghost.kind === 'different-setup'
        ? `Saved ghost: ${CAR_SPECS[ghost.setup.car].name} · ${openRoute ? 'single run' : `${ghost.setup.laps} ${ghost.setup.laps === 1 ? 'lap' : 'laps'}`}.`
        : 'Finish a race on this layout to save a ghost.')
  description.id = 'ghost-availability'
  mode.append(modeRow, description)
  const laps = state.preferences.raceLaps ?? 2
  const savedSetups = availableSetups ?? (creatorChallenge
    ? [{ car: creatorChallenge.car, laps: creatorChallenge.laps }]
    : ghost.kind === 'exact' ? [{ car: state.preferences.car, laps: openRoute ? 1 : laps }]
      : ghost.kind === 'different-setup' ? [ghost.setup] : [])
  const lapSection = element('section', 'setup-section')
  lapSection.append(element('h3', 'setup-label', 'Laps'))
  const lapRow = element('div', 'choice-row')
  lapRow.setAttribute('role', 'group')
  lapRow.setAttribute('aria-label', 'Race laps')
  for (const count of [1, 2, 3] as const) {
    const choice = button(count === 1 ? '1 lap' : `${count} laps`, `laps-${count}`,
      () => actions.preferences({ ...state.preferences, raceLaps: count }),
      `setup-choice${count === laps ? ' active' : ''}`)
    choice.dataset.raceLaps = String(count)
    choice.setAttribute('aria-pressed', String(count === laps))
    if (creatorChallenge?.laps === count || savedSetups.some(setup => setup.car === state.preferences.car && setup.laps === count)) {
      appendGhostIndicator(choice, creatorChallenge ? 'Creator ghost available' : 'Saved ghost available for this car')
    }
    lapRow.append(choice)
  }
  lapSection.append(lapRow)
  const lightLabel = lighting === 'night' ? 'Night' : 'Day'
  populateRacePreparation(frame.body, {
    car: state.preferences.car,
    selectCar: car => actions.preferences({ ...state.preferences, car }),
    preview: flyover,
    ghostSetups: savedSetups,
    metadata: `${DIFFICULTY_SPECS[state.preferences.difficulty].name} · ${openRoute ? 'Single run' : `${laps} ${laps === 1 ? 'lap' : 'laps'}`} · ${lightLabel}`,
    sections: [...(openRoute ? [] : [lapSection]), lightingSection, mode],
  })
  frame.footer.append(
    button('Back', 'setup-back', actions.close, 'button'),
    button('Options', 'setup-options', actions.options, 'button'),
    button(
      raceMode === 'boost-practice' ? 'Start Boost Practice'
        : raceMode === 'ghost' ? 'Start Ghost Race' : raceMode === 'time-trial' ? 'Start Time Trial' : 'Start Race',
      'setup-start',
      actions.start,
      'button button-primary',
    ),
  )
  return frame.overlay
}
