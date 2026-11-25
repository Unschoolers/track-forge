import { describe, expect, it, vi } from 'vitest'
import { createRaceResult } from '@/application/race/raceResultRecorder'
import { raceCategory } from '@/application/race/raceRecords'
import { createRace } from '@/domain/race/raceFactory'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { asTrackId } from '@/domain/model'
import type { ScoreEntry } from '@/application/ports/storage'
import type { RaceSetup } from '@/application/race/raceSession'

describe('race result collection with large legacy score history', () => {
  it('keeps Boost Practice unranked without reading or writing score history', () => {
    const track = createStarterTrack(asTrackId('unranked-boost-practice'), 1)
    const setup: RaceSetup = { car: 'blue', difficulty: 'normal', laps: 2, mode: 'boost-practice' }
    const state = createRace({ path: buildRoadPath(track.points, track.terrain), playerCar: 'blue', difficulty: 'normal', laps: 2 })
    const finished = { ...state, phase: 'finished' as const, vehicles: state.vehicles.map(vehicle =>
      vehicle.player ? { ...vehicle, lap: 2, finishedAt: 42 } : vehicle) }
    const scoreStore = {
      forTrack: vi.fn(() => [{ car: 'blue' as const, difficulty: 'normal' as const, time: 40, recordedAt: 1 }]),
      record: vi.fn(() => true),
      removeTrack: vi.fn(() => true),
    }
    const result = createRaceResult({
      track, setup, state: finished, terminalReason: undefined, scoreStore,
      now: () => 100, splits: [], bestGhostTime: 39,
    })
    expect(result).toMatchObject({ mode: 'boost-practice', playerTime: 42, newRecord: false, highScores: [] })
    expect(result?.previousBestTime).toBeUndefined()
    expect(scoreStore.forTrack).not.toHaveBeenCalled()
    expect(scoreStore.record).not.toHaveBeenCalled()
  })

  it('finds the fastest comparable historical time without spreading an unbounded argument list', () => {
    const track = createStarterTrack(asTrackId('big-score-history'), 1)
    const setup: RaceSetup = { car: 'blue', difficulty: 'normal', laps: 2, mode: 'normal' }
    const state = createRace({ path: buildRoadPath(track.points, track.terrain), playerCar: 'blue', difficulty: 'normal', laps: 2 })
    const finished = { ...state, phase: 'finished' as const, vehicles: state.vehicles.map(vehicle =>
      vehicle.player ? { ...vehicle, lap: 2, finishedAt: 42 } : vehicle) }
    const score: ScoreEntry = {
      car: 'blue', difficulty: 'normal', time: 55, recordedAt: 1,
      category: raceCategory(track, setup),
    }
    const huge = Array.from({ length: 150_000 }, () => score)
    huge[149_999] = { ...score, time: 40 }
    const scores = {
      forTrack: () => huge,
      record: vi.fn(() => true),
      removeTrack: vi.fn(() => true),
    }
    const result = createRaceResult({
      track, setup, state: finished, terminalReason: undefined, scoreStore: scores,
      now: () => 100, splits: [], bestGhostTime: undefined,
    })
    expect(result?.previousBestTime).toBe(40)
    expect(result?.newRecord).toBe(false)
    expect(scores.record).toHaveBeenCalledOnce()
  })
})
