import { describe, expect, it } from 'vitest'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { groupRaceAtlasFrames, planRaceAtlas, MAX_RACE_TILE_RESOLUTION, RACE_ATLAS_BUDGET, RACE_ATLAS_DEPTHS } from '@/phaser/rendering/raceBitmapAtlas'

describe('race atlas memory budget', () => {
  it('keeps baked approach shadows, deck and walls on the correct sides of vehicles', () => {
    const [road, terrain, approach, deck, walls] = RACE_ATLAS_DEPTHS
    expect(terrain).toBeLessThan(road)
    expect(road).toBeLessThan(approach)
    expect(approach).toBeLessThan(WORLD_RENDER_DEPTH.vehicleShadow)
    expect(deck).toBeGreaterThan(WORLD_RENDER_DEPTH.lowerVehicle)
    expect(walls).toBeGreaterThan(deck)
    expect(walls).toBeLessThan(WORLD_RENDER_DEPTH.upperVehicle)
  })

  it('bakes small tracks above world resolution without exceeding the page or memory budget', () => {
    const plan = planRaceAtlas(80)
    expect(plan.resolution).toBe(MAX_RACE_TILE_RESOLUTION)
    expect(plan.resolution).toBeGreaterThan(256)
    expect(plan.pages.reduce((count, page) => count + page.count, 0)).toBe(80)
    expect(plan.pages.every(page => page.width <= 1024 && page.height <= 1024)).toBe(true)
    expect(plan.bytes).toBeLessThanOrEqual(RACE_ATLAS_BUDGET)
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


it('groups visible tiles by texture page without losing tiles or disturbing order within a page', () => {
  const frames = [
    { texture: 'page-b', frame: '1' },
    { texture: 'page-a', frame: '2' },
    { texture: 'page-b', frame: '3' },
    { texture: 'page-a', frame: '0' },
  ]
  expect(groupRaceAtlasFrames(frames)).toEqual([
    { texture: 'page-a', frame: '2' },
    { texture: 'page-a', frame: '0' },
    { texture: 'page-b', frame: '1' },
    { texture: 'page-b', frame: '3' },
  ])
})
