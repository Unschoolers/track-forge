// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import { createCarPicker } from '@/ui/components/carPicker'
import { vehicleBitmapUrl } from '@/presentation/vehicleBitmapArt'

describe('car picker artwork', () => {
  it('shows the shared generated bitmap for each car while retaining selection and accessible labels', () => {
    const onSelect = vi.fn()
    const picker = createCarPicker('yellow', onSelect)
    const urls = new Set<string>()
    for (const id of CAR_IDS) {
      const choice = picker.querySelector<HTMLButtonElement>(`[data-car="${id}"]`)
      expect(choice?.getAttribute('aria-pressed')).toBe(String(id === 'yellow'))
      const image = choice?.querySelector<HTMLImageElement>('img.car-silhouette')
      expect(image?.getAttribute('src')).toBe(vehicleBitmapUrl(id))
      expect(image?.alt).toBe('')
      urls.add(vehicleBitmapUrl(id))
      expect(choice?.textContent).toContain(id.toUpperCase())
    }
    expect(urls.size).toBe(4)
    picker.querySelector<HTMLButtonElement>('[data-car="green"]')?.click()
    expect(onSelect).toHaveBeenCalledWith('green')
  })
})
