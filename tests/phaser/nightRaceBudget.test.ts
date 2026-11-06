import { describe, expect, it } from 'vitest'
import { buildLampLights, type LampPost } from '@/phaser/rendering/lampPostRenderer'

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
