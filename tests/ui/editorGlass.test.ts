// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachEditorGlass } from '@/ui/menu/editorGlass'

function setup(quality = 'medium') {
  const root = document.createElement('div')
  root.dataset.graphicsQuality = quality
  const screen = document.createElement('section')
  screen.className = 'editor-screen'
  screen.innerHTML = '<header class="topbar"><button>Home</button><span>Track</span><button>Menu</button></header><details><summary class="editor-toolbox-summary">Tools</summary><div class="editor-toolbox-items"><button class="tool-button">Road</button></div></details><footer class="editor-context-dock"><button>Street</button></footer><div class="editor-actions"><button>Save</button><button>Race</button></div>'
  root.append(screen)
  document.body.append(root)
  vi.stubGlobal('ResizeObserver', class {})
  vi.stubGlobal('CSS', { supports: () => true })
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  const destroy = vi.fn()
  const createGlass = vi.fn(() => ({ destroy, update: vi.fn() }))
  const load = vi.fn(async () => ({ engine: 'blink' as const, createGlass }))
  return { root, screen, media, destroy, createGlass, load }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('native editor backdrop glass', () => {
  it('uses independent actions and one lens per group, reconciles drawers, and cleans up', async () => {
    const { root, screen, load, createGlass, destroy } = setup()
    const cleanup = attachEditorGlass(root, screen, load)
    await vi.waitFor(() => expect(screen.querySelectorAll('[data-editor-glass]')).toHaveLength(6))
    expect(createGlass).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ mode: 'backdrop', fit: true, chroma: 0, mapScale: 0.75 }))
    const drawer = screen.querySelector('details')
    if (!drawer) throw new Error('Missing drawer')
    expect(drawer.querySelector('.editor-toolbox-items')?.hasAttribute('data-editor-glass')).toBe(false)
    drawer.open = true
    await vi.waitFor(() => expect(drawer.querySelector('.editor-toolbox-items')?.getAttribute('data-editor-glass')).toBe('group'))
    expect(drawer.querySelector('.tool-button')?.hasAttribute('data-editor-glass')).toBe(false)
    expect(screen.querySelector('.editor-context-dock button')?.hasAttribute('data-editor-glass')).toBe(false)
    drawer.open = false
    await vi.waitFor(() => expect(screen.querySelectorAll('[data-editor-glass]')).toHaveLength(6))
    expect(destroy).toHaveBeenCalledTimes(1)
    cleanup()
    expect(destroy).toHaveBeenCalledTimes(7)
    expect(screen.querySelectorAll('[data-editor-glass]')).toHaveLength(0)
  })

  it('preserves the paint fallback on Low, reduced transparency, unsupported CSS and non-Blink', async () => {
    const low = setup('low')
    attachEditorGlass(low.root, low.screen, low.load)()
    expect(low.load).not.toHaveBeenCalled()
    const reduced = setup()
    reduced.media.matches = true
    attachEditorGlass(reduced.root, reduced.screen, reduced.load)()
    expect(reduced.load).not.toHaveBeenCalled()
    const unsupported = setup()
    vi.stubGlobal('CSS', { supports: () => false })
    attachEditorGlass(unsupported.root, unsupported.screen, unsupported.load)()
    expect(unsupported.load).not.toHaveBeenCalled()
    const other = setup()
    const cleanup = attachEditorGlass(other.root, other.screen, async () => ({ engine: 'webkit', createGlass: other.createGlass }))
    await Promise.resolve()
    expect(other.createGlass).not.toHaveBeenCalled()
    expect(other.screen.querySelectorAll('[data-editor-glass]')).toHaveLength(0)
    cleanup()
  })

  it('does not attach a late module after navigation', async () => {
    const { root, screen, createGlass } = setup()
    const cleanup = attachEditorGlass(root, screen, async () => ({ engine: 'blink', createGlass }))
    cleanup()
    await Promise.resolve()
    expect(createGlass).not.toHaveBeenCalled()
  })
})
