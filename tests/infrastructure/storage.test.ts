import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import {
  BrowserPreferencesRepository,
  DEFAULT_PREFERENCES,
} from '@/infrastructure/storage/preferencesRepository'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import type { KeyValueStore } from '@/application/ports/storage'
import {
  legacyScore,
  legacyTrack,
} from '../fixtures/legacyStorage'

class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, string>()
  readonly failedKeys = new Set<string>()
  failWrites = false

  get(key: string): string | null {
    return this.values.get(key) ?? null
  }

  set(key: string, value: string): boolean {
    if (this.failWrites || this.failedKeys.has(key)) return false
    this.values.set(key, value)
    return true
  }

  remove(key: string): boolean {
    return this.values.delete(key)
  }
}

it('does not read or write the obsolete lighting preference', () => {
  const memory = new MemoryStore()
  memory.values.set('trackforge-lighting', 'night')
  memory.failedKeys.add('trackforge-lighting')
  const repository = new BrowserPreferencesRepository(memory)
  const loaded = repository.load()
  expect(loaded).not.toHaveProperty('lighting')
  expect(repository.save(loaded)).toBe(true)
  expect(memory.values.get('trackforge-lighting')).toBe('night')
})

it('persists the explicit race mode and rejects unknown stored modes', () => {
  const memory = new MemoryStore()
  const preferences = new BrowserPreferencesRepository(memory)
  expect(preferences.load().raceMode).toBe('normal')
  preferences.save({ ...preferences.load(), raceMode: 'ghost' })
  expect(preferences.load().raceMode).toBe('ghost')
  memory.values.set('trackforge-race-mode', 'invalid')
  expect(preferences.load().raceMode).toBe('normal')
})

describe('BrowserTrackRepository', () => {
  it('round-trips normalized tracks and ignores malformed records', () => {
    const storage = new MemoryStore()
    const repository = new BrowserTrackRepository(storage)
    const track = createStarterTrack(asTrackId('starter'), 10)

    expect(repository.save({ ...track, name: '  Starter   Circuit  ' })).toBe(
      true,
    )
    storage.values.set(
      'trackforge-library-v2',
      JSON.stringify([
        ...repository.list(),
        { id: 'bad', name: 'Bad', points: [{ x: 'x', y: 2 }] },
      ]),
    )

    expect(repository.list()).toHaveLength(1)
    expect(repository.find(track.id)?.name).toBe('Starter Circuit')
  })

  it('recovers a legacy autosave once when the v2 library is empty', () => {
    const storage = new MemoryStore()
    storage.values.set(
      'trackforge-autosave-v2',
      JSON.stringify({
        points: createStarterTrack(asTrackId('source'), 1).points,
        trees: [{ x: 1, y: 2 }],
        timeOfDay: 'night',
      }),
    )
    const repository = new BrowserTrackRepository(storage, {
      createId: () => asTrackId('recovered'),
      now: () => 99,
    })

    const tracks = repository.list()

    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({
      id: 'recovered',
      name: 'Recovered Track',
      lighting: 'night',
      createdAt: 99,
    })
    expect(storage.values.has('trackforge-library-v2')).toBe(true)
    expect(tracks[0]?.version).toBe(8)
    expect(tracks[0]?.start).toEqual({ ratio: 0, reversed: false })
    expect(tracks[0]?.points[0]).toMatchObject({
      id: 'point-0',
      curve: 'smooth',
      tension: 0.5,
    })
  })

  it('merges the v1 library with an existing v2 library idempotently', () => {
    const storage = new MemoryStore()
    const starter = createStarterTrack(asTrackId('starter'), 10)
    storage.values.set('trackforge-library-v2', JSON.stringify([starter]))
    storage.values.set(
      'trackforge-library-v1',
      JSON.stringify([legacyTrack]),
    )
    const repository = new BrowserTrackRepository(storage, {
      now: () => 999,
    })

    expect(repository.list().map((track) => track.id)).toEqual([
      'legacy-harbor',
      'starter',
    ])
    expect(repository.find(asTrackId('legacy-harbor'))).toMatchObject({
      name: 'Midnight Harbor',
      lighting: 'night',
    })
    expect(repository.list().map((track) => track.id)).toEqual([
      'legacy-harbor',
      'starter',
    ])
    expect(
      JSON.parse(storage.values.get('trackforge-library-v2') ?? '[]'),
    ).toHaveLength(2)
  })

  it('uses the injected clock when stored timestamps are invalid', () => {
    const storage = new MemoryStore()
    storage.values.set(
      'trackforge-library-v2',
      JSON.stringify([
        {
          ...legacyTrack,
          createdAt: 'invalid',
          updatedAt: null,
        },
      ]),
    )
    const repository = new BrowserTrackRepository(storage, {
      now: () => 777,
    })

    expect(repository.list()[0]).toMatchObject({
      createdAt: 777,
      updatedAt: 777,
    })
  })

  it('does not mark autosave recovery complete when its library write fails', () => {
    const storage = new MemoryStore()
    storage.values.set(
      'trackforge-autosave-v2',
      JSON.stringify({
        points: legacyTrack.points,
        trees: legacyTrack.trees,
      }),
    )
    storage.failedKeys.add('trackforge-library-v2')
    const repository = new BrowserTrackRepository(storage, {
      createId: () => asTrackId('recovered'),
      now: () => 99,
    })

    expect(repository.list()).toHaveLength(1)
    expect(storage.values.has('trackforge-library-v1-migrated')).toBe(false)
  })

  it('reports storage write failures', () => {
    const storage = new MemoryStore()
    storage.failWrites = true
    const repository = new BrowserTrackRepository(storage)

    expect(
      repository.save(createStarterTrack(asTrackId('starter'), 10)),
    ).toBe(false)
  })

  it('migrates v7 terrain and road elevation at the persistence boundary', () => {
    const storage = new MemoryStore()
    const repository = new BrowserTrackRepository(storage)
    const id = asTrackId('terrain-migration')

    storage.values.set(
      'trackforge-library-v2',
      JSON.stringify([
        {
          ...createStarterTrack(id, 1),
          version: 7,
          terrain: undefined,
          points: [
            { x: 0, y: 0, surface: 'street', elevation: 'overhead' },
            { x: 100, y: 0, surface: 'street', elevation: 'ground' },
          ],
        },
      ]),
    )

    const migrated = repository.find(id)

    expect(migrated).toMatchObject({
      version: 8,
      terrain: { cellSize: 32, cells: [] },
    })
    expect(migrated?.points[0]?.structure).toBe('overpass')
    expect(migrated?.points[0]).not.toHaveProperty('elevation')
  })

  it('migrates legacy crossing elevation onto the authored upper section', () => {
    const storage = new MemoryStore()
    const repository = new BrowserTrackRepository(storage)
    const track = createStarterTrack(asTrackId('bridge'), 10)

    storage.values.set(
      'trackforge-library-v2',
      JSON.stringify([
        {
          ...track,
          version: 6,
          elevations: [
            { firstSegment: 2, secondSegment: 8, upperSegment: 8 },
            { firstSegment: 4, secondSegment: 4, upperSegment: 4 },
          ],
        },
      ]),
    )

    expect(repository.find(track.id)?.version).toBe(8)
    expect(repository.find(track.id)).not.toHaveProperty('elevations')
    expect(repository.find(track.id)?.points[8]?.structure).toBe('overpass')
    expect(repository.find(track.id)?.points[2]?.structure).toBe('surface')
  })
})

describe('score and preference repositories', () => {
  it('merges legacy scores and normalizes their recorded date', () => {
    const storage = new MemoryStore()
    const trackId = asTrackId('legacy-harbor')
    storage.values.set(
      'trackforge-highscores-v1',
      JSON.stringify({ [trackId]: [legacyScore] }),
    )
    storage.values.set(
      'trackforge-highscores-v2',
      JSON.stringify({
        [trackId]: [
          {
            time: 45,
            car: 'blue',
            difficulty: 'normal',
            recordedAt: 400,
          },
        ],
      }),
    )
    const scores = new BrowserScoreRepository(storage)

    expect(scores.forTrack(trackId)).toEqual([
      {
        time: 42.5,
        car: 'green',
        difficulty: 'hard',
        recordedAt: 300,
      },
      {
        time: 45,
        car: 'blue',
        difficulty: 'normal',
        recordedAt: 400,
      },
    ])
    expect(scores.forTrack(trackId)).toHaveLength(2)
  })

  it('keeps the five fastest finite scores per track', () => {
    const storage = new MemoryStore()
    const scores = new BrowserScoreRepository(storage)
    const trackId = asTrackId('starter')

    for (const time of [12, 9, 11, Number.NaN, 8, 10, 7]) {
      scores.record(trackId, {
        time,
        car: 'blue',
        difficulty: 'normal',
        recordedAt: 1,
      })
    }

    expect(scores.forTrack(trackId).map((score) => score.time)).toEqual([
      7, 8, 9, 10, 11,
    ])
  })

  it('retains ranked scores separately for each modern category and legacy', () => {
    const storage = new MemoryStore()
    const scores = new BrowserScoreRepository(storage)
    const trackId = asTrackId('partitioned')
    for (const laps of [1, 3]) {
      for (const time of [1, 2, 3, 4, 5, 6]) {
        scores.record(trackId, { time, car: 'blue', difficulty: 'normal', recordedAt: time,
          category: { course: 'course', laps, handling: 'arcade', mode: 'normal' } })
      }
    }
    scores.record(trackId, { time: 0.5, car: 'blue', difficulty: 'normal', recordedAt: 1 })
    expect(scores.forTrack(trackId)).toHaveLength(11)
    expect(scores.forTrack(trackId).filter((score) => score.category?.laps === 3).map((score) => score.time)).toEqual([1, 2, 3, 4, 5])
    scores.removeTrack(trackId)
    expect(scores.forTrack(trackId)).toEqual([])
  })

  it('supports quick one-lap sprints without changing classic-race defaults', () => {
    const storage = new MemoryStore()
    const preferences = new BrowserPreferencesRepository(storage)
    expect(preferences.load().raceLaps).toBe(2)
    expect(preferences.save({ ...preferences.load(), raceLaps: 1 })).toBe(true)
    expect(preferences.load().raceLaps).toBe(1)
    storage.values.set('trackforge-race-laps', '999')
    expect(preferences.load().raceLaps).toBe(2)
    expect(preferences.save({ ...preferences.load(), raceLaps: 3 })).toBe(true)
    expect(preferences.load().raceLaps).toBe(3)
  })

  it('defaults upgraded installations to Arcade and persists Simulation explicitly', () => {
    const storage = new MemoryStore()
    const preferences = new BrowserPreferencesRepository(storage)
    expect(preferences.load().handling).toBe('arcade')
    expect(preferences.save({ ...preferences.load(), handling: 'simulation' })).toBe(true)
    expect(preferences.load().handling).toBe('simulation')
    expect(storage.values.get('trackforge-handling-mode')).toBe('simulation')
    storage.values.set('trackforge-handling-mode', 'invalid')
    expect(preferences.load().handling).toBe('arcade')
  })

  it('defaults legacy and malformed steering sensitivity and persists each option', () => {
    const storage = new MemoryStore()
    const preferences = new BrowserPreferencesRepository(storage)
    expect(preferences.load().steeringSensitivity).toBe(1)
    for (const steeringSensitivity of [0.75, 1.5, 1] as const) {
      expect(preferences.save({ ...preferences.load(), steeringSensitivity })).toBe(true)
      expect(new BrowserPreferencesRepository(storage).load().steeringSensitivity).toBe(steeringSensitivity)
    }
    storage.values.set('trackforge-steering-sensitivity', '2')
    expect(preferences.load().steeringSensitivity).toBe(1)
  })

  it('falls back for invalid preferences and persists valid changes', () => {
    const storage = new MemoryStore()
    storage.values.set('trackforge-last-car', 'purple')
    const preferences = new BrowserPreferencesRepository(storage)

    expect(preferences.load()).toEqual(DEFAULT_PREFERENCES)
    expect(
      preferences.save({
        ...DEFAULT_PREFERENCES,
        car: 'green',
        hapticsEnabled: false,
      }),
    ).toBe(true)
    expect(preferences.load()).toMatchObject({
      car: 'green',
      hapticsEnabled: false,
    })
  })
})
