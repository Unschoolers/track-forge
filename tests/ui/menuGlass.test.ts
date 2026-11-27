// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachMenuGlass } from '@/ui/menu/menuGlass'

function setup(quality = 'medium') {
  const root = document.createElement('div')
  root.dataset.graphicsQuality = quality
  root.innerHTML = '<section class="home-screen"><button class="tf-menu-action" data-action="race">Race</button></section>'
  document.body.append(root)
  vi.stubGlobal('ResizeObserver', class {})
  vi.stubGlobal('CSS', { supports: () => true })
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  return { root, screen: root.querySelector<HTMLElement>('.home-screen')!, button: root.querySelector('button')!, media }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('LiquidGlass.dev menu adapter', () => {
  it('preserves the native button and removes the decorative lens on cleanup', async () => {
    const { root, screen, button, media } = setup()
    const click = vi.fn()
    button.addEventListener('click', click)
    const load = vi.fn(async () => undefined)
    const cleanup = attachMenuGlass(root, screen, load)
    await vi.waitFor(() => expect(button.querySelector('lg-panel')).not.toBeNull())
    expect(button.querySelector('lg-panel')?.getAttribute('aria-hidden')).toBe('true')
    expect(button.dataset.liquidGlass).toBe('')
    button.click()
    expect(click).toHaveBeenCalledOnce()
    cleanup()
    expect(button.querySelector('lg-panel')).toBeNull()
    expect(button.dataset.liquidGlass).toBeUndefined()
    expect(media.removeEventListener).toHaveBeenCalledOnce()
  })

  it.each([
    ['track-library-modal', '<div class="track-library-toolbar"><button>Favorites</button></div><article class="track-card"><button class="track-card-favorite">☆</button></article>'],
    ['race-setup-modal', '<div class="race-preparation-sections"><button class="setup-choice">Day</button></div><canvas></canvas>'],
    ['options-modal', '<nav class="options-tab-list"><button class="setup-choice">Audio</button></nav>'],
  ])('mounts only intended foreground optics on %s', async (name, content) => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = name
    screen.innerHTML = content + '<footer class="modal-footer"><button class="button">Back</button></footer>'
    root.append(screen)
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    await vi.waitFor(() => expect(screen.querySelectorAll('lg-panel')).toHaveLength(2))
    expect(root.querySelector('.home-screen lg-panel')).toBeNull()
    expect(screen.querySelector('.track-card lg-panel, canvas lg-panel, lg-panel lg-panel')).toBeNull()
    expect(screen.querySelector('.modal-footer > button > lg-panel')).not.toBeNull()
    cleanup()
    expect(screen.querySelectorAll('lg-panel')).toHaveLength(0)
  })

  it('reconciles asynchronous Options actions without remounting existing lenses', async () => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = 'options-modal'
    screen.innerHTML = '<nav class="options-tab-list"><button class="setup-choice">Updates</button></nav><section class="options-tab-panel"><div class="options-update-actions"><button class="button">Check</button><button class="button options-release-notes-button" hidden>Notes</button></div><section class="options-download-panel"></section></section>'
    root.append(screen)
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    const check = screen.querySelector('.options-update-actions .button')!
    const notes = screen.querySelector<HTMLButtonElement>('.options-release-notes-button')!
    const downloadPanel = screen.querySelector('.options-download-panel')!
    await vi.waitFor(() => expect(check.querySelector('lg-panel')).not.toBeNull())
    const originalLens = check.querySelector('lg-panel')
    expect(notes.querySelector('lg-panel')).toBeNull()
    notes.hidden = false
    downloadPanel.innerHTML = '<progress></progress><button class="button button-primary">Install</button><button class="button">Remove</button>'
    await vi.waitFor(() => expect(downloadPanel.querySelectorAll('lg-panel')).toHaveLength(2))
    expect(notes.querySelector('lg-panel')?.getAttribute('radius')).toBe('capsule')
    expect(check.querySelector('lg-panel')).toBe(originalLens)
    const install = downloadPanel.querySelector('.button-primary')!
    downloadPanel.replaceChildren()
    await vi.waitFor(() => expect(install.querySelector('lg-panel')).toBeNull())
    expect(check.querySelector('lg-panel')).toBe(originalLens)
    notes.hidden = true
    await vi.waitFor(() => expect(notes.querySelector('lg-panel')).toBeNull())
    cleanup()
    expect(screen.querySelectorAll('lg-panel')).toHaveLength(0)
  })

  it('does not load optics on an unsupported or live screen', () => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = 'race-hud'
    root.append(screen)
    const load = vi.fn(async () => undefined)
    attachMenuGlass(root, screen, load)()
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['cup-modal', 'nearby-static-modal'])('uses static artwork for %s actions', async (className) => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = className
    screen.innerHTML = '<footer class="modal-footer"><button class="button">Back</button></footer>'
    root.append(screen)
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    await vi.waitFor(() => expect(screen.querySelector('lg-panel')?.getAttribute('backdrop')).toBe(`.${className}`))
    cleanup()
  })

  it.each(['pause-modal', 'results-modal', 'nearby-race-modal', 'editor-menu-modal', 'editor-exit-modal', 'track-name-modal', 'player-name-modal'])('never adds lenses to live %s overlays', (className) => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = className
    root.append(screen)
    const load = vi.fn(async () => undefined)
    attachMenuGlass(root, screen, load)()
    expect(load).not.toHaveBeenCalled()
  })

  it('does not load optics on low quality or reduced transparency', () => {
    const low = setup('low')
    const load = vi.fn(async () => undefined)
    attachMenuGlass(low.root, low.screen, load)()
    const reduced = setup()
    reduced.media.matches = true
    attachMenuGlass(reduced.root, reduced.screen, load)()
    expect(load).not.toHaveBeenCalled()
  })

  it('does not mount after navigation disposes a pending module load', async () => {
    const { root, screen, button } = setup()
    let resolve: () => void = () => { throw new Error('Module load did not start') }
    const load = () => new Promise<void>(done => { resolve = done })
    const cleanup = attachMenuGlass(root, screen, load)
    cleanup()
    resolve()
    await Promise.resolve()
    expect(button.querySelector('lg-panel')).toBeNull()
  })
})
