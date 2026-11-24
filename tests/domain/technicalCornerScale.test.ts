import { describe, expect, it } from 'vitest'
import { technicalCornerScale } from '@/domain/race/ai/cornerTactics'

describe('chassis technical corner reserves', () => {
  it('leaves all existing profiles and straight-line pace unchanged', () => {
    for (const bend of [0, 0.1, 0.2, 0.35, 1]) expect(technicalCornerScale(bend)).toBe(1)
    expect(technicalCornerScale(0, 0.7)).toBe(1)
    expect(technicalCornerScale(0.1, 0.7)).toBe(1)
  })
  it('smoothly reserves more entry pace and preview for sharper geometry', () => {
    expect(technicalCornerScale(0.225, 0.7)).toBeCloseTo(0.85)
    expect(technicalCornerScale(0.35, 0.7)).toBeCloseTo(0.7)
    expect(technicalCornerScale(1, 0.7)).toBeCloseTo(0.7)
    expect(technicalCornerScale(1, 0)).toBe(0.5)
    expect(technicalCornerScale(1, 2)).toBe(1)
    expect(technicalCornerScale(0.35, 0.7, 0.4)).toBe(1)
    expect(technicalCornerScale(0.525, 0.7, 0.4)).toBeCloseTo(0.85)
    expect(technicalCornerScale(0.7, 0.7, 0.4)).toBeCloseTo(0.7)
  })
})
