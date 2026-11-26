import { element } from '@/ui/dom'

export interface MenuLayout {
  readonly root: HTMLElement
  readonly media: HTMLElement
  readonly header: HTMLElement
  readonly content: HTMLElement
  readonly actions: HTMLElement
}

/** Screen anatomy only; the caller owns state, navigation and modal semantics. */
export function createMenuLayout(backdrop: 'static' | 'live' = 'live'): MenuLayout {
  const root = element('section', 'tf-menu')
  root.dataset.backdrop = backdrop
  const media = element('div', 'tf-menu-media')
  media.setAttribute('aria-hidden', 'true')
  const header = element('header', 'tf-menu-header')
  const content = element('main', 'tf-menu-content')
  const actions = element('footer', 'tf-menu-actions')
  root.append(media, header, content, actions)
  return { root, media, header, content, actions }
}

/** One material per functional group; children do not sample the backdrop. */
export function createMenuDock(label: string, material: 'regular' | 'clear' = 'regular'): HTMLElement {
  const dock = element('div', 'tf-menu-dock')
  dock.setAttribute('role', 'group')
  dock.setAttribute('aria-label', label)
  dock.dataset.material = material
  return dock
}
