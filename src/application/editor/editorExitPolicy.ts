import type { AppCommand } from '@/application/appState'

/** Commands that would abandon or replace an active editor draft. */
export function requiresEditorExitConfirmation(command: AppCommand): boolean {
  switch (command.type) {
    case 'go-home':
    case 'start-race':
    case 'race-again':
    case 'select-track':
    case 'select-track-for-edit':
    case 'select-track-for-race':
    case 'open-track-library':
    case 'create-track':
    case 'import-track':
    case 'open-nearby':
    case 'open-cup':
      return true
    default:
      return false
  }
}
