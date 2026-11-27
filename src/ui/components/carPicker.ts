import { CAR_IDS, type CarId } from '@/domain/model'
import { CAR_SPECS } from '@/domain/config'
import { vehicleBitmapUrl } from '@/presentation/vehicleBitmapArt'
import type { GhostSetup } from '@/application/race/ghostReplay'
import { appendGhostIndicator } from '@/ui/components/ghostIndicator'
import { button, element } from '@/ui/dom'

function carSilhouette(car: CarId): HTMLImageElement {
  const image = document.createElement('img')
  image.src = vehicleBitmapUrl(car)
  image.alt = ''
  image.setAttribute('aria-hidden', 'true')
  image.classList.add('car-silhouette')
  image.draggable = false
  return image
}

export function createCarPicker(
  selected: CarId,
  select: (car: CarId) => void,
  options: { disabled?: boolean; ghostSetups?: readonly GhostSetup[] | undefined } = {},
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
    choice.disabled = options.disabled ?? false
    choice.prepend(carSilhouette(car))
    choice.dataset.car = car
    choice.style.setProperty('--car-color', spec.color)
    choice.setAttribute(
      'aria-pressed',
      String(car === selected),
    )
    const ghostLaps = options.ghostSetups?.filter(setup => setup.car === car).map(setup => setup.laps)
    if (ghostLaps?.length) {
      appendGhostIndicator(choice, `Ghost available for ${ghostLaps.join(', ')} ${ghostLaps.length === 1 && ghostLaps[0] === 1 ? 'lap' : 'laps'}`)
    }
    row.append(choice)
  }
  const spec = CAR_SPECS[selected]
  const summary = element('div', 'car-summary')
  summary.append(
    element('strong', 'car-summary-title', `${spec.name} — ${spec.role}`),
    element('p', 'modal-subtitle', spec.description),
  )
  const stats = element('div', 'car-stats')
  stats.style.setProperty('--car-stat-color', spec.color)
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
    const meter = element('span', 'car-stat-meter')
    meter.setAttribute('aria-hidden', 'true')
    for (let index = 0; index < 5; index++) {
      meter.append(element('span', 'car-stat-segment' + (index < value ? ' filled' : '')))
    }
    stat.append(meter)
    stats.append(stat)
  }
  summary.append(stats)
  section.append(row, summary)
  return section
}
