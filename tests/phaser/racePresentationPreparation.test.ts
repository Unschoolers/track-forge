// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { buildBridgePresentation } from '@/phaser/rendering/bridgeRenderer'
import { ensureGroundTexture } from '@/phaser/rendering/environmentRenderer'
import { buildLampPosts } from '@/phaser/rendering/lampPostRenderer'
import { RacePresentationPreparation } from '@/phaser/rendering/racePresentationPreparation'

vi.mock('@/presentation/environments/environmentTileImage', () => ({
  getEnvironmentTileImage: () => document.createElement('canvas'),
}))

function scheduler() {
  const callbacks: (() => void)[] = []
  let time = 0
  const preparation = new RacePresentationPreparation(
    (callback) => {
      callbacks.push(callback)
      return () => undefined
    },
    () => {
      time += 3
      return time
    },
  )
  function frame(): void {
    const callback = callbacks.shift()
    if (!callback) throw new Error('Expected a pending preparation slice')
    callback()
  }
  return { preparation, callbacks, frame }
}

describe('race presentation preparation', () => {
  it('reuses the same bridge and lamp presentation from the flyover geometry', () => {
    const { preparation, callbacks, frame } = scheduler()
    const track = OFFICIAL_CIRCUITS[3].track
    const geometryService = new TrackGeometryService()
    const selectionGeometry = geometryService.get(track)
    const heightAt = vi.spyOn(selectionGeometry.path.terrainSurface, 'heightAt')

    preparation.prepare(selectionGeometry, 'grass', true)
    expect(heightAt).not.toHaveBeenCalled()
    while (callbacks.length > 0) frame()
    expect(heightAt).toHaveBeenCalled()
    heightAt.mockClear()

    const raceGeometry = geometryService.get(track)
    const coldGeometry = buildTrackGeometry(track)
    const warmedBridge = buildBridgePresentation(raceGeometry)
    const warmedLamps = buildLampPosts(raceGeometry)
    expect(warmedBridge.length).toBeGreaterThan(0)
    expect(warmedLamps.length).toBeGreaterThan(0)
    expect(heightAt).not.toHaveBeenCalled()
    expect(warmedBridge).toEqual(buildBridgePresentation(coldGeometry))
    expect(warmedLamps).toEqual(buildLampPosts(coldGeometry))
    heightAt.mockRestore()
  })

  it('slices texture registration and ignores callbacks from an old selection or foreground state', () => {
    const { preparation, frame } = scheduler()
    const geometry = buildTrackGeometry(OFFICIAL_CIRCUITS[0].track)
    const keys = new Set<string>()
    const textures = {
      exists: (key: string) => keys.has(key),
      addCanvas: vi.fn((key: string) => {
        keys.add(key)
        return null
      }),
    }
    const ground = { textures, width: 800, height: 450 }

    const cancelFirst = preparation.prepare(geometry, 'cityscape', true, ground)
    expect(textures.addCanvas).not.toHaveBeenCalled()
    frame()
    expect(textures.addCanvas).toHaveBeenCalledOnce()
    const firstKey = textures.addCanvas.mock.calls[0]?.[0]
    if (!firstKey) throw new Error('Expected a prepared ground tile')
    expect(firstKey).toMatch(/^trackforge-cityscape-\d-night$/)

    preparation.setForeground(false)
    frame()
    expect(textures.addCanvas).toHaveBeenCalledOnce()
    preparation.setForeground(true)
    frame()
    expect(textures.addCanvas).toHaveBeenCalledTimes(2)

    preparation.prepare(geometry, 'desert', false, ground)
    cancelFirst()
    frame()
    expect(textures.addCanvas).toHaveBeenCalledTimes(2)
    frame()
    expect(textures.addCanvas.mock.calls[2]?.[0]).toMatch(/^trackforge-desert-\d-day$/)
    expect(ensureGroundTexture(textures, 'cityscape', Number(firstKey.split('-')[2]), true)).toBe(firstKey)
    expect(textures.addCanvas).toHaveBeenCalledTimes(3)
    preparation.cancel()
    frame()
    expect(textures.addCanvas).toHaveBeenCalledTimes(3)
  })
})
