import { describe, expect, it } from 'vitest'
import { moveCupTrack, removeCupTrack } from '@/application/race/circuitCup'

describe('cup lineup editing', () => {
  const lineup = ['meadow', 'harbor', 'hairpin'] as const

  it('reorders a selected track one position without mutating the source lineup', () => {
    expect(moveCupTrack(lineup, 0, 1)).toEqual(['harbor', 'meadow', 'hairpin'])
    expect(moveCupTrack(lineup, 2, -1)).toEqual(['meadow', 'hairpin', 'harbor'])
    expect(lineup).toEqual(['meadow', 'harbor', 'hairpin'])
  })

  it('rejects invalid move indices and boundaries without changing the lineup', () => {
    for (const index of [-1, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(moveCupTrack(lineup, index, 1)).toBeNull()
    }
    expect(moveCupTrack(lineup, 0, -1)).toBeNull()
    expect(moveCupTrack(lineup, 2, 1)).toBeNull()
  })

  it('removes only the requested track and preserves the others in order', () => {
    expect(removeCupTrack(lineup, 1)).toEqual(['meadow', 'hairpin'])
    expect(removeCupTrack(lineup, 0)).toEqual(['harbor', 'hairpin'])
    expect(removeCupTrack(['only'], 0)).toEqual([])
    expect(lineup).toHaveLength(3)
  })

  it('rejects out-of-range and fractional removals without mutating the source', () => {
    for (const index of [-1, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(removeCupTrack(lineup, index)).toBeNull()
    }
    expect(lineup).toEqual(['meadow', 'harbor', 'hairpin'])
  })
})
