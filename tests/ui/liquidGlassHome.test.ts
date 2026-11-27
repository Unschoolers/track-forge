// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachLiquidGlassHome } from '@/ui/menu/liquidGlassHome'

function setup(quality = 'medium') {
  const root = document.createElement('div')
  root.dataset.graphicsQuality = quality
  root.innerHTML = '<section class="home-screen"><button class="tf-menu-action" data-action="race">Race</button></section>'
  document.body.append(root)
  vi.stubGlobal('ResizeObserver', class {})
  vi.stubGlobal('CSS', { supports: () => true })
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  return { root, button: root.querySelector('button')!, media }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('LiquidGlass.dev Home adapter', () => {
  it('preserves the native button and removes the decorative lens on cleanup', async () => {
    const { root, button, media } = setup()
    const click = vi.fn()
    button.addEventListener('click', click)
    const load = vi.fn(async () => undefined)
    const cleanup = attachLiquidGlassHome(root, load)
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

  it('does not load optics on low quality or reduced transparency', () => {
    const low = setup('low')
    const load = vi.fn(async () => undefined)
    attachLiquidGlassHome(low.root, load)()
    const reduced = setup()
    reduced.media.matches = true
    attachLiquidGlassHome(reduced.root, load)()
    expect(load).not.toHaveBeenCalled()
  })

  it('does not mount after navigation disposes a pending module load', async () => {
    const { root, button } = setup()
    let resolve: () => void = () => { throw new Error('Module load did not start') }
    const load = () => new Promise<void>(done => { resolve = done })
    const cleanup = attachLiquidGlassHome(root, load)
    cleanup()
    resolve()
    await Promise.resolve()
    expect(button.querySelector('lg-panel')).toBeNull()
  })
})
