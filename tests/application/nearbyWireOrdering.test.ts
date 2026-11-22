import { describe, expect, it } from 'vitest'
import { isNewerWireSequence } from '@/application/multiplayer/raceWire'

describe('nearby 16-bit packet ordering', () => {
  it('accepts first packets and forward progress, including wraparound', () => {
    expect(isNewerWireSequence(0, undefined)).toBe(true)
    expect(isNewerWireSequence(1, 0)).toBe(true)
    expect(isNewerWireSequence(0, 65_535)).toBe(true)
    expect(isNewerWireSequence(10, 65_530)).toBe(true)
  })

  it('rejects duplicates, delayed packets, and ambiguous half-cycle jumps', () => {
    expect(isNewerWireSequence(12, 12)).toBe(false)
    expect(isNewerWireSequence(11, 12)).toBe(false)
    expect(isNewerWireSequence(65_535, 0)).toBe(false)
    expect(isNewerWireSequence(32_768, 0)).toBe(false)
    expect(isNewerWireSequence(0, 32_768)).toBe(false)
  })

  it('rejects malformed sequence values at a protocol boundary', () => {
    expect(isNewerWireSequence(-1, 0)).toBe(false)
    expect(isNewerWireSequence(65_536, 0)).toBe(false)
    expect(isNewerWireSequence(Number.NaN, undefined)).toBe(false)
  })
})
