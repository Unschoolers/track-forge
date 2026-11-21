import { TOPPER_COLORS, TOPPER_ICONS, type PlayerIdentity, type TopperColor, type TopperIcon } from '@/application/multiplayer/playerIdentity'
import { button, element } from '@/ui/dom'

export function createTopperSelector(
  identity: PlayerIdentity,
  customizing: boolean,
  toggle?: () => void,
  change?: (identity: PlayerIdentity) => void,
  actionPrefix: 'nearby' | 'options' = 'nearby',
): HTMLElement {
  const section = element('section', 'setup-section topper-section')
  const current = element('div', 'topper-current')
  const marker = element('span', 'topper-marker', TOPPER_ICONS[identity.icon])
  marker.style.color = '#' + TOPPER_COLORS[identity.color].toString(16).padStart(6, '0')
  current.append(marker, element('span', 'modal-subtitle', `Your topper · ${identity.icon} / ${identity.color}`))
  if (toggle) current.append(button(customizing ? 'DONE' : 'CHANGE', `${actionPrefix}-customize-topper`, toggle, 'button'))
  section.append(current)
  if (!customizing || !change) return section

  const icons = element('div', 'topper-options')
  for (const icon of Object.keys(TOPPER_ICONS) as TopperIcon[]) {
    const choice = button(TOPPER_ICONS[icon], `${actionPrefix}-topper-icon-${icon}`,
      () => change({ ...identity, icon }), 'button topper-choice')
    choice.title = `${icon} topper`
    choice.setAttribute('aria-label', `${icon} topper`)
    choice.setAttribute('aria-pressed', String(icon === identity.icon))
    icons.append(choice)
  }
  section.append(element('p', 'setup-label', 'TOPPER ICON'), icons)

  const colors = element('div', 'topper-options')
  for (const color of Object.keys(TOPPER_COLORS) as TopperColor[]) {
    const choice = button(color, `${actionPrefix}-topper-color-${color}`,
      () => change({ ...identity, color }), 'button topper-choice topper-color-choice')
    choice.style.setProperty('--topper-choice-color', '#' + TOPPER_COLORS[color].toString(16).padStart(6, '0'))
    choice.setAttribute('aria-label', `${color} topper color`)
    choice.setAttribute('aria-pressed', String(color === identity.color))
    colors.append(choice)
  }
  section.append(element('p', 'setup-label', 'TOPPER COLOR'), colors)
  return section
}

