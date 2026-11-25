import { describe, expect, it, vi } from 'vitest'
import { GROUND_TILE_SIZE, GROUND_TILE_VARIANTS } from '@/presentation/environments/groundTexture'
import { groundDetailPatches, paintOrganicGround, type OrganicGroundTheme } from '@/presentation/environments/organicGroundDetails'

const themes = ['desert', 'cityscape', 'kids-room'] as const satisfies readonly OrganicGroundTheme[]

describe('organic bitmap ground detail', () => {
  it.each(themes)('bakes stable, distinct, bounded compositions for all eight %s variants', theme => {
    const plans = Array.from({ length: GROUND_TILE_VARIANTS }, (_, variant) => groundDetailPatches(theme, variant))
    expect(new Set(plans.map(plan => JSON.stringify(plan))).size).toBe(GROUND_TILE_VARIANTS)
    for (let variant = 0; variant < GROUND_TILE_VARIANTS; variant++) {
      const patches = groundDetailPatches(theme, variant)
      expect(patches).toEqual(plans[variant])
      expect(patches).toHaveLength(6)
      for (const patch of patches) {
        expect(patch.radius).toBeGreaterThanOrEqual(24)
        expect(patch.x - patch.radius).toBeGreaterThanOrEqual(3 - 1e-9)
        expect(patch.y - patch.radius).toBeGreaterThanOrEqual(3 - 1e-9)
        expect(patch.x + patch.radius).toBeLessThanOrEqual(GROUND_TILE_SIZE - 3 + 1e-9)
        expect(patch.y + patch.radius).toBeLessThanOrEqual(GROUND_TILE_SIZE - 3 + 1e-9)
      }
    }
  })

  it('uses the supplied generated image at every placement, with balanced canvas state', () => {
    const context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() }
    const image = { width: 256, height: 256 } as HTMLCanvasElement
    paintOrganicGround(context as unknown as CanvasRenderingContext2D, 'desert', 2, image, 64)
    const plan = groundDetailPatches('desert', 2)
    expect(context.drawImage).toHaveBeenCalledTimes(plan.length)
    expect(context.save).toHaveBeenCalledTimes(plan.length)
    expect(context.restore).toHaveBeenCalledTimes(plan.length)
    for (const [index, patch] of plan.entries()) {
      const half = patch.radius / Math.SQRT2
      expect(context.translate).toHaveBeenNthCalledWith(index + 1, 64 + patch.x, 64 + patch.y)
      expect(context.rotate).toHaveBeenNthCalledWith(index + 1, patch.angle)
      expect(context.drawImage).toHaveBeenNthCalledWith(index + 1, image, -half, -half, half * 2, half * 2)
    }
  })

  it('varies placement by environment while sharing day and night geometry', () => {
    expect(new Set(themes.map(theme => JSON.stringify(groundDetailPatches(theme, 0)))).size).toBe(3)
  })
})
