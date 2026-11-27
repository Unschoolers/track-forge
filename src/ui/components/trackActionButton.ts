import { button, element } from '@/ui/dom'

type TrackActionIcon = 'edit' | 'share' | 'nearby' | 'delete' | 'search'
const actionPaths: Record<TrackActionIcon, string> = {
  edit: 'M4 20h4l11-11-4-4L4 16v4z M13 7l4 4',
  share: 'M12 16V3 M7 8l5-5 5 5 M5 13v7h14v-7',
  nearby: 'M5 18v-4 M10 18v-7 M15 18V8 M20 18V5',
  delete: 'M4 7h16 M10 4h4 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0 M14.5 14.5 21 21',
}

export function iconAction(label: string, icon: TrackActionIcon, action: string, invoke: () => void, variant = ''): HTMLButtonElement {
  const control = button('', action, invoke, `track-mini-button track-icon-action ${variant}`.trim())
  control.setAttribute('aria-label', label)
  control.title = label
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', actionPaths[icon])
  svg.append(path)
  control.append(svg, element('span', undefined, label))
  return control
}
