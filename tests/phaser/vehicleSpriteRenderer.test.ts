// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { CAR_IDS, type CarId } from '@/domain/model'
import { VehicleSpriteRenderer } from '@/phaser/rendering/vehicleSpriteRenderer'
import { vehicleBitmapBounds } from '@/presentation/vehicleBitmapArt'
import { VEHICLE_VISUAL_SCALE } from '@/presentation/vehicleArtwork'

function fakeScene() {
  const keys = new Set<string>()
  class FakeSprite {
    texture: { key: string }
    depth = 0
    visible = true
    constructor(key: string) { this.texture = { key } }
    setTexture = vi.fn((next: string) => { this.texture.key = next; return this })
    setDepth = vi.fn((depth: number) => { this.depth = depth; return this })
    setOrigin = vi.fn(() => this)
    setPosition = vi.fn(() => this)
    setRotation = vi.fn(() => this)
    setDisplaySize = vi.fn(() => this)
    setVisible = vi.fn((visible: boolean) => { this.visible = visible; return this })
    destroy = vi.fn()
  }
  const images: FakeSprite[] = []
  const scene = {
    textures: {
      exists: (key: string) => keys.has(key),
      addImage: vi.fn((key: string, _image: HTMLImageElement) => { keys.add(key); return {} }),
      addCanvas: vi.fn((key: string, _canvas: HTMLCanvasElement) => { keys.add(key); return {} }),
    },
    add: {
      image: vi.fn((_x: number, _y: number, key: string) => {
        const sprite = new FakeSprite(key)
        images.push(sprite)
        return sprite
      }),
    },
  }
  return { scene, images }
}

describe('generated vehicle sprite renderer', () => {
  it('registers four textures once, preserves world scale and orders cars below their overlay and above their shadow', () => {
    const { scene, images } = fakeScene()
    const image = { naturalWidth: 768, naturalHeight: 384 } as HTMLImageElement
    const renderer = new VehicleSpriteRenderer(scene as unknown as Phaser.Scene, () => image)
    expect(scene.textures.addImage).toHaveBeenCalledTimes(4)
    for (const car of CAR_IDS) {
      expect(scene.textures.addImage).toHaveBeenCalledWith(`trackforge-vehicle-${car}`, image)
    }
    expect(scene.textures.addCanvas).not.toHaveBeenCalled()
    renderer.beginFrame()
    const scale = VEHICLE_VISUAL_SCALE
    expect(renderer.draw('blue', 12, 34, 0.5, scale, scale, 5)).toBe(true)
    renderer.draw('red', 12, 34, 0.5, scale, scale, 5)
    renderer.draw('yellow', 50, 60, 1, scale * 1.1, scale, 15)
    renderer.endFrame()
    const [blue, red, yellow] = images
    expect(blue?.setPosition).toHaveBeenCalledWith(12, 34)
    expect(blue?.setRotation).toHaveBeenCalledWith(0.5)
    const bounds = vehicleBitmapBounds('blue')
    expect(blue?.setOrigin).toHaveBeenCalledWith(-bounds.x / bounds.width, 0.5)
    expect(blue?.setDisplaySize).toHaveBeenCalledWith(bounds.width * scale, bounds.height * scale)
    expect(blue?.depth).toBeGreaterThan(4)
    expect(red?.depth).toBeGreaterThan(blue?.depth ?? 0)
    expect(red?.depth).toBeLessThan(5)
    expect(yellow?.depth).toBeGreaterThan(14.8)
    expect(yellow?.depth).toBeLessThan(15)
    const truckBounds = vehicleBitmapBounds('yellow')
    expect(yellow?.setDisplaySize).toHaveBeenCalledWith(truckBounds.width * (scale * 1.1), truckBounds.height * scale)

    renderer.beginFrame()
    renderer.draw('green', 1, 2, 0, scale, scale, 5)
    renderer.endFrame()
    expect(scene.add.image).toHaveBeenCalledTimes(3)
    expect(blue?.texture.key).toBe('trackforge-vehicle-green')
    expect(red?.visible).toBe(false)
    expect(yellow?.visible).toBe(false)
    renderer.destroy()
    for (const sprite of images) expect(sprite.destroy).toHaveBeenCalledOnce()
    new VehicleSpriteRenderer(scene as unknown as Phaser.Scene, () => image)
    expect(scene.textures.addImage).toHaveBeenCalledTimes(4)
    expect(scene.textures.addCanvas).not.toHaveBeenCalled()
  })

  it('keeps dimensions bounded and preserves the forward-facing world length of all four cars', () => {
    const lengths: Record<CarId, number> = { blue: 42, red: 45, green: 36, yellow: 49 }
    for (const car of CAR_IDS) {
      const bounds = vehicleBitmapBounds(car)
      expect(bounds.width).toBe(lengths[car])
      expect(bounds.height).toBeGreaterThan(15)
      expect(bounds.height).toBeLessThan(30)
      expect(bounds.x).toBeLessThan(0)
      expect(bounds.x + bounds.width).toBeGreaterThan(0)
    }
  })

  it('permits isolated pre-boot vector tests without allocating missing textures', () => {
    const { scene } = fakeScene()
    const renderer = new VehicleSpriteRenderer(scene as unknown as Phaser.Scene, () => undefined)
    expect(renderer.draw('blue', 0, 0, 0, 1, 1, 5)).toBe(false)
    expect(scene.add.image).not.toHaveBeenCalled()
    expect(scene.textures.addImage).not.toHaveBeenCalled()
    expect(scene.textures.addCanvas).not.toHaveBeenCalled()
  })
})
