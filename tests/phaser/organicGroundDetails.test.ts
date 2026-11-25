import { describe, expect, it } from 'vitest'
import { GROUND_TILE_SIZE, GROUND_TILE_VARIANTS } from '@/presentation/environments/groundTexture'
import { groundDetailPatches, type OrganicGroundTheme } from '@/presentation/environments/organicGroundDetails'

const themes = ['desert', 'cityscape', 'kids-room'] as const satisfies readonly OrganicGroundTheme[]

describe('organic bitmap ground detail', () => {
  it.each(themes)('bakes stable, distinct compositions for all eight %s variants', theme => {
    const plans = Array.from({ length: GROUND_TILE_VARIANTS }, (_, variant) => groundDetailPatches(theme, variant, false))
    expect(new Set(plans.map(plan => JSON.stringify(plan))).size).toBe(GROUND_TILE_VARIANTS)
    for (let variant = 0; variant < GROUND_TILE_VARIANTS; variant++) {
      const day = groundDetailPatches(theme, variant, false)
      const night = groundDetailPatches(theme, variant, true)
      expect(day).toEqual(plans[variant])
      expect(day).toHaveLength(6)
      expect(new Set(day.map(patch => patch.kind)).size).toBe(3)
      expect(night.map(({ colors: _colors, ...geometry }) => geometry))
        .toEqual(day.map(({ colors: _colors, ...geometry }) => geometry))
      expect(night.map(patch => patch.colors)).not.toEqual(day.map(patch => patch.colors))
      for (const patch of day) {
        expect(patch.radius).toBeGreaterThanOrEqual(24)
        expect(patch.x - patch.radius).toBeGreaterThanOrEqual(3 - 1e-9)
        expect(patch.y - patch.radius).toBeGreaterThanOrEqual(3 - 1e-9)
        expect(patch.x + patch.radius).toBeLessThanOrEqual(GROUND_TILE_SIZE - 3 + 1e-9)
        expect(patch.y + patch.radius).toBeLessThanOrEqual(GROUND_TILE_SIZE - 3 + 1e-9)
      }
    }
  })

  it('gives each environment its own ground material vocabulary', () => {
    expect(groundDetailPatches('desert', 0, false).slice(0, 3).map(p => p.kind)).toEqual(['sand', 'gravel', 'dry-grass'])
    expect(groundDetailPatches('cityscape', 0, false).slice(0, 3).map(p => p.kind)).toEqual(['wear', 'cracks', 'moss'])
    expect(groundDetailPatches('kids-room', 0, false).slice(0, 3).map(p => p.kind)).toEqual(['nap', 'stain', 'lint'])
  })
})
