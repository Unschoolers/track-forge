// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { asTrackId, type Track } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
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

// Preparation tests need fixed geometry, not the evolving player-facing catalog.
const baseTrack = createStarterTrack(asTrackId('presentation-fixture'), 0)
const flatTrack: Track = {
  ...baseTrack,
  points: baseTrack.points.map(point => ({ ...point, x: point.x * 4, y: point.y * 4 })),
}
const bridgeTrack: Track = {
  ...flatTrack,
  id: asTrackId('presentation-bridge-fixture'),
  points: flatTrack.points.map((point, index) => ({ ...point, structure: index >= 4 && index < 10 ? 'overpass' : 'surface' })),
}

describe('race presentation preparation', () => {
  it.each([
    { track: flatTrack, hasBridge: false },
    { track: bridgeTrack, hasBridge: true },
  ])('reuses prepared geometry, bridges and lamps (bridge=$hasBridge)', ({ track, hasBridge }) => {
    const { preparation, callbacks, frame } = scheduler()
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
    if (hasBridge) expect(warmedBridge.length).toBeGreaterThan(0)
    else expect(warmedBridge).toHaveLength(0)
    expect(raceGeometry).toBe(selectionGeometry)
    expect(warmedLamps.length).toBeGreaterThan(0)
    expect(heightAt).not.toHaveBeenCalled()
    expect(warmedBridge).toEqual(buildBridgePresentation(coldGeometry))
    expect(warmedLamps).toEqual(buildLampPosts(coldGeometry))
    heightAt.mockRestore()
  })

  it('slices texture registration and ignores callbacks from an old selection or foreground state', () => {
    const { preparation, frame } = scheduler()
    const geometry = buildTrackGeometry(flatTrack)
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
