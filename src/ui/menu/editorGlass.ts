import type { GlassController, GlassOptions } from '@/vendor/liquidglass/liquid-glass.js'

type GlassModule = Pick<typeof import('@/vendor/liquidglass/liquid-glass.js'), 'engine' | 'createGlass'>

// A disclosed panel owns one lens; its controls remain ordinary native
// buttons. Absolute positioning and pointer ownership stay with editor CSS.
const groups = '.editor-toolbox-items, .editor-view-items, .editor-context-dock, .point-control, .crossing-control, .start-control, .diagnostic-panel'
const actions = '.topbar > button, .history-actions > button, .editor-toolbox-summary, .editor-view-summary, .editor-actions > button, .status-pill'

/** Native Chromium compositing of the live world. No canvas reads, secondary
 * textures or animation loop. The existing paint is the explicit fallback. */
export function attachEditorGlass(
  root: HTMLElement,
  screen: HTMLElement,
  load: () => Promise<GlassModule> = () => import('@/vendor/liquidglass/liquid-glass.js'),
): () => void {
  if (!screen.matches('.editor-screen') || root.dataset.graphicsQuality === 'low' ||
    typeof ResizeObserver === 'undefined' || !window.matchMedia ||
    !window.CSS?.supports?.('backdrop-filter', 'url(#liquidglass)')) return () => undefined

  const preference = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  const lenses = new Map<HTMLElement, GlassController>()
  let disposed = false
  let loading = false
  let module: GlassModule | undefined
  let failed = false

  function remove(surface: HTMLElement, lens: GlassController): void {
    lens.destroy()
    delete surface.dataset.editorGlass
    lenses.delete(surface)
  }

  function clear(): void {
    for (const [surface, lens] of lenses) remove(surface, lens)
  }

  function sync(): void {
    if (disposed || failed || preference.matches || module?.engine !== 'blink' || !root.contains(screen)) return
    const visible = (element: HTMLElement) => !element.closest('[hidden]') &&
      (!element.closest('details:not([open])') || element.matches('details > summary'))
    const groupSurfaces = [...screen.querySelectorAll<HTMLElement>(groups)].filter(visible)
    const actionSurfaces = [...screen.querySelectorAll<HTMLElement>(actions)].filter(surface =>
      visible(surface) && !groupSurfaces.some(group => group.contains(surface)))
    const surfaces = new Set([...groupSurfaces, ...actionSurfaces])
    for (const [surface, lens] of lenses) {
      if (!surfaces.has(surface)) remove(surface, lens)
    }
    try {
      for (const surface of surfaces) {
        if (lenses.has(surface)) continue
        const group = groupSurfaces.includes(surface)
        const options: GlassOptions = {
          mode: 'backdrop', fit: true, clip: false,
          radius: 18, refraction: group ? 14 : 18,
          bezel: group ? 0.45 : 0.75, curvature: 3,
          chroma: 0, blur: 0, specular: 0.85, specularWidth: 2,
          mapScale: root.dataset.graphicsQuality === 'high' ? 1 : 0.75,
          fallback: 'none',
        }
        const lens = module.createGlass(surface, options)
        lenses.set(surface, lens)
        surface.dataset.editorGlass = group ? 'group' : 'action'
      }
    } catch (error: unknown) {
      failed = true
      clear()
      console.error('LiquidGlass.dev editor backdrop failed to initialize', error)
    }
  }

  function mount(): void {
    if (disposed || failed || preference.matches || loading) return
    if (module) { sync(); return }
    loading = true
    void load().then(loaded => {
      if (disposed) return
      module = loaded
      sync()
    }).catch((error: unknown) => {
      if (disposed) return
      failed = true
      clear()
      console.error('LiquidGlass.dev editor backdrop failed to load', error)
    }).finally(() => { loading = false })
  }

  // The host rebuilds editor chrome on ordinary state changes. Only disclosure
  // and visibility change in place; never observe optical style writes.
  const observer = new MutationObserver(sync)
  observer.observe(screen, { attributes: true, subtree: true, attributeFilter: ['open', 'hidden'] })
  const onPreference = () => { if (preference.matches) clear(); else mount() }
  preference.addEventListener('change', onPreference)
  mount()

  return () => {
    disposed = true
    observer.disconnect()
    preference.removeEventListener('change', onPreference)
    clear()
  }
}
