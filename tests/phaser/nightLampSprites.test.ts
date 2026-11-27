// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import type { LampPost } from '@/phaser/rendering/lampPostRenderer'
import { createNightLampSprites } from '@/phaser/rendering/nightRenderer'
import { terrainChunkVisible } from '@/phaser/rendering/raceTerrainChunks'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'

const post = (bridge: boolean, x: number): LampPost => ({
  position: { x: x + 30, y: 40 }, roadAnchor: { x, y: 40 },
  side: 1, height: 18, baseHeight: 0, terrainHeight: 0,
  shadowEnd: { x, y: 40 }, bridge, pathDistance: x, spacing: 150,
})

afterEach(() => vi.restoreAllMocks())

it('bakes shared additive artwork once, submits two sprites per lamp and culls both together', () => {
  const context = { scale: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    globalCompositeOperation: '', globalAlpha: 1, fillStyle: '' }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const texture = { add: vi.fn(() => true) }
  let registered = false
  const textures = { exists: () => registered, addCanvas: vi.fn(() => {
    registered = true
    return texture
  }), remove: vi.fn() }
  function sprite() {
    const image = {
      visible: true,
      setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(), setBlendMode: vi.fn().mockReturnThis(),
      setVisible: vi.fn((visible: boolean) => { image.visible = visible; return image }),
    }
    return image
  }
  const images: ReturnType<typeof sprite>[] = []
  const addImage = vi.fn((_x: number, _y: number, _key: string, _frame: string) => {
    const image = sprite()
    images.push(image)
    return image
  })
  const scene = { textures, add: { image: addImage } } as unknown as Phaser.Scene
  expect(createNightLampSprites(scene, [], 1)).toEqual([])
  expect(textures.addCanvas).not.toHaveBeenCalled()
  const batches = createNightLampSprites(scene, [post(false, 0), post(true, 150)], 1)
  expect(textures.addCanvas).toHaveBeenCalledTimes(1)
  expect(context.globalCompositeOperation).toBe('lighter')
  expect(context.fill).toHaveBeenCalledTimes(10)
  expect(texture.add).toHaveBeenCalledTimes(4)
  expect(addImage.mock.calls.map(call => call[3])).toEqual(['road', 'fixture', 'bridge-road', 'bridge-fixture'])
  expect(images.map(image => image.setDisplaySize.mock.calls[0])).toEqual([[96, 96], [16, 16], [112, 112], [16, 16]])
  for (const image of images) {
    expect(image.setDepth).toHaveBeenCalledWith(WORLD_RENDER_DEPTH.nightLight - 0.01)
    expect(image.setBlendMode).toHaveBeenCalledWith(1)
  }
  const view = { left: 204, right: 205, top: 40, bottom: 41 }
  for (const batch of batches) batch.graphics.setVisible(terrainChunkVisible(batch.bounds, view))
  expect(images.map(image => image.visible)).toEqual([false, false, true, true])
  expect(batches.map(batch => batch.graphics.visible)).toEqual([false, true])
  createNightLampSprites(scene, [post(false, 0)], 1)
  expect(textures.addCanvas).toHaveBeenCalledTimes(1)
  expect(context.fill).toHaveBeenCalledTimes(10)
})
