import { button } from '@/ui/dom'

/** Inline vector icons keep editor controls legible on Android WebView
 * without relying on Unicode glyph coverage or system fonts. */
const paths = {
  home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-7h6v7',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  undo: 'M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-2',
  redo: 'm15 14 5-5-5-5 M20 9H10a6 6 0 0 0 0 12h2',
  'zoom-in': 'M12 8v8 M8 12h8 M21 21l-4.3-4.3 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  'zoom-out': 'M8 12h8 M21 21l-4.3-4.3 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M3 16v3a2 2 0 0 0 2 2h3 M21 16v3a2 2 0 0 1-2 2h-3 M8 8h8v8H8z',
  expand: 'M8 3H3v5 M3 3l7 7 M16 21h5v-5 M21 21l-7-7',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  save: 'M5 3h12l4 4v14H3V3h2 M7 3v6h10V3 M7 21v-9h10v9',
  clear: 'M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  load: 'M3 7h6l2 3h10v10H3z M3 10V5h7',
  race: 'M8 4v16l13-8z',
  draw: 'm4 20 4-1 12-12-3-3L5 16z M14 7l3 3',
  select: 'M5 3v16l5-5 3 7 3-2-3-6h7z',
  start: 'M5 21V4 M5 5c6-3 9 3 15 0v10c-6 3-9-3-15 0',
  paint: 'm12 3 9 9-9 9-9-9z M3 12h18',
  structure: 'M3 21h18 M5 18V8 M19 18V8 M5 10c4-6 10-6 14 0 M9 18v-7 M15 18v-7',
  terrain: 'M2 20 9 9l5 7 3-4 5 8z M3 5h4 M5 3v4',
  pan: 'M12 2v20 M2 12h20 M12 2 9 5 M12 2l3 3 M12 22l-3-3 M12 22l3-3 M2 12l3-3 M2 12l3 3 M22 12l-3-3 M22 12l-3 3',
  tree: 'M12 22v-7 M7 15h10l-3-4h2l-4-8-4 8h2z',
  erase: 'm3 16 10-11a3 3 0 0 1 4 0l4 4-10 11H7z M10 9l8 8 M11 20h10',
} as const

export type EditorIcon = keyof typeof paths

export function editorIconButton(
  icon: EditorIcon,
  action: string,
  label: string,
  onClick: () => void,
  className = 'icon-button',
): HTMLButtonElement {
  const control = button('', action, onClick, className)
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
  svg.classList.add('editor-icon')
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', paths[icon])
  svg.append(shape)
  control.append(svg)
  return control
}
