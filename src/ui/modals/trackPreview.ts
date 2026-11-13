import type { Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'

/** Render the same sampled centerline used by the race and editor. */
export function createTrackPreview(path: RoadPath, firstPoint?: Vector2): SVGSVGElement {
  const { points, closed } = path
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('track-preview')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  if (points.length === 0) {
    svg.setAttribute('viewBox', '0 0 100 50')
    if (firstPoint) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('cx', '50')
      dot.setAttribute('cy', '25')
      dot.setAttribute('r', '2.5')
      dot.setAttribute('fill', 'currentColor')
      svg.append(dot)
    }
    return svg
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const padding = Math.max(width, height) * 0.1
  svg.setAttribute('viewBox', `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`)
  const route = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  route.setAttribute('d', `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}${closed ? ' Z' : ''}`)
  route.setAttribute('fill', 'none')
  route.setAttribute('stroke', 'currentColor')
  route.setAttribute('stroke-width', '2.5')
  route.setAttribute('vector-effect', 'non-scaling-stroke')
  route.setAttribute('stroke-linecap', 'round')
  route.setAttribute('stroke-linejoin', 'round')
  svg.append(route)
  return svg
}
