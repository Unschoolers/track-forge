import { describe, expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createCup, recordCupResult, advanceCup, cupStandings, retryCupRace } from '@/application/race/circuitCup'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

describe('official circuit cup', () => {
  it('offers four distinct race-ready circuits', () => {
    expect(new Set(OFFICIAL_CIRCUITS.map(({ track }) => track.id)).size).toBe(4)
    for (const { track } of OFFICIAL_CIRCUITS) {
      expect(validateTrack(track, buildRoadPath(track.points, track.terrain).totalLength).ready).toBe(true)
    }
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
