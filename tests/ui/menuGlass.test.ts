// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachMenuGlass } from '@/ui/menu/menuGlass'
import { createAppExitModal } from '@/ui/modals/appExitModal'

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
  it('uses real shared lenses for both app exit actions and only exits on confirmation', async () => {
    const { root } = setup()
    const stay = vi.fn()
    const exit = vi.fn(async () => undefined)
    const screen = createAppExitModal(stay, exit)
    root.append(screen)
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    await vi.waitFor(() => expect(screen.querySelectorAll('button > lg-panel')).toHaveLength(2))
    screen.querySelector<HTMLButtonElement>('[data-action="app-exit-stay"]')?.click()
    expect(stay).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
    screen.querySelector<HTMLButtonElement>('[data-action="app-exit-confirm"]')?.click()
    expect(exit).toHaveBeenCalledOnce()
    cleanup()
  })

  it('reports native exit failure and permits retry', async () => {
    const exit = vi.fn(async () => { throw new Error('Unavailable') })
    const screen = createAppExitModal(vi.fn(), exit)
    const confirm = screen.querySelector<HTMLButtonElement>('[data-action="app-exit-confirm"]')
    if (!confirm) throw new Error('Missing exit action')
    confirm.click()
    await vi.waitFor(() => expect(screen.querySelector('[role="alert"]')?.textContent).toContain('Unavailable'))
    expect(confirm.disabled).toBe(false)
  })

  it('preserves the native button and removes the decorative lens on cleanup', async () => {
    const { root, screen, button, media } = setup()
    const click = vi.fn()
    button.addEventListener('click', click)
    const load = vi.fn(async () => undefined)
    const cleanup = attachMenuGlass(root, screen, load)
    await vi.waitFor(() => expect(button.querySelector('lg-panel')).not.toBeNull())
    expect(button.querySelector('lg-panel')?.getAttribute('aria-hidden')).toBe('true')
    expect(button.querySelector('lg-panel')?.getAttribute('refraction')).toBe('26')
    expect(button.querySelector('lg-panel')?.getAttribute('curvature')).toBe('2')
    expect(button.querySelector('lg-panel')?.getAttribute('chroma')).toBe('0')
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

  it('lenses only visible track tiles, caps the pool and cleans up filtered tiles', async () => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = 'track-library-modal'
    screen.innerHTML = '<div class="track-list">' + Array.from({ length: 12 }, () =>
      '<article class="track-card"><button class="track-card-select">Race</button><button class="track-card-favorite">Star</button></article>').join('') + '</div>'
    root.append(screen)
    let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => { throw new Error('Observer not initialized') }
    const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback }
      observe = observe
      unobserve = unobserve
      disconnect = disconnect
    })
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    const cards = [...screen.querySelectorAll<HTMLElement>('.track-card')]
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(12))
    expect(screen.querySelectorAll('lg-panel')).toHaveLength(0)
    notify(cards.map(target => ({ target, isIntersecting: true })))
    expect(screen.querySelectorAll('.track-card > lg-panel')).toHaveLength(8)
    expect(screen.querySelector('.track-card button lg-panel')).toBeNull()
    expect(cards[0]?.dataset.liquidGlassKind).toBe('card')
    const first = cards[0]
    if (!first) throw new Error('Missing card fixture')
    notify([{ target: first, isIntersecting: false }])
    expect(first.querySelector('lg-panel')).toBeNull()
    expect(screen.querySelectorAll('.track-card > lg-panel')).toHaveLength(8)
    const removed = cards[1]
    if (!removed) throw new Error('Missing card fixture')
    removed.remove()
    await vi.waitFor(() => expect(unobserve).toHaveBeenCalledWith(removed))
    expect(removed.querySelector('lg-panel')).toBeNull()
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
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

  it.each(['nearby-static-modal', 'cup-modal', 'options-modal', 'track-library-modal', 'race-setup-modal'])(
    'automatically styles body and footer actions on %s without decorating content cards', async className => {
      const { root } = setup()
      const screen = document.createElement('div')
      screen.className = className
      screen.innerHTML = '<div class="modal-body"><button class="button button-primary">Host</button><button class="button">Join</button><article class="track-card"><button class="button">Card</button></article><button class="setup-choice">Connection</button></div><footer class="modal-footer"><button class="button">Back</button></footer>'
      root.append(screen)
      const cleanup = attachMenuGlass(root, screen, async () => undefined)
      expect(screen.dataset.menuMaterial).toBe('static')
      await vi.waitFor(() => expect(screen.querySelectorAll('lg-panel')).toHaveLength(3))
      expect(screen.querySelector('.track-card lg-panel, .setup-choice lg-panel')).toBeNull()
      cleanup()
    },
  )

  it('keeps closed diagnostics unmounted until opened and preserves Low paint capability', async () => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = 'nearby-static-modal'
    screen.innerHTML = '<button class="button">Back</button><details><summary>Diagnostics</summary><button class="button">Download</button></details>'
    root.append(screen)
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    const details = screen.querySelector('details')!
    await vi.waitFor(() => expect(screen.querySelector(':scope > button > lg-panel')).not.toBeNull())
    expect(details.querySelector('lg-panel')).toBeNull()
    details.open = true
    await vi.waitFor(() => expect(details.querySelector('lg-panel')).not.toBeNull())
    details.open = false
    await vi.waitFor(() => expect(details.querySelector('lg-panel')).toBeNull())
    cleanup()
    root.dataset.graphicsQuality = 'low'
    const load = vi.fn(async () => undefined)
    attachMenuGlass(root, screen, load)()
    expect(screen.dataset.menuMaterial).toBe('static')
    expect(load).not.toHaveBeenCalled()
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

  it.each(['pause-modal', 'results-modal', 'nearby-race-modal', 'editor-exit-modal', 'track-name-modal', 'player-name-modal'])('never adds lenses to live %s overlays', (className) => {
    const { root } = setup()
    const screen = document.createElement('div')
    screen.className = className
    root.append(screen)
    const load = vi.fn(async () => undefined)
    attachMenuGlass(root, screen, load)()
    expect(load).not.toHaveBeenCalled()
  })

  it.each([
    ['editor-menu-modal', '<button class="track-icon-action">Rename</button><button class="track-icon-action">Share</button><button class="button button-primary">Save track</button><button class="button">Save as</button><button class="button">Race track</button><span class="editor-menu-select-surface"><select><option>Grass</option></select></span><span class="editor-menu-select-surface"><select><option>Circuit</option></select></span><button class="button button-danger">Return home</button>', 9],
    ['track-share-modal', '<button class="button button-primary">Nearby</button><button class="button">Export</button><button class="button">Cancel</button>', 4],
  ] as const)('mounts real card-backed lenses throughout %s', async (className, controls, count) => {
    const { root } = setup('high')
    const screen = document.createElement('div')
    screen.className = className
    screen.innerHTML = '<section class="modal-card"><button class="modal-close">Close</button>' + controls + '</section>'
    root.append(screen)
    const cleanup = attachMenuGlass(root, screen, async () => undefined)
    await vi.waitFor(() => expect(screen.querySelectorAll('lg-panel')).toHaveLength(count))
    for (const panel of screen.querySelectorAll('lg-panel')) {
      expect(panel.getAttribute('backdrop')).toBe('.' + className + ' .modal-card')
      expect(panel.getAttribute('chroma')).toBe('0.08')
    }
    expect(screen.querySelector('select lg-panel, lg-panel lg-panel')).toBeNull()
    expect(screen.querySelector('.track-icon-action lg-panel')?.getAttribute('radius')).toBe(className === 'editor-menu-modal' ? 'capsule' : undefined)
    cleanup()
    expect(screen.querySelectorAll('lg-panel')).toHaveLength(0)
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
