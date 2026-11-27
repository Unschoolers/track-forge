import { attachLightingArtwork } from '@/ui/components/lightingToggle'
import { glassOptics } from '@/ui/menu/glassMaterial'

/** Static artwork is a screen capability, not a per-button allowlist.
 * All standard actions share one policy; the track library also opts its
 * visible selectable tiles in. Other content cards and live canvases stay excluded. */
const standardActions = 'button.tf-menu-action, button.button, button.modal-close'
const menuSurfaces = [
  { screen: '.home-screen', backdrop: '.home-artwork', groups: '' },
  { screen: '.track-library-modal', backdrop: '.track-library-modal', groups: '.track-library-toolbar' },
  { screen: '.race-setup-modal', backdrop: '.race-setup-modal', groups: '' },
  { screen: '.options-modal', backdrop: '.options-modal', groups: '.options-tab-list' },
  { screen: '.cup-modal', backdrop: '.cup-modal', groups: '' },
  { screen: '.nearby-static-modal', backdrop: '.nearby-static-modal', groups: '' },
  { screen: '.editor-menu-modal', backdrop: '.editor-menu-modal .modal-card', groups: '.editor-menu-select-surface' },
  { screen: '.track-share-modal', backdrop: '.track-share-modal .modal-card', groups: '' },
  { screen: '.app-exit-modal', backdrop: '.app-exit-modal .modal-card', groups: '' },
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
    ? standardActions + ', .race-preparation-sections .setup-choice:not(.lighting-toggle)'
    : screen.matches('.editor-menu-modal, .track-share-modal')
      ? standardActions + ', button.track-icon-action'
      : standardActions
  if (root.dataset.graphicsQuality === 'low' ||
      typeof ResizeObserver === 'undefined' || !window.CSS?.supports?.('filter', 'url(#liquidglass)')) return () => undefined

  const preference = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  const panels = new Map<HTMLElement, HTMLElement>()
  let disposed = false
  let loading = false
  let loaded = false
  let lightingCleanup: (() => void) | undefined
  const library = screen.matches('.track-library-modal')
  const dynamic = library || screen.matches('.options-modal, .nearby-static-modal')
  const observedCards = new Set<HTMLElement>()
  const visibleCards = new Set<HTMLElement>()
  // Limit expensive displacement maps on long scrollable libraries, including
  // desktop and partially visible rows. The remaining tiles retain their paint.
  const cardObserver = library && typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          const card = entry.target as HTMLElement
          if (!observedCards.has(card)) continue
          if (entry.isIntersecting) visibleCards.add(card)
          else visibleCards.delete(card)
        }
        sync()
      })
    : undefined

  const clear = () => {
    lightingCleanup?.()
    lightingCleanup = undefined
    for (const [surface, panel] of panels) {
      panel.remove()
      delete surface.dataset.liquidGlass
      delete surface.dataset.liquidGlassKind
    }
    panels.clear()
  }

  const sync = () => {
    if (disposed || !loaded || preference.matches || !root.contains(screen)) return
    const lighting = screen.querySelector<HTMLButtonElement>('.lighting-toggle')
    if (lighting && !lightingCleanup) {
      lightingCleanup = attachLightingArtwork(lighting, root.dataset.graphicsQuality === 'high')
    }
    const visible = (surface: HTMLElement) => !surface.closest('[hidden], details:not([open])')
    const groups = config.groups ? [...screen.querySelectorAll<HTMLElement>(config.groups)].filter(visible) : []
    const actions = [...screen.querySelectorAll<HTMLElement>(actionsSelector)]
      .filter(action => visible(action) && !action.closest('.track-card, .cup-track-row') &&
        !groups.some(group => group.contains(action)))
    const cards = cardObserver ? [...screen.querySelectorAll<HTMLElement>('.track-card')].filter(visible) : []
    const cardSet = new Set(cards)
    for (const card of observedCards) {
      if (cardSet.has(card)) continue
      cardObserver?.unobserve(card)
      observedCards.delete(card)
      visibleCards.delete(card)
    }
    for (const card of cards) {
      if (observedCards.has(card)) continue
      observedCards.add(card)
      cardObserver?.observe(card)
    }
    const opticalCards = cards.filter(card => visibleCards.has(card)).slice(0, 8)
    const surfaces = new Set([...groups, ...actions, ...opticalCards])
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
      const card = cardSet.has(surface)
      const panel = document.createElement('lg-panel')
      panel.setAttribute('aria-hidden', 'true')
      panel.setAttribute('backdrop', config.backdrop)
      panel.setAttribute('radius', surface.matches('.modal-close, .options-release-notes-button, .track-icon-action') ? 'capsule' : '18')
      const optics = glassOptics(group ? 'group' : 'action', root.dataset.graphicsQuality === 'high')
      for (const [name, value] of Object.entries(optics)) {
        panel.setAttribute(name === 'specularWidth' ? 'specular-width' : name, String(value))
      }
      surface.dataset.liquidGlass = ''
      surface.dataset.liquidGlassKind = card ? 'card' : group ? 'group' : 'action'
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

  // Updates, release notes and disclosed diagnostics can change in place. Observe
  // only structural/visibility changes involving actual controls, not lens internals.
  const selector = [actionsSelector, config.groups, library ? '.track-card' : ''].filter(Boolean).join(', ')
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
    cardObserver?.disconnect()
    observedCards.clear()
    visibleCards.clear()
    preference.removeEventListener('change', onPreference)
    clear()
  }
}
