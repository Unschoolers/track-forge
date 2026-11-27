import { TOPPER_COLORS, TOPPER_ICONS, type PlayerIdentity, type TopperColor, type TopperIcon } from '@/application/multiplayer/playerIdentity'
import { button, element } from '@/ui/dom'

/** Emoji renderers ignore CSS color on Android. Draw the bolt as a tintable icon. */
function createTopperGlyph(icon: TopperIcon): HTMLElement | SVGSVGElement {
  if (icon !== 'bolt') return element('span', undefined, TOPPER_ICONS[icon])
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('topper-glyph')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M13.5 1.5 4.5 13h6.5l-1 9.5L20 9h-6.5V1.5z')
  svg.append(path)
  return svg
}

export function createTopperMarker(identity: PlayerIdentity): HTMLSpanElement {
  const marker = element('span', 'topper-marker')
  marker.style.color = '#' + TOPPER_COLORS[identity.color].toString(16).padStart(6, '0')
  marker.append(createTopperGlyph(identity.icon))
  return marker
}

export function createTopperSelector(
  identity: PlayerIdentity,
  customizing: boolean,
  toggle?: () => void,
  change?: (identity: PlayerIdentity) => void,
  actionPrefix: 'nearby' | 'options' = 'nearby',
): HTMLElement {
  const section = element('section', 'setup-section topper-section')
  const current = element('div', 'topper-current')
  const marker = createTopperMarker(identity)
  current.append(marker, element('span', 'modal-subtitle', `Your topper · ${identity.icon} / ${identity.color}`))
  if (toggle) current.append(button(customizing ? 'DONE' : 'CHANGE', `${actionPrefix}-customize-topper`, toggle, 'button'))
  section.append(current)
  if (!customizing || !change) return section

  const icons = element('div', 'topper-options')
  icons.setAttribute('role', 'group')
  icons.setAttribute('aria-label', 'Topper icon')
  for (const icon of Object.keys(TOPPER_ICONS) as TopperIcon[]) {
    const choice = button('', `${actionPrefix}-topper-icon-${icon}`,
      () => change({ ...identity, icon }), `setup-choice topper-choice${icon === identity.icon ? ' active' : ''}`)
    choice.append(createTopperGlyph(icon))
    choice.title = `${icon} topper`
    choice.setAttribute('aria-label', `${icon} topper`)
    choice.setAttribute('aria-pressed', String(icon === identity.icon))
    icons.append(choice)
  }
  section.append(element('p', 'setup-label', 'TOPPER ICON'), icons)

  const colors = element('div', 'topper-options topper-colors')
  colors.setAttribute('role', 'group')
  colors.setAttribute('aria-label', 'Topper color')
  for (const color of Object.keys(TOPPER_COLORS) as TopperColor[]) {
    const choice = button(color[0]!.toUpperCase() + color.slice(1), `${actionPrefix}-topper-color-${color}`,
      () => change({ ...identity, color }), `setup-choice topper-choice topper-color-choice${color === identity.color ? ' active' : ''}`)
    choice.style.setProperty('--topper-choice-color', '#' + TOPPER_COLORS[color].toString(16).padStart(6, '0'))
    choice.setAttribute('aria-label', `${color} topper color`)
    choice.setAttribute('aria-pressed', String(color === identity.color))
    colors.append(choice)
  }
  section.append(element('p', 'setup-label', 'TOPPER COLOR'), colors)
  return section
}

