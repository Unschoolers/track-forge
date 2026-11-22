import { describe, expect, it } from 'vitest'
import { planPointInsertion } from '@/domain/editor/editorGeometry'

const segment = [
  { x: 0, y: 0, surface: 'street' as const, id: 'start' },
  { x: 100, y: 0, surface: 'street' as const, id: 'end' },
]

describe('authored road point insertion', () => {
  it('rejects non-finite pointer coordinates rather than adding invisible corrupt points', () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(planPointInsertion(segment, 0, { x, y: 0 })).toBeNull()
      expect(planPointInsertion(segment, 0, { x: 10, y: x })).toBeNull()
    }
  })

  it('preserves endpoints and clamps a finite projection within the segment', () => {
    expect(planPointInsertion(segment, 0, { x: -1_000, y: 100 })?.point.x).toBeCloseTo(10)
    expect(planPointInsertion(segment, 0, { x: 1_000, y: 100 })?.point.x).toBeCloseTo(90)
    expect(planPointInsertion(segment, 0, { x: 50, y: 100 })).toMatchObject({
      index: 1, point: { x: 50, y: 0, surface: 'street', tension: 0.5 },
    })
    expect(segment[0]?.id).toBe('start')
    expect(segment[1]?.id).toBe('end')
  })

  it('rejects missing or degenerate source segments', () => {
    expect(planPointInsertion(segment, -1, { x: 10, y: 0 })).toBeNull()
    expect(planPointInsertion(segment, 1, { x: 10, y: 0 })).toBeNull()
    expect(planPointInsertion([segment[0]!, { ...segment[0]!, id: 'duplicate' }], 0, { x: 10, y: 0 })).toBeNull()
  })
})
