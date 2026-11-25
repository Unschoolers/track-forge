import { describe, expect, it } from 'vitest'
import { harborOilSlicks } from '@/presentation/environments/harborOilSlicks'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'
import { CITY_TERRAIN_ART } from '@/presentation/environments/bitmapTerrainPalette'

describe('harbor oil artwork', () => {
  it('uses bounded deterministic world-space clusters, including negative tiles', () => {
    const tiles = [{ x: -2, y: -1 }, { x: 0, y: 0 }, { x: 5, y: 8 }]
    for (const tile of tiles) {
      const slicks = harborOilSlicks(tile)
      expect(slicks).toEqual(harborOilSlicks(tile))
      expect(slicks.length).toBeLessThanOrEqual(9)
      for (const slick of slicks) {
        expect(slick.radius).toBeGreaterThanOrEqual(25)
        expect(slick.radius).toBeLessThanOrEqual(56)
      }
    }
    expect(harborOilSlicks({ x: -2, y: -1 })).not.toEqual(harborOilSlicks({ x: 5, y: 8 }))
  })

  it('shares crossing clusters with the neighboring tile', () => {
    let crossingCount = 0
    for (let x = -5; x <= 5; x++) {
      const left = harborOilSlicks({ x, y: 0 })
      const right = harborOilSlicks({ x: x + 1, y: 0 })
      const boundary = (x + 1) * GROUND_TILE_SIZE
      for (const slick of left) {
        if (Math.abs(slick.x - boundary) < slick.radius && slick.y >= 0 && slick.y <= GROUND_TILE_SIZE) {
          expect(right).toContainEqual(slick)
          crossingCount++
        }
      }
    }
    expect(crossingCount).toBeGreaterThan(0)
  })

  it('keeps oil detail enabled in both city lighting profiles', () => {
    expect(CITY_TERRAIN_ART.day.waterDetail).toBe('oil-slicks')
    expect(CITY_TERRAIN_ART.night.waterDetail).toBe('oil-slicks')
  })
})
