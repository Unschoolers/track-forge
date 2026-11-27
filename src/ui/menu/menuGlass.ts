/** Static artwork is a screen capability, not a per-button allowlist.
 * All standard actions share one policy; content cards and live canvases are
 * deliberately excluded. Choices in settings remain paint-only. */
const standardActions = 'button:is(.tf-menu-action, .button, .modal-close):not(:where(.track-card *, .cup-track-row *))'
const menuSurfaces = [
  { screen: '.home-screen', backdrop: '.home-artwork', groups: '' },
  { screen: '.track-library-modal', backdrop: '.track-library-modal', groups: '.track-library-toolbar' },
  { screen: '.race-setup-modal', backdrop: '.race-setup-modal', groups: '' },
  { screen: '.options-modal', backdrop: '.options-modal', groups: '.options-tab-list' },
  { screen: '.cup-modal', backdrop: '.cup-modal', groups: '' },
  { screen: '.nearby-static-modal', backdrop: '.nearby-static-modal', groups: '' },
] as const

/** One upstream lens per independent action or semantic group, never nested. */
export function attachMenuGlass(
  root: HTMLElement,
  screen: HTMLElement | undefined,
  load: () => Promise<unknown> = () => import('../../vendor/liquidglass/components.js'),
): () => void {
  const config = screen && menuSurfaces.find(item => screen.matches(item.screen))
  if (!screen || !config) return () => undefined
  // Paint and optical material share this capability marker, even on Low or
  // when a browser cannot render SVG lenses.
  screen.dataset.menuMaterial = 'static'
  const actionsSelector = screen.matches('.race-setup-modal')
    ? standardActions + ', .race-preparation-sections .setup-choice'
    : standardActions
  if (root.dataset.graphicsQuality === 'low' ||
      typeof ResizeObserver === 'undefined' || !window.CSS?.supports?.('filter', 'url(#liquidglass)')) return () => undefined

  const preference = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  const panels = new Map<HTMLElement, HTMLElement>()
  let disposed = false
  let loading = false
  let loaded = false
  const dynamic = screen.matches('.options-modal, .nearby-static-modal')

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
    const visible = (surface: HTMLElement) => !surface.closest('[hidden], details:not([open])')
    const groups = config.groups ? [...screen.querySelectorAll<HTMLElement>(config.groups)].filter(visible) : []
    const actions = [...screen.querySelectorAll<HTMLElement>(actionsSelector)]
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
  const selector = [actionsSelector, config.groups].filter(Boolean).join(', ')
  const containsControl = (node: Node) => node instanceof Element &&
    (node.matches(selector) || node.querySelector(selector) !== null)
  const observer = dynamic ? new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes'
      ? containsControl(record.target)
      : [...record.addedNodes, ...record.removedNodes].some(containsControl) ||
        [...record.removedNodes].some(node => node instanceof Element &&
          [...panels.keys()].some(surface => node === surface || node.contains(surface))))) sync()
  }) : undefined
  observer?.observe(screen, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] })

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
