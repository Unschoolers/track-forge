// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { ReleaseNotes } from '@/application/updates/updateProvider'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { createReleaseNotesButton, openReleaseNotesView } from '@/ui/modals/updateReleaseNotes'

const notes: ReleaseNotes = {
  fromVersion: 'android-build-533-1',
  toVersion: 'android-build-535-1',
  complete: true,
  releases: [
    { version: 'android-build-535-1', publishedAt: '2026-11-21T10:00:00Z', changes: ['Better race controls', 'Better grip'] },
    { version: 'android-build-534-1', publishedAt: null, changes: [] },
  ],
}

function setup() {
  const frame = createModalFrame('Options', 'Options settings', vi.fn(), 'options-modal')
  const icon = createReleaseNotesButton(vi.fn())
  frame.body.append(icon)
  document.body.replaceChildren(frame.overlay)
  return { frame, icon }
}

describe('full-screen release note reader', () => {
  it('renders every intervening build, keeps old missing notes explicit, and returns to Updates', async () => {
    const { frame, icon } = setup()
    const onBack = vi.fn()
    openReleaseNotesView(frame.overlay, async () => notes, onBack)
    expect(frame.overlay.classList.contains('release-notes-active')).toBe(true)
    expect(frame.overlay.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(frame.overlay.querySelector('[data-action="view-release-notes"]')).toBeNull()
    const reader = frame.overlay.querySelector<HTMLElement>('.release-notes-scroll')
    expect(reader?.getAttribute('role')).toBe('region')
    expect(reader?.tabIndex).toBe(0)

    await vi.waitFor(() => expect(reader?.textContent).toContain('Better race controls'))
    expect(reader?.textContent).toContain('Build 533.1 → Build 535.1')
    expect(reader?.textContent).toContain('No detailed changes were published for this build.')
    expect(reader?.querySelectorAll('.release-notes-build')).toHaveLength(2)

    frame.overlay.querySelector<HTMLButtonElement>('[data-action="back-release-notes"]')?.click()
    expect(frame.overlay.classList.contains('release-notes-active')).toBe(false)
    expect(frame.overlay.querySelector('[data-action="view-release-notes"]')).toBe(icon)
    expect(document.activeElement).toBe(icon)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('handles Escape locally, and shows loading errors with a real retry action', async () => {
    const { frame } = setup()
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 403 rate limit'))
      .mockResolvedValueOnce({ ...notes, complete: false })
    openReleaseNotesView(frame.overlay, loader)
    await vi.waitFor(() => expect(frame.overlay.textContent).toContain('HTTP 403 rate limit'))
    frame.overlay.querySelector<HTMLButtonElement>('[data-action="retry-release-notes"]')?.click()
    await vi.waitFor(() => expect(frame.overlay.textContent).toContain('Older changes may be missing.'))
    expect(loader).toHaveBeenCalledTimes(2)
    frame.overlay.querySelector<HTMLButtonElement>('[data-action="back-release-notes"]')?.focus()
    frame.overlay.querySelector<HTMLButtonElement>('[data-action="back-release-notes"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(frame.overlay.classList.contains('release-notes-active')).toBe(false)
  })
})
