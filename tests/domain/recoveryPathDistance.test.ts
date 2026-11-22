import { describe, expect, it } from 'vitest'
import { forwardRecoveryDistance } from '@/domain/race/recoveryCheckpoints'

describe('forward route distance used by recovery gates', () => {
  it('wraps circuit samples in the direction of travel', () => {
    expect(forwardRecoveryDistance(8, 2, 10, false, true)).toBe(4)
    expect(forwardRecoveryDistance(2, 8, 10, true, true)).toBe(4)
    expect(forwardRecoveryDistance(4, 4, 10, false, true)).toBe(0)
    expect(forwardRecoveryDistance(4, 4, 10, true, true)).toBe(0)
  })

  it('preserves signed travel distance on an open route', () => {
    expect(forwardRecoveryDistance(2, 8, 10, false, false)).toBe(6)
    expect(forwardRecoveryDistance(2, 8, 10, true, false)).toBe(-6)
  })

  it('does not return NaN when a malformed or empty path has no samples', () => {
    expect(forwardRecoveryDistance(0, 0, 0, false, true)).toBe(0)
  })
})
