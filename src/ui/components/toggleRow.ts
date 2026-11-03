import { button, element } from '@/ui/dom'

export function createToggleRow(
  title: string,
  description: string,
  enabled: boolean,
  action: string,
  toggle: () => void,
): HTMLElement {
  const row = element('div', 'setting-row')
  const copy = element('div')
  copy.append(
    element('strong', 'setting-title', title),
    element('p', 'setting-description', description),
  )
  const control = button(
    enabled ? 'ON' : 'OFF',
    action,
    toggle,
    `toggle-button${enabled ? ' active' : ''}`,
  )
  control.setAttribute('aria-pressed', String(enabled))
  row.append(copy, control)
  return row
}
