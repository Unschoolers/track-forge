// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createPlayerNameModal } from '@/ui/modals/playerNameModal'
import type { AppSnapshot } from '@/application/appState'

describe('first-time player name', () => {
  it('requires a valid nickname before continuing and preserves the draft on error', () => {
    const submit = vi.fn()
    const modal = createPlayerNameModal({
      overlay: { type: 'player-name' }, notice: null,
    } as AppSnapshot, submit)
    document.body.replaceChildren(modal)
    const input = modal.querySelector<HTMLInputElement>('#player-name-input')!
    input.value = '<script>'
    modal.querySelector<HTMLButtonElement>('[data-action="confirm-player-name"]')?.click()
    expect(submit).not.toHaveBeenCalled()
    expect(input.value).toBe('<script>')
    expect(modal.querySelector('[role="alert"]')?.textContent).toContain('2–24')
    input.value = ' Émile QC '
    modal.querySelector<HTMLButtonElement>('[data-action="confirm-player-name"]')?.click()
    expect(submit).toHaveBeenCalledWith(' Émile QC ')
  })
})
