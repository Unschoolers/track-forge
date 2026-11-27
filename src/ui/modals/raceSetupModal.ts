import type { LightingMode } from '@/domain/model'
import { CAR_SPECS, DIFFICULTY_SPECS } from '@/domain/config'
import type { GhostAvailability, GhostSetup } from '@/application/race/ghostReplay'
import type { AppSnapshot } from '@/application/appState'
import { populateRacePreparation } from '@/ui/components/racePreparationLayout'
import { createCarPicker } from '@/ui/components/carPicker'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { appendGhostIndicator } from '@/ui/components/ghostIndicator'
import { createLightingToggle, updateLightingToggle } from '@/ui/components/lightingToggle'
import { formatRaceTime } from '@/ui/format'
import { BOOST_PRACTICE_AVAILABLE } from '@/application/race/boostPracticeConfig'

type Actions = {
  readonly close: () => void
  readonly preferences: (preferences: AppSnapshot['preferences']) => void
  readonly lighting: (lighting: LightingMode) => void
  readonly start: () => void
  readonly options: () => void
}

type Update = (state: AppSnapshot, availability: GhostAvailability | number | null, flyover?: HTMLElement, setups?: readonly GhostSetup[]) => void
const updates = new WeakMap<HTMLElement, Update>()

function cycleControl(action: string, activate: () => void): HTMLButtonElement {
  const control = button('', action, activate, 'setup-choice setup-cycle')
  const value = element('span', 'setup-cycle-value')
  const arrow = element('span', 'setup-cycle-arrow', '↻')
  arrow.setAttribute('aria-hidden', 'true')
  control.append(value, arrow)
  return control
}

function paintCycle(control: HTMLButtonElement, label: string, title: string, next: string | undefined): void {
  const value = control.querySelector<HTMLElement>('.setup-cycle-value')
  if (value && value.textContent !== label) {
    const hadValue = Boolean(value.textContent)
    value.textContent = label
    if (hadValue && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      for (const animation of value.getAnimations?.() ?? []) animation.cancel()
      value.animate?.([{ opacity: .45, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' })
    }
  }
  control.disabled = next === undefined
  control.setAttribute('aria-label', title + ': ' + label + (next ? '. Next: ' + next : ''))
}

export function createRaceSetupModal(
  initial: AppSnapshot,
  actions: Actions,
  availability: GhostAvailability | number | null = null,
  flyover?: HTMLElement,
  availableSetups?: readonly GhostSetup[],
  existing?: HTMLElement,
): HTMLElement {
  const updateExisting = existing && updates.get(existing)
  if (existing && updateExisting) {
    updateExisting(initial, availability, flyover, availableSetups)
    return existing
  }
  let state = initial
  const frame = createModalFrame('Race setup', state.currentTrack?.name ?? 'Selected track', actions.close,
    'race-setup-modal race-preparation-modal')
  const lightingSection = element('section', 'setup-section')
  lightingSection.append(element('h3', 'setup-label', 'Lighting'))
  const lightingToggle = createLightingToggle(state.raceLighting ?? state.currentTrack?.lighting ?? 'day', actions.lighting)
  lightingSection.append(lightingToggle)

  let nextMode: (() => void) | undefined
  const mode = element('section', 'setup-section')
  mode.append(element('h3', 'setup-label', 'Race Mode'))
  const modeButton = cycleControl('mode-cycle', () => nextMode?.())
  const description = element('p', 'modal-subtitle')
  description.id = 'ghost-availability'
  modeButton.setAttribute('aria-describedby', description.id)
  mode.append(modeButton, description)

  const lapSection = element('section', 'setup-section')
  lapSection.append(element('h3', 'setup-label', 'Laps'))
  const lapButton = cycleControl('laps-cycle', () => {
    const laps = state.preferences.raceLaps ?? 2
    const next = laps === 1 ? 2 : laps === 2 ? 3 : 1
    actions.preferences({ ...state.preferences, raceLaps: next })
  })
  const lapHint = element('p', 'modal-subtitle setup-lap-hint')
  lapHint.id = 'lap-ghost-availability'
  lapButton.setAttribute('aria-describedby', lapHint.id)
  lapSection.append(lapButton, lapHint)

  const selectCar = (car: AppSnapshot['preferences']['car']) => actions.preferences({ ...state.preferences, car })
  populateRacePreparation(frame.body, {
    car: state.preferences.car, selectCar, preview: flyover, metadata: '',
    sections: [...(state.currentTrack?.routeKind === 'point-to-point' ? [] : [lapSection]), lightingSection, mode],
  })
  const start = button('Start Race', 'setup-start', actions.start, 'button button-primary')
  frame.footer.append(button('Back', 'setup-back', actions.close, 'button'),
    button('Options', 'setup-options', actions.options, 'button'), start)

  let previousPickerKey: string | undefined
  const update: Update = (snapshot, availability, preview, availableSetups) => {
    state = snapshot
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
    const modes = openRoute
      ? [['normal', 'Race AI'], ['time-trial', 'Time Trial'], ['ghost', 'Ghost Race'],
        ...(BOOST_PRACTICE_AVAILABLE ? [['boost-practice', 'Boost Practice']] as const : [])] as const
      : [['normal', 'Normal Race'], ['ghost', 'Ghost Race'],
        ...(BOOST_PRACTICE_AVAILABLE ? [['boost-practice', 'Boost Practice']] as const : [])] as const
    const available = modes.filter(([id]) => id !== 'ghost' || ghostAvailable || creatorChallenge)
    const index = available.findIndex(([id]) => id === raceMode)
    const next = available.length > 1 ? available[(index + 1) % available.length] : undefined
    nextMode = next ? () => actions.preferences({ ...state.preferences, raceMode: next[0],
      ...(next[0] === 'ghost' && creatorChallenge && !openRoute ? { raceLaps: creatorChallenge.laps } : {}) }) : undefined
    modeButton.dataset.raceMode = raceMode
    modeButton.dataset.availableModes = available.map(([id]) => id).join(' ')
    paintCycle(modeButton, modes.find(([id]) => id === raceMode)?.[1] ?? 'Normal Race', 'Race mode', next?.[1])
    description.textContent = raceMode === 'boost-practice'
    ? 'Solo, unranked Arcade run. Tap and release BRAKE while turning at speed to drift and charge boost.'
    : creatorChallenge && ghost.kind === 'exact'
      ? `Creator challenge: ${formatRaceTime(creatorChallenge.time)} · ${CAR_SPECS[creatorChallenge.car].name} · ${creatorChallenge.laps} ${creatorChallenge.laps === 1 ? 'lap' : 'laps'}. Ghost Race is solo against this replay; your selected car can differ.`
      : creatorChallenge && ghost.kind === 'different-setup'
        ? `Creator target: ${formatRaceTime(creatorChallenge.time)} · ${CAR_SPECS[creatorChallenge.car].name} · ${creatorChallenge.laps} ${creatorChallenge.laps === 1 ? 'lap' : 'laps'}. Choose Ghost Race to apply the target laps and race this replay.`
      : ghostAvailable
      ? `Best ghost: ${formatRaceTime(ghostTime)}. Ghost Race is you against your replay; ${openRoute ? 'Race AI' : 'Normal Race'} has AI opponents.`
      : ghost.kind === 'different-setup'
        ? `Saved ghost: ${CAR_SPECS[ghost.setup.car].name} · ${openRoute ? 'single run' : `${ghost.setup.laps} ${ghost.setup.laps === 1 ? 'lap' : 'laps'}`}.`
        : 'Finish a race on this layout to save a ghost.'

    const laps = state.preferences.raceLaps ?? 2
    const savedSetups = availableSetups ?? (creatorChallenge
      ? [{ car: creatorChallenge.car, laps: creatorChallenge.laps }]
      : ghost.kind === 'exact' ? [{ car: state.preferences.car, laps: openRoute ? 1 : laps }]
        : ghost.kind === 'different-setup' ? [ghost.setup] : [])
    const lapLabel = (count: number) => count === 1 ? '1 lap' : count + ' laps'
    lapButton.dataset.raceLaps = String(laps)
    paintCycle(lapButton, lapLabel(laps), 'Race laps', lapLabel(laps === 3 ? 1 : laps + 1))
    lapButton.querySelector('.setup-ghost-indicator')?.remove()
    lapButton.removeAttribute('aria-description')
    lapButton.removeAttribute('title')
    const ghostLaps = [1, 2, 3].filter(count => creatorChallenge?.laps === count ||
      savedSetups.some(setup => setup.car === state.preferences.car && setup.laps === count))
    if (ghostLaps.includes(laps)) appendGhostIndicator(lapButton, creatorChallenge ? 'Creator ghost available' : 'Saved ghost available for this car')
    lapHint.textContent = ghostLaps.length ? 'Ghost available: ' + ghostLaps.map(lapLabel).join(', ') : ''
    lapHint.hidden = ghostLaps.length === 0

    const lighting = state.raceLighting ?? state.currentTrack?.lighting ?? 'day'
    updateLightingToggle(lightingToggle, lighting)
    const meta = frame.body.querySelector<HTMLElement>('.race-preparation-meta')
    if (meta) meta.textContent = DIFFICULTY_SPECS[state.preferences.difficulty].name + ' · ' +
      (openRoute ? 'Single run' : lapLabel(laps)) + ' · ' + (lighting === 'night' ? 'Night' : 'Day')
    const previousPreview = frame.body.querySelector('.race-flyover-panel')
    if (preview && preview !== previousPreview) {
      if (previousPreview) previousPreview.replaceWith(preview)
      else frame.body.prepend(preview)
    } else if (!preview) previousPreview?.remove()

    const pickerKey = state.preferences.car + ':' + JSON.stringify(savedSetups)
    if (pickerKey !== previousPickerKey) {
      previousPickerKey = pickerKey
      const picker = frame.body.querySelector('.race-preparation-picker')
      const fresh = createCarPicker(state.preferences.car, selectCar, { ghostSetups: savedSetups })
      // Retain buttons, images and focus; update selection, replay badges and summary only.
      for (const choice of picker?.querySelectorAll<HTMLButtonElement>('.car-choice') ?? []) {
        const next = fresh.querySelector<HTMLButtonElement>('[data-car="' + choice.dataset.car + '"]')
        if (!next) continue
        choice.classList.toggle('active', next.classList.contains('active'))
        choice.setAttribute('aria-pressed', next.getAttribute('aria-pressed') ?? 'false')
        choice.querySelector('.setup-ghost-indicator')?.remove()
        choice.removeAttribute('aria-description')
        choice.removeAttribute('title')
        const marker = next.querySelector('.setup-ghost-indicator')
        if (marker) {
          choice.append(marker)
          choice.setAttribute('aria-description', next.getAttribute('aria-description') ?? '')
          choice.title = next.title
        }
      }
      const summary = fresh.querySelector('.car-summary')
      if (summary) picker?.querySelector('.car-summary')?.replaceWith(summary)
    }
    const startLabel = raceMode === 'boost-practice' ? 'Start Boost Practice'
      : raceMode === 'ghost' ? 'Start Ghost Race' : raceMode === 'time-trial' ? 'Start Time Trial' : 'Start Race'
    if (start.textContent !== startLabel) {
      // Keep the mounted optical and touch layers.
      const label = [...start.childNodes].find(node => node.nodeType === Node.TEXT_NODE)
      if (label) label.textContent = startLabel
    }
  }
  updates.set(frame.overlay, update)
  update(initial, availability, flyover, availableSetups)
  return frame.overlay
}
