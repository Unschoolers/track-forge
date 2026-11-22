import { describe, expect, it } from 'vitest'
import { awardNearbyCupRound, nearbyCupStandings } from '@/application/multiplayer/nearbyCupScoring'

describe('nearby cup scoring', () => {
  it('does not award points before every racer has finished or left', () => {
    const existing = new Map([[0, 10]])
    const pending = [
      { slot: 0, time: 38, left: false },
      { slot: 1, time: undefined, left: false },
    ]
    expect(awardNearbyCupRound(pending, existing)).toBeNull()
    expect(existing.get(0)).toBe(10)
  })

  it('awards finishers by position, ignores unfinished and DNF racers, and preserves previous rounds', () => {
    const existing = new Map([[0, 6], [2, 10]])
    const ranked = [
      { slot: 2, time: 32, left: false },
      { slot: 0, time: 36, left: false },
      { slot: 1, time: null, left: false },
      { slot: 3, time: undefined, left: true },
    ]
    const updated = awardNearbyCupRound(ranked, existing)
    expect([...updated!.entries()]).toEqual([[0, 12], [2, 20]])
    expect([...existing.entries()]).toEqual([[0, 6], [2, 10]])
    expect(nearbyCupStandings([0, 1, 2, 3], updated!)).toEqual([
      { slot: 2, points: 20 }, { slot: 0, points: 12 },
      { slot: 1, points: 0 }, { slot: 3, points: 0 },
    ])
  })

  it('awards meaningful points through eighth place without changing four-player Cup totals', () => {
    const ranked = Array.from({ length: 8 }, (_, slot) => ({ slot, time: slot + 30, left: false }))
    const totals = awardNearbyCupRound(ranked, new Map())
    expect(ranked.map(({ slot }) => totals?.get(slot))).toEqual([16, 12, 10, 8, 6, 4, 2, 1])
  })

  it('keeps tied standings stable by slot and never scores an empty race', () => {
    expect(awardNearbyCupRound([], new Map())).toBeNull()
    expect(nearbyCupStandings([3, 1, 2], new Map([[3, 8], [1, 8]])))
      .toEqual([{ slot: 1, points: 8 }, { slot: 3, points: 8 }, { slot: 2, points: 0 }])
  })
})
