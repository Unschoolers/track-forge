import type { CarId } from '@/domain/model'
import type { GhostSetup } from '@/application/race/ghostReplay'
import { createCarPicker } from '@/ui/components/carPicker'
import { element } from '@/ui/dom'

interface RacePreparationOptions {
  readonly car: CarId
  readonly selectCar: (car: CarId) => void
  readonly carLocked?: boolean
  readonly ghostSetups?: readonly GhostSetup[] | undefined
  readonly preview?: HTMLElement | undefined
  readonly metadata: string
  readonly sections: readonly HTMLElement[]
}

/** Shared visual structure only; each race mode owns its controls and policy. */
export function populateRacePreparation(body: HTMLElement, options: RacePreparationOptions): void {
  body.classList.add('race-preparation-body')
  if (options.preview) body.append(options.preview)
  body.append(element('p', 'modal-subtitle race-preparation-meta', options.metadata))
  const columns = element('div', 'race-preparation-columns')
  const picker = createCarPicker(options.car, options.selectCar, { disabled: options.carLocked ?? false, ghostSetups: options.ghostSetups })
  picker.classList.add('race-preparation-picker')
  const sections = element('div', 'race-preparation-sections')
  sections.append(...options.sections)
  columns.append(picker, sections)
  body.append(columns)
}
