import type { AppCommand, AppSnapshot } from '@/application/appState'

/**
 * Convert the Android system Back button into the same commands used by
 * on-screen navigation. Home opens the shared exit confirmation.
 */
export function androidBackCommand(
  state: Pick<AppSnapshot, 'mode' | 'overlay' | 'preferences'>,
): AppCommand | null {
  if (state.overlay.type === 'pause') return { type: 'resume-race' }
  // The first-launch name is required. Back must not bypass that screen.
  if (state.overlay.type === 'player-name' && !state.preferences.displayName) return null
  if (state.overlay.type !== 'none') return { type: 'close-overlay' }

  if (state.mode === 'race') return { type: 'pause-race' }
  if (state.mode === 'editor') return { type: 'go-home' }
  return { type: 'open-app-exit' }
}

export function handleAndroidBack(
  state: Pick<AppSnapshot, 'mode' | 'overlay' | 'preferences'>,
  dispatch: (command: AppCommand) => void,
): boolean {
  const command = androidBackCommand(state)
  if (!command) return false
  dispatch(command)
  return true
}
