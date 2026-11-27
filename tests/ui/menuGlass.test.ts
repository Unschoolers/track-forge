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

  it('does not load optics on an unsupported or live screen', () => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = 'race-hud'
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
