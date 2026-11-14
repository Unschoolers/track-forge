import { element } from '@/ui/dom'

export function createVolumeRow(
  title: string,
  action: string,
  volume: number,
  preview: (volume: number) => void,
  commit: (volume: number) => void,
): HTMLElement {
  const row = element('label', 'setting-row volume-row')
  const slider = element('input', 'volume-slider')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '100'
  slider.value = String(volume)
  slider.dataset.action = action
  slider.setAttribute('aria-label', title)

  const percentage = element('span', 'volume-value')
  percentage.setAttribute('aria-hidden', 'true')
  function showValue(): void {
    percentage.textContent = `${slider.value}%`
    slider.setAttribute('aria-valuetext', `${slider.value}%`)
  }
  showValue()
  slider.addEventListener('input', () => {
    showValue()
    preview(slider.valueAsNumber)
  })
  slider.addEventListener('change', () => commit(slider.valueAsNumber))

  row.append(element('strong', 'setting-title', title), slider, percentage)
  return row
}
