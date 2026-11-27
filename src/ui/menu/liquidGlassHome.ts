/** The upstream panel is a decorative lens, never an interactive wrapper. */
export function attachLiquidGlassHome(
  root: HTMLElement,
  load: () => Promise<unknown> = () => import('../../vendor/liquidglass/components.js'),
): () => void {
  const screen = root.querySelector<HTMLElement>('.home-screen')
  if (!screen || root.dataset.graphicsQuality === 'low' ||
      typeof ResizeObserver === 'undefined' || !window.CSS?.supports?.('filter', 'url(#liquidglass)')) return () => undefined

  const preference = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  const panels = new Map<HTMLButtonElement, HTMLElement>()
  let disposed = false
  let loading = false

  const clear = () => {
    for (const [button, panel] of panels) {
      panel.remove()
      delete button.dataset.liquidGlass
    }
    panels.clear()
  }

  const mount = () => {
    if (disposed || preference.matches || loading || panels.size) return
    loading = true
    void load().then(() => {
      if (disposed || preference.matches || !root.contains(screen)) return
      for (const button of screen.querySelectorAll<HTMLButtonElement>('button.tf-menu-action')) {
        const panel = document.createElement('lg-panel')
        panel.setAttribute('aria-hidden', 'true')
        panel.setAttribute('backdrop', '.home-artwork')
        panel.setAttribute('radius', '18')
        panel.setAttribute('refraction', '18')
        panel.setAttribute('bezel', '0.75')
        panel.setAttribute('curvature', '3')
        panel.setAttribute('chroma', root.dataset.graphicsQuality === 'high' ? '0.1' : '0')
        panel.setAttribute('blur', '0')
        panel.setAttribute('specular', '0.8')
        panel.setAttribute('specular-width', '1.5')
        button.prepend(panel)
        button.dataset.liquidGlass = ''
        panels.set(button, panel)
      }
    }).catch((error: unknown) => {
      clear()
      console.error('LiquidGlass.dev Home material failed to initialize', error)
    }).finally(() => { loading = false })
  }

  const onPreference = () => { if (preference.matches) clear(); else mount() }
  preference.addEventListener('change', onPreference)
  mount()
  return () => {
    disposed = true
    preference.removeEventListener('change', onPreference)
    clear()
  }
}
