import { describe, expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { courseIdentity, medalTargets, timeMedal } from '@/application/race/raceRecords'
import { BrowserCupRepository } from '@/infrastructure/storage/cupRepository'
import { createCup, recordCupResult, retryCupRace, advanceCup, CUP_CIRCUITS } from '@/application/race/circuitCup'
import type { KeyValueStore, ScoreEntry } from '@/application/ports/storage'
import { requireFixture } from '../fixtures/requireFixture'

function memory(): KeyValueStore {
  const values = new Map<string, string>()
  return { get: (key) => values.get(key) ?? null, set: (key, value) => { values.set(key, value); return true }, remove: (key) => values.delete(key) }
}
const standings = [{ id: 'player', player: true, car: 'blue', place: 1, finishTime: 10, wrecked: false, lap: 1 }] as Parameters<typeof recordCupResult>[1]
describe('persistent Cup progress', () => {
  it('keeps the best placement when a stored checkpoint is invalid', () => {
    const storage = memory()
    storage.set('trackforge-cup-v1', JSON.stringify({ version: 1, checkpoint: { index: 99 }, bestPlacement: 2 }))
    expect(new BrowserCupRepository(storage).load()).toEqual({ checkpoint: null, bestPlacement: 2 })
  })
  it('reloads checkpoints, ignores duplicate results, retries and completes atomically', () => {
    const storage = memory()
    let repository = new BrowserCupRepository(storage)
    let cup = createCup('blue', 'normal')
    repository.save({ checkpoint: cup, bestPlacement: null })
    repository = new BrowserCupRepository(storage)
    cup = requireFixture(repository.load().checkpoint ?? undefined)
    cup = recordCupResult(cup, standings)
    repository.save({ checkpoint: cup, bestPlacement: null })
    cup = requireFixture(repository.load().checkpoint ?? undefined)
    expect(recordCupResult(cup, standings)).toEqual(cup)
    cup = retryCupRace(cup)
    expect(cup.rounds).toHaveLength(0)
    cup = recordCupResult(cup, standings)
    for (let i = 1; i < CUP_CIRCUITS.length; i++) cup = recordCupResult(advanceCup(cup), standings)
    repository.save({ checkpoint: null, bestPlacement: 1 })
    expect(new BrowserCupRepository(storage).load()).toEqual({ checkpoint: null, bestPlacement: 1 })
  })
})
describe('time medals', () => {
  it('includes thresholds and rejects incompatible scores', () => {
    const { track } = OFFICIAL_CIRCUITS[0]
    const targets = medalTargets(track)
    if (!targets) throw new Error('Missing Meadow Loop targets')
    const category = { course: courseIdentity(track), laps: 1, handling: 'arcade', mode: 'normal' } as const
    const score: ScoreEntry = { time: targets.gold, car: 'blue', difficulty: 'normal', recordedAt: 1, category }
    expect(timeMedal(track, [score])).toBe('gold')
    expect(timeMedal(track, [{ ...score, time: targets.silver }])).toBe('silver')
    expect(timeMedal(track, [{ ...score, time: targets.bronze }])).toBe('bronze')
    expect(timeMedal(track, [{ time: 8, car: 'blue', difficulty: 'normal', recordedAt: 1 }])).toBeNull()
    for (const incompatible of [{ ...category, course: 'old' }, { ...category, laps: 2 }, { ...category, handling: 'simulation' as const }]) {
      expect(timeMedal(track, [{ ...score, category: incompatible }])).toBeNull()
    }
  })
})
