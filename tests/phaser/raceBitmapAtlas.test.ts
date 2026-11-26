import { describe, expect, it } from 'vitest'
import { planRaceAtlas, RACE_ATLAS_BUDGET } from '@/phaser/rendering/raceBitmapAtlas'

describe('race atlas memory budget', () => {
  it('keeps small tracks at native resolution', () => {
    const plan = planRaceAtlas(80)
    expect(plan.resolution).toBe(256)
    expect(plan.pages.reduce((count, page) => count + page.count, 0)).toBe(80)
  })

  it('bakes every sparse tile for an NJ-scale race within the actual page budget', () => {
    const count = 1_100
    const plan = planRaceAtlas(count)
    expect(plan.resolution).toBeLessThan(256)
    expect(plan.resolution).toBeGreaterThan(128)
    expect(plan.pages.reduce((total, page) => total + page.count, 0)).toBe(count)
    expect(plan.bytes).toBe(plan.pages.reduce((bytes, page) => bytes + page.width * page.height * 4, 0))
    expect(plan.bytes).toBeLessThanOrEqual(RACE_ATLAS_BUDGET)
    expect(plan.pages.every(page => page.width <= 1024 && page.height <= 1024)).toBe(true)
  })

  it('does not allocate any pages for empty layers', () => {
    expect(planRaceAtlas(0)).toMatchObject({ pages: [], bytes: 0 })
  })
})
