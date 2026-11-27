/** Only these static-art menus own optical surfaces. No HUD, editor or canvas targets. */
const menuSurfaces = [
  { screen: '.home-screen', backdrop: '.home-artwork', actions: 'button.tf-menu-action', groups: '' },
  { screen: '.track-library-modal', backdrop: '.track-library-modal', actions: '.modal-footer > .button, .modal-close', groups: '.track-library-toolbar' },
  { screen: '.race-setup-modal', backdrop: '.race-setup-modal', actions: '.modal-footer > .button, .modal-close, .race-preparation-sections .setup-choice', groups: '' },
  { screen: '.options-modal', backdrop: '.options-modal', actions: '.modal-footer > .button, .modal-close, .options-update-actions .button, .options-download-panel .button, .name-form .button, .release-notes-scroll .button', groups: '.options-tab-list' },
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
  let loaded = false
  const dynamic = screen.matches('.options-modal')

  const clear = () => {
    for (const [surface, panel] of panels) {
      panel.remove()
      delete surface.dataset.liquidGlass
      delete surface.dataset.liquidGlassKind
    }
    panels.clear()
  }

  const sync = () => {
    if (disposed || !loaded || preference.matches || !root.contains(screen)) return
    const visible = (surface: HTMLElement) => !dynamic || !surface.closest('[hidden]')
    const groups = config.groups ? [...screen.querySelectorAll<HTMLElement>(config.groups)].filter(visible) : []
    const actions = [...screen.querySelectorAll<HTMLElement>(config.actions)]
      .filter(action => visible(action) && !groups.some(group => group.contains(action)))
    const surfaces = new Set([...groups, ...actions])
    for (const [surface, panel] of panels) {
      if (surfaces.has(surface)) continue
      panel.remove()
      delete surface.dataset.liquidGlass
      delete surface.dataset.liquidGlassKind
      panels.delete(surface)
    }
    for (const surface of surfaces) {
      if (panels.has(surface)) continue
      const group = groups.includes(surface)
      const panel = document.createElement('lg-panel')
      panel.setAttribute('aria-hidden', 'true')
      panel.setAttribute('backdrop', config.backdrop)
      panel.setAttribute('radius', surface.matches('.modal-close, .options-release-notes-button') ? 'capsule' : '18')
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
  }

  const mount = () => {
    if (disposed || preference.matches || loading) return
    if (loaded) { sync(); return }
    loading = true
    void load().then(() => {
      loaded = true
      sync()
    }).catch((error: unknown) => {
      clear()
      console.error('LiquidGlass.dev menu material failed to initialize', error)
    }).finally(() => { loading = false })
  }

  // Update controls and the release reader are replaced asynchronously. Observe
  // only structural/visibility changes involving actual controls, not lens internals.
  const selector = [config.actions, config.groups].filter(Boolean).join(', ')
  const containsControl = (node: Node) => node instanceof Element &&
    (node.matches(selector) || node.querySelector(selector) !== null)
  const observer = dynamic ? new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes'
      ? containsControl(record.target)
      : [...record.addedNodes, ...record.removedNodes].some(containsControl) ||
        [...record.removedNodes].some(node => node instanceof Element &&
          [...panels.keys()].some(surface => node === surface || node.contains(surface))))) sync()
  }) : undefined
  observer?.observe(screen, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })

  const onPreference = () => { if (preference.matches) clear(); else mount() }
  preference.addEventListener('change', onPreference)
  mount()
  return () => {
    disposed = true
    observer?.disconnect()
    preference.removeEventListener('change', onPreference)
    clear()
  }
}
