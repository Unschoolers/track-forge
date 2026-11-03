import { CAR_IDS, type CarId } from '@/domain/model'
import { CAR_SPECS } from '@/domain/config'
import { button, element } from '@/ui/dom'

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
