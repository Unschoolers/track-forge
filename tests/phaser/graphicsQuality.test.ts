import { describe, expect, it } from 'vitest'
import { backingSize, graphicsPixelRatio } from '@/phaser/rendering/graphicsQuality'

describe('race graphics quality', () => {
  it('renders the same viewport at low, medium and native backing densities', () => {
    expect(backingSize(360, 780, graphicsPixelRatio('low', 3))).toEqual({ width: 360, height: 780 })
    expect(backingSize(360, 780, graphicsPixelRatio('medium', 3))).toEqual({ width: 720, height: 1560 })
    expect(backingSize(360, 780, graphicsPixelRatio('high', 3))).toEqual({ width: 1080, height: 2340 })
  })
  it('defaults to medium without supersampling a lower-density display', () => {
    expect(graphicsPixelRatio(undefined, 3)).toBe(2)
    expect(graphicsPixelRatio('medium', 1.5)).toBe(1.5)
    expect(graphicsPixelRatio('high', 1)).toBe(1)
    expect(graphicsPixelRatio('high', NaN)).toBe(1)
  })
})
