import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'

describe('scenery rendering cache lifecycle', () => {
  it('retries the same viewport after a graphics failure instead of caching a partial frame', () => {
    const graphics = {
      clear: vi.fn()
        .mockImplementationOnce(() => { throw new Error('Graphics temporarily unavailable') })
        .mockImplementation(() => undefined),
      fillStyle: vi.fn(), fillEllipse: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), closePath: vi.fn(), fillPath: vi.fn(),
    }
    const renderer = new SceneryRenderer(graphics as unknown as Phaser.GameObjects.Graphics)
    const viewport = { centerX: 0, centerY: 0, width: 100, height: 100, zoom: 1, rotation: 0 }
    const props = [{ kind: 'city-building' as const, x: 0, y: 0 }]
    expect(() => renderer.render(viewport, 'cityscape', props, false)).toThrow('Graphics temporarily unavailable')
    expect(() => renderer.render(viewport, 'cityscape', props, false)).not.toThrow()
    expect(graphics.clear).toHaveBeenCalledTimes(2)
    renderer.render(viewport, 'cityscape', props, false)
    expect(graphics.clear).toHaveBeenCalledTimes(2)
  })
})
