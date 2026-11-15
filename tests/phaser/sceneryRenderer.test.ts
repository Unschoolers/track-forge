import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import type { SceneryProp } from '@/domain/track/trackEnvironment'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'

describe('scenery renderer', () => {
  it('caches the window and refreshes for theme, lighting, props and a drag preview', () => {
    const graphics = { clear: vi.fn(), fillStyle: vi.fn(), fillEllipse: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillPath: vi.fn() }
    const renderer = new SceneryRenderer(graphics as unknown as Phaser.GameObjects.Graphics)
    const props: readonly SceneryProp[] = [{ kind: 'city-building', x: 0, y: 0 }, { kind: 'desert-cactus', x: 0, y: 0 }]
    const view = { centerX: 0, centerY: 0, width: 100, height: 100, zoom: 1, rotation: 0 }
    renderer.render(view, 'cityscape', props, false)
    expect(graphics.clear).toHaveBeenCalledTimes(1)
    expect(graphics.fillPath.mock.calls.length + graphics.fillEllipse.mock.calls.length).toBeGreaterThan(0)
    renderer.render({ ...view, centerX: 1 }, 'cityscape', props, false)
    expect(graphics.clear).toHaveBeenCalledTimes(1)
    renderer.render(view, 'cityscape', props, true)
    renderer.render(view, 'desert', props, true)
    renderer.render(view, 'desert', [...props], true)
    renderer.render(view, 'desert', props, true, { index: 1, position: { x: 50, y: 50 } })
    expect(graphics.clear).toHaveBeenCalledTimes(5)
  })
})
