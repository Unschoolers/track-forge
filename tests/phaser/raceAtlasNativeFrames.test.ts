import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { registerRaceAtlasFrames } from '@/phaser/rendering/raceBitmapAtlas'

describe('native race atlas frame registration', () => {
  it('uses Phaser sprite-sheet spacing and excludes unused final-row slots', () => {
    const has = vi.fn(() => true)
    const texture = { has } as unknown as Phaser.Textures.Texture
    const addSpriteSheet = vi.fn(() => texture)
    registerRaceAtlasFrames({ addSpriteSheet }, texture, 256, 3)
    expect(addSpriteSheet).toHaveBeenCalledWith('', texture, {
      frameWidth: 256, frameHeight: 256, margin: 1, spacing: 2, endFrame: 2,
    })
    expect(has.mock.calls).toEqual([[0], [1], [2]])
  })

  it('fails explicitly if Phaser did not create the expected frame', () => {
    const texture = { has: (id: number) => id === 0 } as unknown as Phaser.Textures.Texture
    expect(() => registerRaceAtlasFrames({ addSpriteSheet: () => texture }, texture, 256, 2))
      .toThrow('Missing race atlas frame 1')
  })
})
