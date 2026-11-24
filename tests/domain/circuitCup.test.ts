import { describe, expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createCup, recordCupResult, advanceCup, cupStandings, retryCupRace, CUP_CIRCUITS, cupRoundCount, cupTrackIds } from '@/application/race/circuitCup'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

describe('official circuit cup', () => {
  it('offers three distinct race-ready circuits', () => {
    expect(new Set(OFFICIAL_CIRCUITS.map(({ track }) => track.id)).size).toBe(3)
    expect(CUP_CIRCUITS).toHaveLength(3)
    for (const { track } of OFFICIAL_CIRCUITS) {
      expect(validateTrack(track, buildRoadPath(track.points, track.terrain).totalLength).ready).toBe(true)
    }
  })
  it('finishes after the three Cup rounds', () => {
    const standings = [{ id: 'player', car: 'blue' as const, player: true, place: 1, finishTime: 10, wrecked: false, lap: 1 }]
    let cup = createCup()
    for (let round = 0; round < 3; round++) {
      cup = advanceCup(recordCupResult(cup, standings))
    }
    expect(cup.index).toBe(2)
    expect(cupStandings(cup)[0]?.points).toBe(30)
  })
  it('freezes a custom lineup and advances through its exact number of rounds', () => {
    const tracks = [OFFICIAL_CIRCUITS[0]!.track.id, OFFICIAL_CIRCUITS[1]!.track.id]
    const standings = [{ id: 'player', car: 'blue' as const, player: true, place: 1, finishTime: 10, wrecked: false, lap: 1 }]
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
    const standings = [{ id: 'player', car: 'blue' as const, player: true, place: 1, finishTime: 10, wrecked: false, lap: 1 }]
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
