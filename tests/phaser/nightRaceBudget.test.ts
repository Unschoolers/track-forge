import { describe, expect, it, vi } from 'vitest'
import { buildLampLights, type LampPost } from '@/phaser/rendering/lampPostRenderer'
import { createNightLampGraphics, renderNightLights } from '@/phaser/rendering/nightRenderer'
import { terrainChunkVisible } from '@/phaser/rendering/raceTerrainChunks'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import type Phaser from 'phaser'

function post(bridge: boolean): LampPost {
  return {
    position: { x: 30, y: 40 }, roadAnchor: { x: 20, y: 40 },
    side: 1, height: 18, baseHeight: 0, terrainHeight: 0,
    shadowEnd: { x: 0, y: 0 }, bridge, pathDistance: 100, spacing: 150,
  }
}

describe('night race lamp caching', () => {
  it('reuses a stable source array without rebuilding light transforms per frame', () => {
    const posts: readonly LampPost[] = [post(false), post(true)]
    const first = buildLampLights(posts)
    const second = buildLampLights(posts)
    expect(second).toBe(first)
    expect(first).toHaveLength(2)
    expect(first[0]).toMatchObject({ radius: 46, bridge: false })
    expect(first[1]).toMatchObject({ radius: 54, bridge: true })
  })
  it('does not incorrectly reuse cached geometry for a different track', () => {
    const first = buildLampLights([post(false)])
    const next = buildLampLights([post(true)])
    expect(next).not.toBe(first)
    expect(next[0]?.radius).toBe(54)
  })
})

it('does not submit night lamp glows that cannot intersect the camera view', () => {
  const lamps: readonly LampPost[] = [
    post(false),
    { ...post(false), position: { x: 9000, y: 9000 }, roadAnchor: { x: 9000, y: 9000 } },
    { ...post(true), position: { x: 97, y: 40 }, roadAnchor: { x: 97, y: 40 } },
  ]
  let circles = 0
  const graphics = {
    fillStyle: () => undefined,
    fillCircle: () => { circles++ },
  } as unknown as Phaser.GameObjects.Graphics
  renderNightLights(graphics, [], lamps, { left: -70, top: -60, right: 100, bottom: 120 })
  expect(circles).toBe(10)
  circles = 0
  renderNightLights(graphics, [], lamps, { left: 150, top: -60, right: 200, bottom: 120 })
  expect(circles).toBe(5)
  circles = 0
  renderNightLights(graphics, [], lamps, { left: 300, top: -60, right: 400, bottom: 120 })
  expect(circles).toBe(0)
  circles = 0
  renderNightLights(graphics, [], lamps) // Optional viewport retains previous rendering API.
  expect(circles).toBe(15)
})


it('builds static glow commands once in small culled batches with unchanged additive paint', () => {
  const lamps = Array.from({ length: 17 }, (_, i): LampPost => ({
    ...post(i % 2 === 0),
    position: { x: i * 150 + 30, y: 40 },
    roadAnchor: { x: i * 150, y: 40 },
  }))
  function graphics() {
    return {
      setDepth: vi.fn().mockReturnThis(),
      setBlendMode: vi.fn().mockReturnThis(),
      fillStyle: vi.fn(),
      fillCircle: vi.fn(),
    }
  }
  const old = graphics()
  renderNightLights(old as unknown as Phaser.GameObjects.Graphics, [], lamps)
  const objects: ReturnType<typeof graphics>[] = []
  const scene = {
    add: { graphics: () => {
      const object = graphics()
      objects.push(object)
      return object
    } },
  } as unknown as Phaser.Scene
  const batches = createNightLampGraphics(scene, lamps, 1)
  expect(batches).toHaveLength(3)
  expect(objects.map(object => object.fillCircle.mock.calls.length)).toEqual([40, 40, 5])
  expect(objects.flatMap(object => object.fillCircle.mock.calls)).toEqual(old.fillCircle.mock.calls)
  expect(objects.flatMap(object => object.fillStyle.mock.calls)).toEqual(old.fillStyle.mock.calls)
  for (const object of objects) {
    expect(object.setDepth).toHaveBeenCalledWith(WORLD_RENDER_DEPTH.nightLight - 0.01)
    expect(object.setBlendMode).toHaveBeenCalledWith(1)
  }
  // Moving across a halo edge, including a bridge's larger glow, cannot
  // hide the incoming lamp. Camera movement only changes batch visibility.
  const view = { left: -54, top: 40, right: -50, bottom: 42 }
  expect(batches.map(batch => terrainChunkVisible(batch.bounds, view))).toEqual([true, false, false])
  const far = { left: 2400, right: 2450, top: 0, bottom: 60 }
  expect(batches.map(batch => terrainChunkVisible(batch.bounds, far))).toEqual([false, false, true])
  const dynamic = graphics()
  for (let frame = 0; frame < 180; frame++) {
    renderNightLights(dynamic as unknown as Phaser.GameObjects.Graphics, [], [])
  }
  expect(dynamic.fillCircle).not.toHaveBeenCalled()
  expect(objects.flatMap(object => object.fillCircle.mock.calls)).toHaveLength(lamps.length * 5)
})
