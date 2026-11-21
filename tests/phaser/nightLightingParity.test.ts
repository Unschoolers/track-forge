// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { NightBeamRenderer, renderNightLights } from '@/phaser/rendering/nightRenderer'
import { getNightHeadlightBeam, NIGHT_HEADLIGHT } from '@/presentation/nightLighting'
import type { VehicleLightTransform } from '@/phaser/rendering/vehicleRenderer'

const vehicle = (x: number): VehicleLightTransform => ({
  car: 'blue',
  angle: 0,
  braking: false,
  headlights: [{ x, y: -5 }, { x, y: 5 }],
  taillights: [{ x: x - 30, y: -5 }, { x: x - 30, y: 5 }],
})

function graphicsImage() {
  return {
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setBlendMode: vi.fn().mockReturnThis(),
    setAlpha: vi.fn().mockReturnThis(),
    setScale: vi.fn().mockReturnThis(),
    setPosition: vi.fn().mockReturnThis(),
    setRotation: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  }
}

describe('night preview / gameplay lighting parity', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rasterizes one headlight cone and reuses it instead of creating gradients per frame', () => {
    const gradient = { addColorStop: vi.fn() }
    const context = {
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      closePath: vi.fn(), fill: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const first = getNightHeadlightBeam()
    expect(first.width).toBe(NIGHT_HEADLIGHT.width)
    expect(getNightHeadlightBeam()).toBe(first)
    expect(context.createLinearGradient).toHaveBeenCalledTimes(1)
    expect(context.fill).toHaveBeenCalledTimes(1)
  })

  it('positions one pooled beam per car and hides a retired car without leaving a trail', () => {
    const images = [graphicsImage(), graphicsImage()]
    let created = 0
    let registered = false
    const scene = {
      textures: {
        exists: vi.fn(() => registered),
        addCanvas: vi.fn(() => { registered = true }),
      },
      add: { image: vi.fn(() => {
        const image = images[created]
        created += 1
        if (!image) throw new Error('Unexpected additional headlight image')
        return image
      }) },
    } as unknown as Phaser.Scene
    const renderer = new NightBeamRenderer(scene, 1)
    renderer.render([vehicle(20), { ...vehicle(40), angle: Math.PI / 2 }])
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(1)
    expect(scene.add.image).toHaveBeenCalledTimes(2)
    const alpha = images[0]?.setAlpha.mock.calls[0]?.[0] as number | undefined
    const scale = images[0]?.setScale.mock.calls[0]?.[0] as number | undefined
    expect(alpha).toBeGreaterThan(0.5)
    expect(alpha).toBeLessThan(0.75) // prevent additive hotspots without going dark again
    expect(scale).toBeGreaterThan(0.8)
    expect(scale).toBeLessThan(0.95)
    if (scale === undefined) throw new Error('Expected headlight beam scale')
    expect(images[0]?.setPosition).toHaveBeenCalledWith(20 - NIGHT_HEADLIGHT.sourceX * scale, 0)
    expect(images[1]?.setPosition).toHaveBeenCalledWith(40, -NIGHT_HEADLIGHT.sourceX * scale)

    renderer.render([vehicle(22)])
    expect(scene.add.image).toHaveBeenCalledTimes(2)
    expect(images[0]?.setPosition).toHaveBeenLastCalledWith(22 - NIGHT_HEADLIGHT.sourceX * scale, 0)
    expect(images[1]?.setVisible).toHaveBeenLastCalledWith(false)
    // Tuning is applied when pooled sprites are created, not every frame.
    expect(images[0]?.setAlpha).toHaveBeenCalledTimes(1)
    expect(images[0]?.setScale).toHaveBeenCalledTimes(1)
    renderer.destroy()
    expect(images[0]?.destroy).toHaveBeenCalledTimes(1)
    expect(images[1]?.destroy).toHaveBeenCalledTimes(1)
  })

  it('renders car fixtures but no stacked geometric beams in the race effects pass', () => {
    const graphics = {
      fillStyle: vi.fn(),
      fillCircle: vi.fn(),
      fillTriangle: vi.fn(),
    } as unknown as Phaser.GameObjects.Graphics
    renderNightLights(graphics, [vehicle(20)], [])
    expect(graphics.fillCircle).toHaveBeenCalledTimes(4)
    expect(graphics.fillTriangle).not.toHaveBeenCalled()
  })
})
