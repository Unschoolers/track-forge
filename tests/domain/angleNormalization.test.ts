import { describe, expect, it } from 'vitest'
import { wrapAngleRadians } from '@/domain/geometry/math'

describe('shared angular normalization for AI, geometry and editor', () => {
  it('normalizes equivalent rotations without losing turn direction', () => {
    expect(wrapAngleRadians(2 * Math.PI + 0.25)).toBeCloseTo(0.25)
    expect(wrapAngleRadians(-2 * Math.PI - 0.25)).toBeCloseTo(-0.25)
    expect(wrapAngleRadians(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1)
    expect(wrapAngleRadians(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1)
  })

  it('preserves a small steering correction around zero', () => {
    expect(wrapAngleRadians(0)).toBeCloseTo(0)
    expect(wrapAngleRadians(0.02)).toBeCloseTo(0.02)
    expect(wrapAngleRadians(-0.02)).toBeCloseTo(-0.02)
  })
})
