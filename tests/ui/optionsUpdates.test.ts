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
      close: vi.fn(), playerName: vi.fn(),
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
      close: vi.fn(), playerName: vi.fn(),
      preferences: vi.fn(),
      previewVolume: vi.fn(),
      setVolume: vi.fn(),
    }, { initialTab: 'updates', availableUpdate: update })
    document.body.replaceChildren(overlay)

    const tab = overlay.querySelector('[data-action="options-tab-updates"]')
    expect(tab?.getAttribute('aria-selected')).toBe('true')
    await vi.waitFor(() => expect(overlay.querySelector('[data-action="download-update"]')).not.toBeNull())
    expect(overlay.querySelector('[data-action="download-update"]')?.classList.contains('button-primary')).toBe(true)
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
      close: vi.fn(), playerName: vi.fn(), preferences: vi.fn(),
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


describe('release notes shortcut', () => {
  it('opens the aggregated build history from a compact icon and returns without losing the APK action', async () => {
    vi.stubEnv('VITE_TRACKFORGE_BUILD_RUN', '533')
    vi.stubEnv('VITE_TRACKFORGE_BUILD_ATTEMPT', '1')
    native.current.mockReset().mockResolvedValue({ state: 'none' })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([
      { tag_name: 'android-build-535-1', body: "## What's Changed\n* Better steering" },
      { tag_name: 'android-build-534-1', body: "## What's Changed\n* More grip" },
      { tag_name: 'android-build-533-1', body: '' },
    ]), { status: 200 })) as typeof fetch
    try {
      const overlay = createOptionsModal({
        overlay: { type: 'options', returnTo: 'home', tab: 'updates' },
        preferences: {
          difficulty: 'normal', audioEnabled: true,
          hapticsEnabled: true, dynamicZoomEnabled: true,
        },
      } as AppSnapshot, {
        close: vi.fn(), playerName: vi.fn(), preferences: vi.fn(),
        previewVolume: vi.fn(), setVolume: vi.fn(),
      }, { initialTab: 'updates', availableUpdate: {
        version: 'android-build-535-1',
        url: 'https://github.com/Unschoolers/track-forge/releases/latest',
        apkUrl: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-535-1/trackforge-debug.apk',
      } })
      document.body.replaceChildren(overlay)
      await vi.waitFor(() => expect(overlay.querySelector('[data-action="view-release-notes"]')).not.toBeNull())
      const icon = overlay.querySelector<HTMLButtonElement>('[data-action="view-release-notes"]')!
      expect(icon.querySelector('svg path')).not.toBeNull()
      expect(icon.getAttribute('aria-label')).toBe('View release notes')
      icon.click()
      await vi.waitFor(() => expect(overlay.textContent).toContain('Better steering'))
      expect(overlay.querySelector('.release-notes-active')).toBeNull()
      expect(overlay.classList.contains('release-notes-active')).toBe(true)
      expect(overlay.textContent).toContain('More grip')
      overlay.querySelector<HTMLButtonElement>('[data-action="back-release-notes"]')?.click()
      expect(overlay.classList.contains('release-notes-active')).toBe(false)
      expect(overlay.querySelector('[data-action="download-update"]')).not.toBeNull()
    } finally {
      globalThis.fetch = originalFetch
      vi.unstubAllEnvs()
    }
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
  it('keeps Profile compact and renders a pink bolt rather than a fixed yellow emoji', () => {
    const modal = createOptionsModal({
      overlay: { type: 'options', returnTo: 'home' },
      preferences: {
        difficulty: 'normal', audioEnabled: true,
        hapticsEnabled: true, dynamicZoomEnabled: true,
        playerIdentity: { icon: 'bolt', color: 'pink' },
      },
    } as AppSnapshot, {
      close: vi.fn(), playerName: vi.fn(), preferences: vi.fn(),
      previewVolume: vi.fn(), setVolume: vi.fn(),
    })
    document.body.replaceChildren(modal)
    modal.querySelector<HTMLButtonElement>('[data-action="options-tab-profile"]')?.click()
    expect(modal.textContent).not.toContain('Renaming updates your tracks.')
    const marker = modal.querySelector<HTMLElement>('#options-panel-profile .topper-marker')
    expect(marker?.style.color).toBe('rgb(255, 103, 159)')
    expect(marker?.textContent).not.toContain('⚡')
    expect(marker?.querySelector('svg[fill="currentColor"] path')).not.toBeNull()
    expect(modal.querySelector('[data-action="options-topper-icon-bolt"] svg[fill="currentColor"] path')).not.toBeNull()
    expect(modal.querySelector('[data-action="options-topper-icon-bolt"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('edits the same remembered topper in Profile without a multiplayer lobby', () => {
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
      close: vi.fn(), playerName: vi.fn(), preferences: save,
      previewVolume: vi.fn(), setVolume: vi.fn(),
    })
    document.body.replaceChildren(modal)
    modal.querySelector<HTMLButtonElement>('[data-action="options-tab-race"]')?.click()
    expect(modal.querySelector('#options-panel-race .topper-section')).toBeNull()
    modal.querySelector<HTMLButtonElement>('[data-action="options-tab-profile"]')?.click()
    expect(modal.querySelector('#options-panel-profile .topper-section')).not.toBeNull()
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

describe('options category navigation', () => {
  it('keeps every native tab discoverable with an icon, label and working panel', () => {
    native.current.mockResolvedValue({ state: 'none' })
    const modal = createOptionsModal({
      overlay: { type: 'options', returnTo: 'home' },
      preferences: {
        difficulty: 'normal',
        audioEnabled: true,
        hapticsEnabled: true,
        dynamicZoomEnabled: true,
      },
    } as AppSnapshot, {
      close: vi.fn(), playerName: vi.fn(), preferences: vi.fn(),
      previewVolume: vi.fn(), setVolume: vi.fn(),
    })
    document.body.replaceChildren(modal)

    const tabs = Array.from(modal.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs.map(tab => tab.textContent)).toEqual([
      'Profile', 'Race', 'Audio', 'Display', 'Controls', 'Updates',
    ])
    expect(modal.querySelector<HTMLElement>('[role="tablist"]')?.style.getPropertyValue('--options-tab-count')).toBe('6')
    for (const tab of tabs) {
      expect(tab.querySelector('svg[aria-hidden="true"] path')).not.toBeNull()
      expect(tab.getAttribute('aria-controls')).toBeTruthy()
    }

    const controls = modal.querySelector<HTMLButtonElement>('[data-action="options-tab-controls"]')!
    controls.click()
    expect(controls.getAttribute('aria-selected')).toBe('true')
    expect(modal.querySelector('[data-options-tab="controls"]')?.hasAttribute('hidden')).toBe(false)
    expect(modal.querySelector('[data-options-tab="race"]')?.hasAttribute('hidden')).toBe(true)

    controls.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(modal.querySelector('[data-action="options-tab-updates"]')?.getAttribute('aria-selected')).toBe('true')
  })
})
