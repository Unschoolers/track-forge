import type { AppSnapshot } from '@/application/appState'
import { createToggleRow } from '@/ui/components/toggleRow'
import { button } from '@/ui/dom'
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
  frame.footer.append(
    button('DONE', 'options-done', actions.close, 'button button-primary'),
  )
  return frame.overlay
}
