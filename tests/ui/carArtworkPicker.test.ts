// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import { createCarPicker } from '@/ui/components/carPicker'
import { getVehicleArtwork, vehiclePaintColor } from '@/presentation/vehicleArtwork'

describe('car picker artwork', () => {
  it('shows the same authored polygons as the race and flyover for all four choices', () => {
    const onSelect = vi.fn()
    const picker = createCarPicker('yellow', onSelect)
    for (const id of CAR_IDS) {
      const choice = picker.querySelector<HTMLButtonElement>(`[data-car="${id}"]`)
      expect(choice?.getAttribute('aria-pressed')).toBe(String(id === 'yellow'))
      const art = getVehicleArtwork(id)
      const shapes = choice?.querySelectorAll('svg polygon')
      expect(shapes).toHaveLength(art.layers.length)
      for (const [index, layer] of art.layers.entries()) {
        const shape = shapes?.item(index)
        expect(shape?.getAttribute('points'))
          .toBe(layer.points.map(({ x, y }) => `${x},${y}`).join(' '))
        expect(shape?.getAttribute('fill'))
          .toBe(`#${vehiclePaintColor(id, layer.tone).toString(16).padStart(6, '0')}`)
      }
      expect(choice?.querySelectorAll('svg circle')).toHaveLength(4)
      expect(choice?.textContent).toContain(id.toUpperCase())
    }
    picker.querySelector<HTMLButtonElement>('[data-car="green"]')?.click()
    expect(onSelect).toHaveBeenCalledWith('green')
  })
})
