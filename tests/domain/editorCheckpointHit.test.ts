import { describe, expect, it } from 'vitest'
import { nearestCheckpointMarker } from '@/domain/editor/editorGeometry'

describe('checkpoint marker hit testing', () => {
  const samples = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }]

  it('selects the closest authored marker rather than another road point', () => {
    const marks = [0, 1 / 3, 2 / 3]
    expect(nearestCheckpointMarker(samples, false, marks, { x: 106, y: 0 }, 1)).toBe(1 / 3)
    expect(marks).toEqual([0, 1 / 3, 2 / 3])
  })

  it('uses a fixed screen-space grab radius across zoom levels', () => {
    const mark = 1 / 3
    expect(nearestCheckpointMarker(samples, false, [mark], { x: 121, y: 0 }, 1)).toBeUndefined()
    expect(nearestCheckpointMarker(samples, false, [mark], { x: 121, y: 0 }, 0.5)).toBe(mark)
  })

  it('rejects empty paths and ignores out-of-range marker ratios', () => {
    expect(nearestCheckpointMarker([], false, [0], { x: 0, y: 0 }, 1)).toBeUndefined()
    expect(nearestCheckpointMarker(samples, false, [2, Number.NaN], { x: 300, y: 0 }, 1)).toBeUndefined()
  })

  it('uses closed-loop path sampling for wrapped markers', () => {
    expect(nearestCheckpointMarker(samples, true, [0.75], { x: 302, y: 1 }, 1)).toBe(0.75)
  })
})
