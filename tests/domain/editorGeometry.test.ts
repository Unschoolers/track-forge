import { describe, expect, it } from 'vitest'
import {
  appendDrawPoint,
  expandAroundBoundsCenter,
  finalizeDrawGesture,
  nearestControlPoint,
  nearestSegmentIndex,
  nearestTree,
  normalizeClosedLoop,
  surfaceForIndex,
} from '@/domain/editor/editorGeometry'
import type { TrackPoint } from '@/domain/model'

describe('editor geometry', () => {
  it('simplifies a noisy straight gesture and normalizes long spacing', () => {
    const noisy: readonly TrackPoint[] = Array.from(
      { length: 40 },
      (_, index) => ({
        x: index * 10,
        y: Math.sin(index * 1.7) * 2.4,
        surface: 'street' as const,
      }),
    )

    const finalized = finalizeDrawGesture(noisy, 0, 1)

    expect(finalized.length).toBeGreaterThanOrEqual(4)
    expect(finalized.length).toBeLessThanOrEqual(5)
    expect(finalized[0]).toEqual(noisy[0])
    expect(finalized.at(-1)).toEqual(noisy.at(-1))
    for (let index = 1; index < finalized.length; index += 1) {
      const previous = finalized[index - 1]
      const current = finalized[index]
      expect(Math.hypot(
        (current?.x ?? 0) - (previous?.x ?? 0),
        (current?.y ?? 0) - (previous?.y ?? 0),
      )).toBeLessThanOrEqual(121)
    }
  })

  it('preserves a deliberate corner while removing pointer noise', () => {
    const corner: readonly TrackPoint[] = [
      ...Array.from({ length: 11 }, (_, index) => ({
        x: index * 10,
        y: Math.sin(index) * 1.5,
        surface: 'street' as const,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        x: 100 + Math.sin(index) * 1.5,
        y: (index + 1) * 10,
        surface: 'street' as const,
      })),
    ]

    const finalized = finalizeDrawGesture(corner, 0, 1)

    expect(finalized.some(
      (point) => Math.abs(point.x - 100) < 5 && Math.abs(point.y) < 5,
    )).toBe(true)
    expect(finalized.length).toBeLessThan(8)
  })

  it('coalesces a mostly straight drag but preserves a deliberate turn', () => {
    let points: readonly TrackPoint[] = [
      { x: 0, y: 0, surface: 'street' },
      { x: 40, y: 1, surface: 'street' },
    ]
    points = appendDrawPoint(
      points,
      { x: 85, y: 2 },
      'street',
      1,
    )
    expect(points).toHaveLength(2)
    expect(points[1]).toMatchObject({ x: 85, y: 2 })

    points = appendDrawPoint(
      points,
      { x: 90, y: 45 },
      'street',
      1,
    )
    expect(points).toHaveLength(3)
  })

  it('alternates mixed surfaces deterministically', () => {
    expect(
      Array.from({ length: 7 }, (_, index) =>
        surfaceForIndex('mixed', index),
      ),
    ).toEqual([
      'street',
      'dirt',
      'ice',
      'street',
      'dirt',
      'ice',
      'street',
    ])
  })

  it('finds control points, segments, and trees using zoom-aware radii', () => {
    const points: readonly TrackPoint[] = [
      { x: 0, y: 0, surface: 'street' },
      { x: 100, y: 0, surface: 'dirt' },
      { x: 100, y: 100, surface: 'ice' },
    ]
    const trees = [{ x: 40, y: 40 }]

    expect(nearestControlPoint(points, { x: 8, y: 3 }, 1)).toBe(0)
    expect(nearestSegmentIndex(points, { x: 55, y: 5 }, 1)).toBe(0)
    expect(nearestTree(trees, { x: 42, y: 44 }, 1)).toBe(0)
    expect(nearestControlPoint(points, { x: 40, y: 40 }, 2)).toBe(-1)
  })

  it('snaps a closed loop and expands content around its bounds center', () => {
    const points: readonly TrackPoint[] = Array.from(
      { length: 9 },
      (_, index) => ({
        x: index === 8 ? 5 : index * 20,
        y: index === 8 ? 3 : index % 2 === 0 ? 0 : 100,
        surface: 'street' as const,
      }),
    )
    const closed = normalizeClosedLoop(points)
    expect(closed.at(-1)).toMatchObject({ x: 0, y: 0 })

    const expanded = expandAroundBoundsCenter(
      [
        { x: 0, y: 0, surface: 'street' },
        { x: 100, y: 100, surface: 'street' },
      ],
      [{ x: 50, y: 150 }],
      2,
    )
    expect(expanded.points).toEqual([
      { x: -50, y: -75, surface: 'street' },
      { x: 150, y: 125, surface: 'street' },
    ])
    expect(expanded.trees).toEqual([{ x: 50, y: 225 }])
  })
})
