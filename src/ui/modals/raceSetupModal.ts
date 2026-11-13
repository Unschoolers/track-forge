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
    readonly start: () => void
    readonly options: () => void
  },
  ghostTime: number | null = null,
  flyover?: HTMLElement,
): HTMLElement {
  const ghostAvailable = ghostTime !== null && Number.isFinite(ghostTime) && ghostTime > 0
  const raceMode = state.preferences.raceMode === 'ghost' && ghostAvailable ? 'ghost' : 'normal'
  const frame = createModalFrame(
    'Race setup',
    state.currentTrack?.name ?? 'Selected track',
    actions.close,
    'race-setup-modal',
  )
  if (flyover) frame.body.append(flyover)
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
    : 'Finish a race with this setup to save a ghost.')
  description.id = 'ghost-availability'
  mode.append(modeRow, description)
  frame.body.append(mode)
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
