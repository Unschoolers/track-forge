import { describe, expect, it, vi } from 'vitest'
import type { KeyValueStore } from '@/application/ports/storage'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { ghostRaceKey } from '@/application/race/ghostReplay'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import { BrowserLastRaceRepository } from '@/infrastructure/storage/lastRaceRepository'
import { BrowserPreferencesRepository, DEFAULT_PREFERENCES } from '@/infrastructure/storage/preferencesRepository'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

function memory() {
  const values = new Map<string, string>()
  let writable = true
  const storage: KeyValueStore = {
    get: key => values.get(key) ?? null,
    set: (key, value) => {
      if (!writable) return false
      values.set(key, value)
      return true
    },
    remove: key => values.delete(key),
  }
  return { values, storage, failWrites: () => { writable = false }, allowWrites: () => { writable = true } }
}

const track = createStarterTrack(asTrackId('upgrade-track'), 42)
const category = { course: 'v3:example', laps: 2, mode: 'normal' as const }
const score = (time: number) => ({
  time, recordedAt: time, car: 'blue' as const, difficulty: 'normal' as const, category,
})
const oldScore = (time: number, handling: string) => ({
  ...score(time), category: { ...category, handling },
})
const setup = { car: 'blue' as const, laps: 2 }
const key = ghostRaceKey(track, setup)
const run = (time: number) => ({
  car: setup.car, time,
  frames: [0, time].map(t => ({ t, x: t, y: 0, angle: 0, z: 0, structureRunId: null })),
})
const race = {
  trackId: track.id, course: category.course,
  setup: { ...setup, difficulty: 'normal' as const, mode: 'ghost' as const, lighting: 'night' as const },
}

describe('single ruleset storage upgrade', () => {
  it('merges valid Arcade scores and existing new records without duplicates or Simulation records', () => {
    const { values, storage } = memory()
    const source = JSON.stringify({ [track.id]: [oldScore(20, 'arcade'), oldScore(9, 'simulation'), oldScore(0, 'arcade'), oldScore(18, 'arcade')] })
    values.set('trackforge-highscores-v2', source)
    values.set(STORAGE_KEYS.scores, JSON.stringify({ [track.id]: [score(20), score(15)] }))
    const repository = new BrowserScoreRepository(storage)
    expect(repository.forTrack(track.id)).toEqual([score(15), score(18), score(20)])
    expect(new BrowserScoreRepository(storage).forTrack(track.id)).toEqual([score(15), score(18), score(20)])
    expect(values.get('trackforge-highscores-v2')).toBe(source)
    expect(repository.removeTrack(track.id)).toBe(true)
    expect(new BrowserScoreRepository(storage).forTrack(track.id)).toEqual([])
  })

  it('retains uncategorised old scores as historical records but never reimports a previously migrated v1 bank', () => {
    const { values, storage } = memory()
    const legacy = { time: 12, date: 100, car: 'red', difficulty: 'hard' }
    values.set('trackforge-highscores-v1', JSON.stringify({ [track.id]: [legacy] }))
    values.set('trackforge-highscores-v1-migrated', '1')
    expect(new BrowserScoreRepository(storage).forTrack(track.id)).toEqual([])
    values.delete('trackforge-highscores-v1-migrated')
    const scores = new BrowserScoreRepository(storage).forTrack(track.id)
    expect(scores).toEqual([{ time: 12, recordedAt: 100, car: 'red', difficulty: 'hard' }])
    expect(scores[0]?.category).toBeUndefined()
  })

  it('keeps scores readable after a failed migration write and retries without losing history', () => {
    const { values, storage, failWrites, allowWrites } = memory()
    values.set('trackforge-highscores-v2', JSON.stringify({ [track.id]: [oldScore(20, 'arcade')] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      failWrites()
      const repository = new BrowserScoreRepository(storage)
      expect(repository.forTrack(track.id)).toEqual([score(20)])
      expect(repository.record(track.id, score(10))).toBe(false)
      expect(values.has(STORAGE_KEYS.scores)).toBe(false)
      allowWrites()
      expect(repository.record(track.id, score(10))).toBe(true)
      expect(new BrowserScoreRepository(storage).forTrack(track.id)).toEqual([score(10), score(20)])
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('migrates exact Arcade ghost keys, keeps the fastest duplicate and preserves cuts and splits', () => {
    const { values, storage } = memory()
    const reverse = { ...track, start: { ratio: 0, reversed: true } }
    const reverseKey = ghostRaceKey(reverse, setup)
    const otherSetup = { ...setup, laps: 3 }
    const saved = { ...run(18), splits: [9, 18], frames: [run(18).frames[0], { ...run(18).frames[1], cut: true }] }
    const source = JSON.stringify({
      [key + '|arcade']: saved,
      [key + '|simulation']: run(8),
      [reverseKey + '|arcade']: run(25),
      [ghostRaceKey(track, otherSetup) + '|simulation']: run(6),
    })
    values.set('trackforge-ghost-runs-v1', source)
    values.set('trackforge-ghost-runs-v2', JSON.stringify({ [key]: run(22) }))
    const repository = new BrowserGhostRepository(storage)
    expect(repository.load(track, setup)).toEqual(saved)
    expect(repository.availability(track, setup)).toEqual({ kind: 'exact', time: 18 })
    expect(repository.load(reverse, setup)?.time).toBe(25)
    expect(repository.load(track, otherSetup)).toBeNull()
    expect(repository.load({ ...track, raceRevision: 43 }, setup)).toBeNull()
    expect(repository.record(track, setup, 15, run(15).frames)).toBe(true)
    expect(new BrowserGhostRepository(storage).load(track, setup)?.time).toBe(15)
    expect(values.get('trackforge-ghost-runs-v1')).toBe(source)
  })

  it('keeps old ghosts accessible during a failed write without silently evicting them', () => {
    const { values, storage, failWrites, allowWrites } = memory()
    values.set('trackforge-ghost-runs-v1', JSON.stringify({ [key + '|arcade']: run(20) }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      failWrites()
      const repository = new BrowserGhostRepository(storage)
      expect(repository.load(track, setup)?.time).toBe(20)
      expect(repository.record(track, setup, 15, run(15).frames)).toBe(false)
      expect(values.has('trackforge-ghost-runs-v2')).toBe(false)
      allowWrites()
      expect(repository.record(track, setup, 15, run(15).frames)).toBe(true)
      expect(new BrowserGhostRepository(storage).load(track, setup)?.time).toBe(15)
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('restores Race Again for Arcade but rejects Simulation and never overwrites a new race', () => {
    const { values, storage } = memory()
    const oldRace = (handling: string) => JSON.stringify({ version: 1, ...race, setup: { ...race.setup, handling } })
    values.set('trackforge-last-race-v1', oldRace('simulation'))
    const repository = new BrowserLastRaceRepository(storage)
    expect(repository.load()).toBeNull()
    values.set('trackforge-last-race-v1', oldRace('arcade'))
    expect(repository.load()).toEqual(race)
    const latest = { ...race, setup: { ...race.setup, laps: 3 } }
    expect(repository.save(latest)).toBe(true)
    expect(new BrowserLastRaceRepository(storage).load()).toEqual(latest)
    expect(values.get('trackforge-last-race-v1')).toBe(oldRace('arcade'))
  })

  it('reads the previous authoritative preferences even if individual key mirrors are stale', () => {
    const { values, storage } = memory()
    const repository = new BrowserPreferencesRepository(storage)
    expect(repository.save({ ...DEFAULT_PREFERENCES, car: 'red', pedalMode: 'manual', favoriteTrackIds: ['favorite'] })).toBe(true)
    const snapshot = JSON.parse(values.get(STORAGE_KEYS.preferencesSnapshot)!)
    delete snapshot.values[STORAGE_KEYS.pedalMode]
    snapshot.values['trackforge-handling-mode'] = 'simulation'
    values.set(STORAGE_KEYS.preferencesSnapshot, JSON.stringify(snapshot))
    values.set(STORAGE_KEYS.car, 'blue')
    values.delete(STORAGE_KEYS.pedalMode)
    expect(new BrowserPreferencesRepository(storage).load()).toMatchObject({ car: 'red', pedalMode: 'manual', favoriteTrackIds: ['favorite'] })
    expect(repository.save({ ...repository.load(), pedalMode: 'auto' })).toBe(true)
    expect(new BrowserPreferencesRepository(storage).load().pedalMode).toBe('auto')
  })
})
