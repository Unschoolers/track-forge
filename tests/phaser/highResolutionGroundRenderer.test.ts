// @vitest-environment jsdom

import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import { GroundTextureRenderer, ensureGroundTexture } from '@/phaser/rendering/environmentRenderer'
import { getEnvironmentBitmapArt, type EnvironmentBitmapArt } from '@/presentation/environments/meadowBitmapArt'
import { getEnvironmentTileImage } from '@/presentation/environments/environmentTileImage'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'

vi.mock('@/presentation/environments/meadowBitmapArt', () => ({
  getEnvironmentBitmapArt: vi.fn(),
}))
vi.mock('@/presentation/environments/environmentTileImage', () => ({
  getEnvironmentTileImage: vi.fn(),
}))

describe('HD ground rendering', () => {
  it('registers the native base once, retains independent overlays and draws at the original world scale', () => {
    const base = document.createElement('canvas')
    base.width = base.height = 1024
    const overlay = document.createElement('canvas')
    overlay.width = overlay.height = 384
    vi.mocked(getEnvironmentBitmapArt).mockReturnValue({ highResolutionGround: base } as EnvironmentBitmapArt)
    vi.mocked(getEnvironmentTileImage).mockReturnValue(overlay)

    const registered = new Map<string, HTMLCanvasElement>()
    const textures = {
      exists: (key: string) => registered.has(key),
      addCanvas: vi.fn((key: string, canvas: HTMLCanvasElement) => { registered.set(key, canvas) }),
    }
    const makeImage = () => ({
      setOrigin: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn().mockReturnThis(),
      setTexture: vi.fn().mockReturnThis(),
      setPosition: vi.fn().mockReturnThis(),
      setVisible: vi.fn().mockReturnThis(),
    })
    const images: ReturnType<typeof makeImage>[] = []
    const scene = {
      textures,
      add: { image: vi.fn(() => { const image = makeImage(); images.push(image); return image }) },
    }
    const renderer = new GroundTextureRenderer(scene as unknown as Phaser.Scene)
    const view = { centerX: 128, centerY: 128, width: 100, height: 100, zoom: 1, rotation: 0 }
    renderer.render(view, false, 'cityscape')
    ensureGroundTexture(textures as unknown as Parameters<typeof ensureGroundTexture>[0], 'cityscape', 1, false)

    const baseKey = 'trackforge-cityscape-hd-base-day'
    expect(textures.addCanvas.mock.calls.filter(([key]) => key === baseKey)).toEqual([[baseKey, base]])
    expect(getEnvironmentTileImage).toHaveBeenCalledWith('cityscape', 1, false, true)
    expect(images).toHaveLength(2)
    const [baseImage, overlayImage] = images
    expect(baseImage?.setDisplaySize).toHaveBeenCalledWith(GROUND_TILE_SIZE, GROUND_TILE_SIZE)
    expect(baseImage?.setPosition).toHaveBeenCalledWith(0, 0)
    expect(overlayImage?.setPosition).toHaveBeenCalledWith(-64, -64)
    renderer.render({ ...view, width: 10000, height: 10000 }, false, 'cityscape')
    expect(images.every(image => image.setVisible.mock.lastCall?.[0] === false)).toBe(true)
  })
})
