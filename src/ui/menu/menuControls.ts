import { button, element } from '@/ui/dom'

export function createMenuAction(label: string, action: string, onClick: () => void,
  prominence: 'primary' | 'secondary' = 'secondary'): HTMLButtonElement {
  return button(label, action, onClick, `tf-menu-action tf-menu-action--${prominence}`)
}

export interface MenuChoice<T extends string> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
}

export interface MenuChoices<T extends string> {
  readonly element: HTMLFieldSetElement
  setValue(value: T): void
}

let groupSequence = 0

/** Native radio semantics. The caller commits state and can restore a rejected choice. */
export function createMenuChoices<T extends string>(
  label: string, choices: readonly MenuChoice<T>[], value: T, onChange: (value: T) => void,
): MenuChoices<T> {
  const field = element('fieldset', 'tf-menu-choices')
  field.append(element('legend', 'tf-menu-legend', label))
  const row = element('div', 'tf-menu-choice-row')
  const name = `tf-menu-choice-${++groupSequence}`
  const inputs = new Map<T, HTMLInputElement>()
  for (const choice of choices) {
    if (inputs.has(choice.value)) throw new Error('Duplicate menu choice')
    const item = element('label', 'tf-menu-choice')
    const input = element('input')
    input.type = 'radio'
    input.name = name
    input.value = choice.value
    input.disabled = choice.disabled ?? false
    input.addEventListener('change', () => {
      if (input.checked && !input.disabled) onChange(choice.value)
    })
    inputs.set(choice.value, input)
    item.append(input, element('span', 'tf-menu-choice-label', choice.label))
    row.append(item)
  }
  const setValue = (next: T): void => {
    if (!inputs.has(next)) throw new Error('Unknown menu choice')
    for (const [key, input] of inputs) input.checked = key === next
  }
  setValue(value)
  field.append(row)
  return { element: field, setValue }
}
