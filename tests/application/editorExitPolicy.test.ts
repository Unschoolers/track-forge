import { describe, expect, it } from 'vitest'
import type { AppCommand } from '@/application/appState'
import { requiresEditorExitConfirmation } from '@/application/editor/editorExitPolicy'
import { asTrackId } from '@/domain/model'

describe('editor exit command policy', () => {
  it('protects every navigation command that may abandon an editor draft', () => {
    const commands: AppCommand[] = [
      { type: 'go-home' },
      { type: 'start-race' },
      { type: 'race-again' },
      { type: 'select-track', id: asTrackId('next') },
      { type: 'select-track-for-edit', id: asTrackId('next') },
      { type: 'select-track-for-race', id: asTrackId('next') },
      { type: 'open-track-library', purpose: 'race' },
      { type: 'create-track', name: 'Second' },
      { type: 'import-track', content: '{}' },
      { type: 'open-nearby' },
      { type: 'open-cup' },
    ]
    for (const command of commands) expect(requiresEditorExitConfirmation(command)).toBe(true)
  })

  it('never prompts for editor-local tools, saving, or resolving an exit', () => {
    const commands: AppCommand[] = [
      { type: 'save-current-track' },
      { type: 'open-editor-menu' },
      { type: 'toggle-editor-grid' },
      { type: 'resolve-editor-exit', choice: 'cancel' },
      { type: 'resolve-editor-exit', choice: 'discard' },
      { type: 'request-editor-camera', action: 'fit' },
    ]
    for (const command of commands) expect(requiresEditorExitConfirmation(command)).toBe(false)
  })
})
