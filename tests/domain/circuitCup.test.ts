import { describe, expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createCup, recordCupResult, advanceCup, cupStandings, retryCupRace, CUP_CIRCUITS, cupRoundCount, cupTrackIds } from '@/application/race/circuitCup'

describe('official circuit cup', () => {
  it('offers each official circuit once in the default Cup', () => {
    const ids = OFFICIAL_CIRCUITS.map(({ track }) => track.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CUP_CIRCUITS.map(({ track }) => track.id)).toEqual(ids)
  })
  it('freezes a custom lineup and advances through its exact number of rounds', () => {
    const tracks = [OFFICIAL_CIRCUITS[0]!.track.id, OFFICIAL_CIRCUITS[1]!.track.id]
    const standings = [{ id: 'player', car: 'blue' as const, player: true, place: 1, finishTime: 10, lap: 1 }]
    let cup = createCup('blue', 'normal', tracks)
    expect(cupTrackIds(cup)).toEqual(tracks)
    cup = advanceCup(recordCupResult(cup, standings))
    expect(cup.index).toBe(1)
    cup = advanceCup(recordCupResult(cup, standings))
    expect(cup.index).toBe(1)
    expect(cupRoundCount(cup)).toBe(2)
    expect(cupStandings(cup)[0]?.points).toBe(20)
  })
  it('rejects an empty or oversized cup sequence', () => {
    expect(() => createCup('blue', 'normal', [])).toThrow()
    expect(() => createCup('blue', 'normal', Array(13).fill(OFFICIAL_CIRCUITS[0]!.track.id))).toThrow()
  })
  it('records each race only once and advances through the fixed order', () => {
    let cup = createCup()
    const standings = [{ id: 'player', car: 'blue' as const, player: true, place: 1, finishTime: 10, lap: 1 }]
    cup = recordCupResult(cup, standings)
    expect(recordCupResult(cup, standings)).toEqual(cup)
    expect(cupStandings(cup)[0]?.points).toBe(10)
    cup = advanceCup(cup)
    expect(cup.index).toBe(1)
    expect(cupStandings(cup)[0]?.points).toBe(10)
    expect(cup.rounds).toHaveLength(1)
    cup = recordCupResult(cup, standings)
    expect(cupStandings(cup)[0]?.points).toBe(20)
    expect(cupStandings(retryCupRace(cup))[0]?.points).toBe(10)
  })
})
