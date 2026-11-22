import { describe, expect, it } from 'vitest'
import { lampIntersectsViewport } from '@/phaser/rendering/nightRenderer'

const lamp = { center: { x: 100, y: 100 }, radius: 20 }

describe('night lamp visibility', () => {
  const view = { left: 0, top: 0, right: 100, bottom: 100 }
  it('renders bulbs whose glow circle intersects the viewport boundary', () => {
    expect(lampIntersectsViewport(lamp, view)).toBe(true)
    expect(lampIntersectsViewport({ center: { x: -20, y: 50 }, radius: 20 }, view)).toBe(true)
    expect(lampIntersectsViewport({ center: { x: 50, y: 120 }, radius: 20 }, view)).toBe(true)
  })

  it('culls fully outside lights without culling when viewport is unavailable', () => {
    expect(lampIntersectsViewport({ center: { x: -21, y: 50 }, radius: 20 }, view)).toBe(false)
    expect(lampIntersectsViewport({ center: { x: 50, y: 121 }, radius: 20 }, view)).toBe(false)
    expect(lampIntersectsViewport(lamp)).toBe(true)
  })
})
