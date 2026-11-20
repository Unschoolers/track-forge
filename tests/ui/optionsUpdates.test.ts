// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'

const native = vi.hoisted(() => ({
  current: vi.fn(),
  install: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => native,
}))

import { createOptionsModal } from '@/ui/modals/optionsModal'

function showDownloadedUpdate() {
  const overlay = createOptionsModal(
    {
      overlay: { type: 'options', returnTo: 'home' },
      preferences: {
        difficulty: 'normal',
        audioEnabled: true,
        hapticsEnabled: true,
        dynamicZoomEnabled: true,
      },
    } as AppSnapshot,
    {
      close: vi.fn(),
      preferences: vi.fn(),
      previewVolume: vi.fn(),
      setVolume: vi.fn(),
    },
  )
  document.body.replaceChildren(overlay)
  overlay.querySelector<HTMLButtonElement>('[data-action="options-tab-updates"]')?.click()
  return overlay
}

describe('native APK installation feedback', () => {
  beforeEach(() => {
    native.current.mockReset().mockResolvedValue({
      downloadId: 22,
      version: 'android-build-550-1',
      downloaded: 42,
      total: 42,
      state: 'complete',
    })
    native.install.mockReset()
  })

  it('instructs user to enable unknown-app installs and lets them retry', async () => {
    native.install.mockResolvedValue({ state: 'permission-required' })
    const overlay = showDownloadedUpdate()
    await vi.waitFor(() => expect(overlay.querySelector('[data-action="install-update"]')).not.toBeNull())
    const install = overlay.querySelector<HTMLButtonElement>('[data-action="install-update"]')!
    install.click()
    await vi.waitFor(() => expect(overlay.textContent).toContain('Allow installs from Track Forge in Android Settings'))
    expect(native.install).toHaveBeenCalledOnce()
    expect(install.disabled).toBe(false)
  })

  it('shows actionable errors rather than leaving a silent install button', async () => {
    native.install.mockRejectedValue(new Error('Downloaded APK is not a newer version.'))
    const overlay = showDownloadedUpdate()
    await vi.waitFor(() => expect(overlay.querySelector('[data-action="install-update"]')).not.toBeNull())
    const install = overlay.querySelector<HTMLButtonElement>('[data-action="install-update"]')!
    install.click()
    await vi.waitFor(() => expect(overlay.textContent).toContain('Downloaded APK is not a newer version.'))
    expect(install.disabled).toBe(false)
  })

  it('confirms the Android installer was requested', async () => {
    native.install.mockResolvedValue({ state: 'installer-opened' })
    const overlay = showDownloadedUpdate()
    await vi.waitFor(() => expect(overlay.querySelector('[data-action="install-update"]')).not.toBeNull())
    overlay.querySelector<HTMLButtonElement>('[data-action="install-update"]')?.click()
    await vi.waitFor(() => expect(overlay.textContent).toContain('Confirm installation in the Android prompt.'))
  })
})
