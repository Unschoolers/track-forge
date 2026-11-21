import { CAR_IDS, type CarId } from '@/domain/model'
import { CAR_SPECS } from '@/domain/config'
import { getVehicleArtwork, vehiclePaintColor } from '@/presentation/vehicleArtwork'
import { button, element } from '@/ui/dom'

const SVG_NS = 'http://www.w3.org/2000/svg'

function carSilhouette(car: CarId): SVGSVGElement {
  const art = getVehicleArtwork(car)
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '-29 -16 60 32')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('car-silhouette')
  for (const layer of art.layers) {
    const polygon = document.createElementNS(SVG_NS, 'polygon')
    polygon.setAttribute('points', layer.points.map(({ x, y }) => `${x},${y}`).join(' '))
    polygon.setAttribute('fill', `#${vehiclePaintColor(car, layer.tone).toString(16).padStart(6, '0')}`)
    if (layer.outline) {
      polygon.setAttribute('stroke', '#101923')
      polygon.setAttribute('stroke-width', '1.4')
    }
    svg.append(polygon)
  }
  for (const [color, lamps, radius] of [
    ['#eaf7ff', art.headlights, 1.7],
    ['#5b1620', art.taillights, 1.5],
  ] as const) {
    for (const lamp of lamps) {
      const light = document.createElementNS(SVG_NS, 'circle')
      light.setAttribute('cx', String(lamp.x))
      light.setAttribute('cy', String(lamp.y))
      light.setAttribute('r', String(radius))
      light.setAttribute('fill', color)
      svg.append(light)
    }
  }
  return svg
}

export function createCarPicker(
  selected: CarId,
  select: (car: CarId) => void,
): HTMLElement {
  const section = element('section', 'setup-section')
  section.append(element('h3', 'setup-label', 'CHOOSE YOUR CAR'))
  const row = element('div', 'car-picker')
  for (const car of CAR_IDS) {
    const spec = CAR_SPECS[car]
    const choice = button(
      spec.name.toUpperCase(),
      `car-${car}`,
      () => select(car),
      `car-choice${car === selected ? ' active' : ''}`,
    )
    choice.prepend(carSilhouette(car))
    choice.dataset.car = car
    choice.style.setProperty('--car-color', spec.color)
    choice.setAttribute(
      'aria-pressed',
      String(car === selected),
    )
    row.append(choice)
  }
  const spec = CAR_SPECS[selected]
  const summary = element('div', 'car-summary')
  summary.append(
    element('strong', 'car-summary-title', `${spec.name} — ${spec.role}`),
    element('p', 'modal-subtitle', spec.description),
  )
  const stats = element('div', 'car-stats')
  for (const [label, value] of [
    ['SPEED', spec.uiSpeed],
    ['GRIP', spec.uiGrip],
    ['BRAKES', spec.uiBrake],
    ['OFF-ROAD', spec.uiOffroad],
  ] as const) {
    const stat = element('div', 'car-stat')
    stat.append(
      element('strong', undefined, `${value}/5`),
      element('span', 'label', label),
    )
    stats.append(stat)
  }
  summary.append(stats)
  section.append(row, summary)
  return section
}
