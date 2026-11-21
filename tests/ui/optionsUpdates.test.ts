// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'

const native = vi.hoisted(() => ({
  current: vi.fn(),
  install: vi.fn(),
  download: vi.fn(),
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

describe('home update shortcut', () => {
  it('opens the Updates tab directly with a verified release ready to download', async () => {
    native.current.mockReset().mockResolvedValue({ state: 'none' })
    const update = {
      version: 'android-build-999-1',
      url: 'https://github.com/Unschoolers/track-forge/releases/latest',
      apkUrl: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-999-1/trackforge-debug.apk',
    }
    const overlay = createOptionsModal({
      overlay: { type: 'options', returnTo: 'home', tab: 'updates' },
      preferences: {
        difficulty: 'normal',
        audioEnabled: true,
        hapticsEnabled: true,
        dynamicZoomEnabled: true,
      },
    } as AppSnapshot, {
      close: vi.fn(),
      preferences: vi.fn(),
      previewVolume: vi.fn(),
      setVolume: vi.fn(),
    }, { initialTab: 'updates', availableUpdate: update })
    document.body.replaceChildren(overlay)

    const tab = overlay.querySelector('[data-action="options-tab-updates"]')
    expect(tab?.getAttribute('aria-selected')).toBe('true')
    await vi.waitFor(() => expect(overlay.querySelector('[data-action="download-update"]')).not.toBeNull())
    expect(overlay.textContent).toContain('New version available: android-build-999-1')
    expect(overlay.querySelector('[data-options-tab="updates"]')?.getAttribute('hidden')).toBeNull()
  })

  it('preserves the install action when an APK was already downloaded', async () => {
    native.current.mockReset().mockResolvedValue({
      downloadId: 22, version: 'android-build-999-1',
      downloaded: 42, total: 42, state: 'complete',
    })
    const overlay = createOptionsModal({
      overlay: { type: 'options', returnTo: 'home', tab: 'updates' },
      preferences: {
        difficulty: 'normal', audioEnabled: true,
        hapticsEnabled: true, dynamicZoomEnabled: true,
      },
    } as AppSnapshot, {
      close: vi.fn(), preferences: vi.fn(),
      previewVolume: vi.fn(), setVolume: vi.fn(),
    }, { initialTab: 'updates', availableUpdate: {
      version: 'android-build-999-1',
      url: 'https://github.com/Unschoolers/track-forge/releases/latest',
      apkUrl: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-999-1/trackforge-debug.apk',
    } })
    document.body.replaceChildren(overlay)
    await vi.waitFor(() => expect(overlay.querySelector('[data-action="install-update"]')).not.toBeNull())
    expect(overlay.querySelector('[data-action="download-update"]')).toBeNull()
  })
})

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


describe('single-player topper customization', () => {
  it('edits the same remembered topper in Options > Race without a multiplayer lobby', () => {
    const save = vi.fn()
    const modal = createOptionsModal({
      overlay: { type: 'options', returnTo: 'home' },
      preferences: {
        car: 'green',
        difficulty: 'normal',
        audioEnabled: true,
        hapticsEnabled: true,
        dynamicZoomEnabled: true,
        playerIdentity: { icon: 'crown', color: 'gold' },
      },
    } as AppSnapshot, {
      close: vi.fn(), preferences: save,
      previewVolume: vi.fn(), setVolume: vi.fn(),
    })
    document.body.replaceChildren(modal)
    modal.querySelector<HTMLButtonElement>('[data-action="options-tab-race"]')?.click()
    expect(modal.textContent).toContain('Your topper · crown / gold')
    expect(modal.querySelectorAll('[data-action^="options-topper-icon-"]')).toHaveLength(6)
    expect(modal.querySelectorAll('[data-action^="options-topper-color-"]')).toHaveLength(6)
    expect(modal.querySelector('[data-action="options-topper-icon-crown"]')?.getAttribute('aria-pressed')).toBe('true')
    modal.querySelector<HTMLButtonElement>('[data-action="options-topper-icon-star"]')?.click()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      car: 'green', playerIdentity: { icon: 'star', color: 'gold' },
    }))
    modal.querySelector<HTMLButtonElement>('[data-action="options-topper-color-pink"]')?.click()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      car: 'green', playerIdentity: { icon: 'crown', color: 'pink' },
    }))
  })
})
