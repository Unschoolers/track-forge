/** Only these static-art menus own optical surfaces. No HUD, editor or canvas targets. */
const menuSurfaces = [
  { screen: '.home-screen', backdrop: '.home-artwork', actions: 'button.tf-menu-action', groups: '' },
  { screen: '.track-library-modal', backdrop: '.track-library-modal', actions: '.modal-footer > .button, .modal-close', groups: '.track-library-toolbar' },
  { screen: '.race-setup-modal', backdrop: '.race-setup-modal', actions: '.modal-footer > .button, .modal-close, .race-preparation-sections .setup-choice', groups: '' },
  { screen: '.options-modal', backdrop: '.options-modal', actions: '.modal-footer > .button, .modal-close', groups: '.options-tab-list' },
  { screen: '.cup-modal', backdrop: '.cup-modal', actions: '.modal-footer > .button, .modal-close', groups: '' },
  { screen: '.nearby-static-modal', backdrop: '.nearby-static-modal', actions: '.modal-footer > .button, .modal-close', groups: '' },
] as const

/** One upstream lens per independent action or semantic group, never nested. */
export function attachMenuGlass(
  root: HTMLElement,
  screen: HTMLElement | undefined,
  load: () => Promise<unknown> = () => import('../../vendor/liquidglass/components.js'),
): () => void {
  const config = screen && menuSurfaces.find(item => screen.matches(item.screen))
  if (!screen || !config || root.dataset.graphicsQuality === 'low' ||
      typeof ResizeObserver === 'undefined' || !window.CSS?.supports?.('filter', 'url(#liquidglass)')) return () => undefined

  const preference = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  const panels = new Map<HTMLElement, HTMLElement>()
  let disposed = false
  let loading = false

  const clear = () => {
    for (const [surface, panel] of panels) {
      panel.remove()
      delete surface.dataset.liquidGlass
      delete surface.dataset.liquidGlassKind
    }
    panels.clear()
  }

  const mount = () => {
    if (disposed || preference.matches || loading || panels.size) return
    loading = true
    void load().then(() => {
      if (disposed || preference.matches || !root.contains(screen)) return
      const groups = config.groups ? [...screen.querySelectorAll<HTMLElement>(config.groups)] : []
      const actions = [...screen.querySelectorAll<HTMLElement>(config.actions)]
        .filter(action => !groups.some(group => group.contains(action)))
      for (const surface of [...groups, ...actions]) {
        const group = groups.includes(surface)
        const panel = document.createElement('lg-panel')
        panel.setAttribute('aria-hidden', 'true')
        panel.setAttribute('backdrop', config.backdrop)
        panel.setAttribute('radius', surface.classList.contains('modal-close') ? 'capsule' : '18')
        panel.setAttribute('refraction', group ? '14' : '18')
        panel.setAttribute('bezel', group ? '0.45' : '0.75')
        panel.setAttribute('curvature', '3')
        panel.setAttribute('chroma', root.dataset.graphicsQuality === 'high' ? '0.1' : '0')
        panel.setAttribute('blur', '0')
        panel.setAttribute('specular', '0.8')
        panel.setAttribute('specular-width', '1.5')
        surface.dataset.liquidGlass = ''
        surface.dataset.liquidGlassKind = group ? 'group' : 'action'
        panels.set(surface, panel)
        surface.prepend(panel)
      }
    }).catch((error: unknown) => {
      clear()
      console.error('LiquidGlass.dev menu material failed to initialize', error)
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
