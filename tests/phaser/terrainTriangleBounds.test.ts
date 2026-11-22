import { describe, expect, it } from 'vitest'
import { triangleIntersectsBounds } from '@/phaser/rendering/terrainRenderer'
import type { TerrainTriangle } from '@/phaser/rendering/terrainTopology'

const triangle: TerrainTriangle = [
  { x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 },
]

describe('terrain preview triangle culling', () => {
  it('keeps triangles overlapping or touching the viewport, even when points lie outside', () => {
    expect(triangleIntersectsBounds(triangle, { left: -2, right: 2, top: 2, bottom: 9 })).toBe(true)
    expect(triangleIntersectsBounds(triangle, { left: 10, right: 20, top: 0, bottom: 10 })).toBe(true)
  })

  it('culls only fully separated axis-aligned bounds', () => {
    expect(triangleIntersectsBounds(triangle, { left: 11, right: 20, top: 0, bottom: 20 })).toBe(false)
    expect(triangleIntersectsBounds(triangle, { left: -20, right: 20, top: 21, bottom: 40 })).toBe(false)
  })
})
