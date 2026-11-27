// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { createRaceBitmapAtlas, prepareRaceAtlas } from '@/phaser/rendering/raceBitmapAtlas'

const { bake } = vi.hoisted(() => ({ bake: vi.fn(() => document.createElement('canvas')) }))
vi.mock('@/presentation/environments/meadowBitmapTiles', () => ({
  createRaceBitmapLayers: () => ({
    road: { all: () => [{ x: 0, y: 0, variant: 0 }, { x: 1, y: 0, variant: 0 }], bake },
    terrain: { all: () => [], bake },
  }),
}))

function fixture() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
  const texture = { has: () => true } as unknown as Phaser.Textures.Texture
  const textures = { addCanvas: vi.fn(() => texture), addSpriteSheet: vi.fn(() => texture), remove: vi.fn() }
  const scene = { textures, events: { once: vi.fn(), off: vi.fn() } } as unknown as Phaser.Scene
  return { scene, textures, geometry: {} as TrackGeometry }
}

afterEach(() => { vi.restoreAllMocks(); bake.mockClear() })

describe('race atlas preparation', () => {
  it('resumes a partial startup or flyover bake and reuses it across scene shutdown and restart', () => {
    const { scene, textures, geometry } = fixture()
    const work = prepareRaceAtlas(textures as never, geometry, false, 'grass')
    expect(work.next()).toEqual({ value: 1 / 3, done: false })
    work.return()
    expect(bake).toHaveBeenCalledTimes(1)
    const renderer = createRaceBitmapAtlas(scene, geometry, false, 'grass')
    expect(renderer).toBeDefined()
    expect(bake).toHaveBeenCalledTimes(2)
    expect(textures.addCanvas).toHaveBeenCalledTimes(1)
    renderer?.destroy()
    expect(textures.remove).not.toHaveBeenCalled()
    const restarted = createRaceBitmapAtlas(scene, geometry, false, 'grass')
    expect(bake).toHaveBeenCalledTimes(2)
    expect(textures.addCanvas).toHaveBeenCalledTimes(1)
    restarted?.destroy()
    // A different lighting variant replaces the idle cached atlas.
    expect(Array.from(prepareRaceAtlas(textures as never, geometry, true, 'grass'))).toEqual([1 / 3, 2 / 3, 1])
    expect(textures.remove).toHaveBeenCalledTimes(1)
    expect(bake).toHaveBeenCalledTimes(4)
  })

  it('releases a failed upload and retries without keeping a corrupt atlas', () => {
    const { scene, textures, geometry } = fixture()
    textures.addSpriteSheet.mockImplementationOnce(() => { throw new Error('upload failed') })
    expect(() => Array.from(prepareRaceAtlas(textures as never, geometry, false, 'grass'))).toThrow('upload failed')
    expect(textures.remove).toHaveBeenCalledTimes(1)
    expect(createRaceBitmapAtlas(scene, geometry, false, 'grass')).toBeDefined()
    expect(bake).toHaveBeenCalledTimes(4)
  })
})
