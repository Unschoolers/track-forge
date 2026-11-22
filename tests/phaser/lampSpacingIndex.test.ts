import { describe, expect, it } from 'vitest'
import { LampSpacingIndex } from '@/phaser/rendering/lampPostRenderer'

describe('lamp spacing spatial index', () => {
  it('rejects posts within 54 world units, including negative cell and diagonal boundaries', () => {
    const index = new LampSpacingIndex()
    expect(index.tryAdd({ x: -1, y: -1 })).toBe(true)
    expect(index.tryAdd({ x: 52, y: -1 })).toBe(false)
    expect(index.tryAdd({ x: -54, y: -1 })).toBe(false)
    expect(index.tryAdd({ x: 53, y: 1 })).toBe(true)
    expect(index.tryAdd({ x: 53, y: 1 })).toBe(false)
  })

  it('matches the original nearest-before-insertion decision on deterministic samples', () => {
    const positions = Array.from({ length: 1200 }, (_, i) => ({
      x: (i * 103) % 1511 - 755, y: (i * 397) % 1709 - 854,
    }))
    const index = new LampSpacingIndex()
    const prior: { x: number; y: number }[] = []
    for (const position of positions) {
      const allowed = !prior.some(other => Math.hypot(other.x - position.x, other.y - position.y) < 54)
      expect(index.tryAdd(position)).toBe(allowed)
      if (allowed) prior.push(position)
    }
  })
})
