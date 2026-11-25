import { describe, expect, it } from 'vitest'
import { WATER_TEXTURE_SIZE, waterMaterialPixels } from '@/presentation/environments/waterMaterial'

describe('native water textures', () => {
  it.each(['grass', 'desert', 'cityscape', 'kids-room'] as const)('wraps %s continuously with distinct day and night lighting', environment => {
    const size = WATER_TEXTURE_SIZE
    const day = waterMaterialPixels(environment, false)
    const night = waterMaterialPixels(environment, true)
    expect(day).toHaveLength(size * size * 4)
    expect(day).toEqual(waterMaterialPixels(environment, false))
    expect(day).not.toEqual(night)
    const pixel = (x: number, y: number) => (y * size + x) * 4
    let seam = 0
    const tones = new Set<number>()
    for (let i = 0; i < size; i++) {
      for (let channel = 0; channel < 4; channel++) {
        seam = Math.max(seam, Math.abs((day[pixel(i, 0) + channel] ?? 0) - (day[pixel(i, size - 1) + channel] ?? 0)))
        seam = Math.max(seam, Math.abs((day[pixel(0, i) + channel] ?? 0) - (day[pixel(size - 1, i) + channel] ?? 0)))
      }
      tones.add(day[pixel(i, i) + 1] ?? 0)
    }
    expect(seam).toBeLessThanOrEqual(1)
    expect(tones.size).toBeGreaterThan(10)
  })
  it('preserves the berry-colored liquid identity rather than using blue water everywhere', () => {
    const juice = waterMaterialPixels('kids-room', false)
    const harbor = waterMaterialPixels('cityscape', false)
    expect(juice[0]).toBeGreaterThan(juice[2] ?? 0)
    expect(harbor[0]).toBeLessThan(harbor[2] ?? 0)
  })
})
