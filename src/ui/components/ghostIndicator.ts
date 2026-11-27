/** Informational replay glyph on an existing choice; no nested button. */
export function appendGhostIndicator(choice: HTMLButtonElement, description: string): void {
  const marker = document.createElement('span')
  marker.className = 'setup-ghost-indicator'
  marker.setAttribute('aria-hidden', 'true')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M12 3a8 8 0 0 0-8 8v10l4-3 4 3 4-3 4 3V11a8 8 0 0 0-8-8ZM9 10h.01M15 10h.01')
  svg.append(path)
  marker.append(svg)
  choice.append(marker)
  choice.setAttribute('aria-description', description)
  choice.title = description
}
