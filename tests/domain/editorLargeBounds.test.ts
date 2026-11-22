import { describe, expect, it } from 'vitest'
import { expandAroundBoundsCenter } from '@/domain/editor/editorGeometry'

describe('large editor world expansion', () => {
  it('finds the true bounding-box center without spreading huge arrays as function arguments', () => {
    // A track with >100K authored controls should not throw a JS argument limit error.
    const points = Array.from({ length: 150_000 }, (_, i) => ({
      x: i - 75_000, y: i % 2 ? -40 : 60, surface: 'street' as const,
    }))
    const expanded = expandAroundBoundsCenter(points, [], 2)
    expect(expanded.points).toHaveLength(points.length)
    expect(expanded.points[0]?.x).toBeCloseTo(-149_999.5)
    expect(expanded.points.at(-1)?.x).toBeCloseTo(149_998.5)
    expect(expanded.points[0]?.y).toBe(110)
    expect(expanded.points[1]?.y).toBe(-90)
    expect(points[0]?.x).toBe(-75_000)
  })

  it('keeps the midpoint finite across opposite extreme finite coordinates', () => {
    const points = [
      { x: -1e308, y: 0, surface: 'street' as const },
      { x: 1e308, y: 0, surface: 'street' as const },
      { x: 0, y: 0, surface: 'street' as const },
    ]
    const result = expandAroundBoundsCenter(points, [], 2)
    expect(result.points[2]?.x).toBe(0)
    expect(Number.isFinite(result.points[2]?.x)).toBe(true)
  })

  it('uses scenery-only bounds when a world contains no road or trees', () => {
    const result = expandAroundBoundsCenter([], [], 2, [
      { kind: 'city-house', x: -10, y: -30 },
      { kind: 'city-house', x: 30, y: 10 },
    ])
    expect(result.scenery.map(({ x, y }) => ({ x, y })))
      .toEqual([{ x: -30, y: -50 }, { x: 50, y: 30 }])
  })
})
