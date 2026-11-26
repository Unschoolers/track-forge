import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { randomPlayerIdentity } from '@/application/multiplayer/playerIdentity'
import { createStarterTrack } from '@/domain/track/starterTrack'
import {
  BrowserPreferencesRepository,
  DEFAULT_PREFERENCES,
} from '@/infrastructure/storage/preferencesRepository'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import type { KeyValueStore } from '@/application/ports/storage'
import {
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

it('remembers multiplayer topper icon and color without reprompting and validates corrupt storage', () => {
  const memory = new MemoryStore()
  const repository = new BrowserPreferencesRepository(memory, () => ({ icon: 'flag', color: 'orange' }))
  expect(repository.load().playerIdentity).toEqual({ icon: 'flag', color: 'orange' })
  expect(JSON.parse(memory.values.get('trackforge-player-topper-v1') ?? 'null')).toEqual({ icon: 'flag', color: 'orange' })
  expect(repository.save({ ...repository.load(), playerIdentity: { icon: 'crown', color: 'violet' } })).toBe(true)
  expect(new BrowserPreferencesRepository(memory).load().playerIdentity).toEqual({ icon: 'crown', color: 'violet' })
  // Legacy corruption checks explicitly bypass the authoritative modern snapshot.
  memory.values.delete('trackforge-preferences-snapshot-v1')
  memory.values.set('trackforge-player-topper-v1', '{broken JSON')
  expect(repository.load().playerIdentity).toEqual({ icon: 'star', color: 'cyan' })
  memory.values.set('trackforge-player-topper-v1', JSON.stringify({ icon: 'hacked', color: 'pink' }))
  expect(repository.load().playerIdentity).toEqual({ icon: 'star', color: 'pink' })
  expect(repository.save({ ...repository.load(), car: 'yellow' })).toBe(true)
  expect(repository.load().playerIdentity).toEqual({ icon: 'star', color: 'pink' })
})

it('selects icon and color independently from a randomized first-launch seed', () => {
  const picks = [0.4, 0.8]
  const selection = randomPlayerIdentity(() => picks.shift() ?? 0)
  expect(selection).toEqual({ icon: 'bolt', color: 'violet' })
})

it('randomizes the first topper once, retaining the saved choice on later launches', () => {
  const store = new MemoryStore()
  let created = 0
  const first = new BrowserPreferencesRepository(store, () => {
    created++
    return { icon: 'diamond', color: 'lime' }
  })
  expect(store.values.has('trackforge-player-topper-v1')).toBe(false)
  expect(first.load().playerIdentity).toEqual({ icon: 'diamond', color: 'lime' })
  expect(first.load().playerIdentity).toEqual({ icon: 'diamond', color: 'lime' })
  expect(created).toBe(1)
  expect(JSON.parse(store.values.get('trackforge-player-topper-v1') ?? 'null'))
    .toEqual({ icon: 'diamond', color: 'lime' })

  // A subsequent launch must not roll again when a selection exists.
  const next = new BrowserPreferencesRepository(store, () => {
    throw new Error('A saved topper must never be randomized again')
  })
  expect(next.load().playerIdentity).toEqual({ icon: 'diamond', color: 'lime' })
})

it('retains the first random topper for the session when storage cannot write', () => {
  const store = new MemoryStore()
  store.failedKeys.add('trackforge-player-topper-v1')
  let created = 0
  const repo = new BrowserPreferencesRepository(store, () => {
    created++
    return { icon: 'bolt', color: 'pink' }
  })
  expect(repo.load().playerIdentity).toEqual({ icon: 'bolt', color: 'pink' })
  expect(repo.load().playerIdentity).toEqual({ icon: 'bolt', color: 'pink' })
  expect(created).toBe(1)
})

it('persists the explicit race mode and rejects unknown stored modes', () => {
  const memory = new MemoryStore()
  const preferences = new BrowserPreferencesRepository(memory)
  expect(preferences.load().raceMode).toBe('normal')
  preferences.save({ ...preferences.load(), raceMode: 'ghost' })
  expect(preferences.load().raceMode).toBe('ghost')
  preferences.save({ ...preferences.load(), raceMode: 'boost-practice' })
  expect(preferences.load().raceMode).toBe('boost-practice')
  // Legacy corruption checks explicitly bypass the authoritative modern snapshot.
  memory.values.delete('trackforge-preferences-snapshot-v1')
  memory.values.set('trackforge-race-mode', 'invalid')
  expect(preferences.load().raceMode).toBe('normal')
})

it('keeps existing muted installs quiet and saves the two volumes independently', () => {
  const memory = new MemoryStore()
  memory.values.set('trackforge-audio-enabled', '0')
  const repository = new BrowserPreferencesRepository(memory)

  expect(repository.load()).toMatchObject({ musicVolume: 0, soundEffectsVolume: 0 })
  expect(repository.save({ ...repository.load(), musicVolume: 65, soundEffectsVolume: 0 })).toBe(true)
  expect(new BrowserPreferencesRepository(memory).load()).toMatchObject({
    audioEnabled: false,
    musicVolume: 65,
    soundEffectsVolume: 0,
  })
})

it('round-trips a validated display name and stable creator ID', () => {
  const store = new MemoryStore()
  const preferences = new BrowserPreferencesRepository(store)
  const profile = { ...preferences.load(), displayName: "  Émile  QC  ", creatorId: 'local-creator-123' }
  expect(preferences.save(profile)).toBe(true)
  expect(new BrowserPreferencesRepository(store).load()).toMatchObject({
    displayName: 'Émile QC', creatorId: 'local-creator-123',
  })
  // Legacy corruption checks explicitly bypass the authoritative modern snapshot.
  store.values.delete('trackforge-preferences-snapshot-v1')
  store.values.set('trackforge-player-name-v1', '<script>')
  expect(preferences.load().displayName).toBeUndefined()
  store.values.set('trackforge-creator-id-v1', 'bad')
  expect(preferences.load().creatorId).toBeUndefined()
})

describe('BrowserTrackRepository', () => {
  it('rejects writing over an imported original and rolls back an entire colliding batch', () => {
    const storage = new MemoryStore()
    const repository = new BrowserTrackRepository(storage)
    const original = { ...createStarterTrack(asTrackId('shared-original'), 10), origin: 'imported' as const }
    const other = createStarterTrack(asTrackId('personal'), 20)
    expect(repository.save(original)).toBe(true)
    expect(repository.save(other)).toBe(true)
    const reloaded = new BrowserTrackRepository(storage)
    const before = reloaded.find(original.id)
    const overwrite = { ...original, origin: 'local' as const, name: 'Replacement' }
    expect(reloaded.save(overwrite)).toBe(false)
    expect(reloaded.saveMany([{ ...other, name: 'Batch rename' }, overwrite])).toBe(false)
    expect(reloaded.find(original.id)).toEqual(before)
    expect(reloaded.find(other.id)?.name).toBe(other.name)
  })

  it('saves attribution updates in one batch, validates imported metadata and leaves geometry unchanged', () => {
    const storage = new MemoryStore()
    const repository = new BrowserTrackRepository(storage)
    const first = createStarterTrack(asTrackId('one'), 12)
    const second = createStarterTrack(asTrackId('two'), 15)
    repository.save(first)
    repository.save(second)
    const creator = { id: 'local-creator-123', name: 'Julien QC' }
    expect(repository.saveMany([{ ...first, creator }])).toBe(true)
    expect(repository.list()).toHaveLength(2)
    expect(repository.find(first.id)).toMatchObject({ creator, createdAt: 12, updatedAt: 12 })
    expect(repository.find(second.id)?.creator).toBeUndefined()
    expect(repository.saveMany([{ ...first, creator: { id: '', name: 'Invalid' } }])).toBe(true)
    expect(repository.find(first.id)?.creator).toBeUndefined()
    storage.failedKeys.add('trackforge-library-v2')
    expect(repository.saveMany([{ ...first, creator }])).toBe(false)
    expect(repository.find(first.id)?.creator).toBeUndefined()
  })

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

  it('reuses decoded library data until storage changes across tabs', () => {
    const storage = new MemoryStore()
    const track = createStarterTrack(asTrackId('cached'), 10)
    storage.values.set('trackforge-library-v2', JSON.stringify([track]))
    storage.values.set('trackforge-library-v1-migrated', '1')
    const repository = new BrowserTrackRepository(storage)

    const firstRead = repository.list()
    const secondRead = repository.list()
    expect(secondRead).not.toBe(firstRead)
    const exposedTrack = firstRead[0]
    const exposedPoint = exposedTrack?.points[0]
    if (exposedTrack && exposedPoint) {
      Object.assign(exposedTrack, { name: 'Mutated outside repository' })
      Object.assign(exposedPoint, { x: -1000 })
    }
    const stored = repository.find(track.id)
    expect(stored?.name).toBe(track.name)
    expect(stored?.points[0]?.x).toBe(track.points[0]?.x)

    const externalTrack = createStarterTrack(asTrackId('other-tab'), 20)
    storage.values.set(
      'trackforge-library-v2',
      JSON.stringify([track, externalTrack]),
    )
    const updatedRead = repository.list()
    expect(updatedRead).not.toBe(secondRead)
    expect(updatedRead.map(({ id }) => id)).toEqual(['cached', 'other-tab'])
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

    expect(repository.list()).toHaveLength(0)
    expect(storage.values.has('trackforge-library-v1-migrated')).toBe(false)
    // Preserve the legacy source for a later successful attempt, rather than
    // showing an in-memory circuit as a durable recovered library track.
    storage.failedKeys.clear()
    expect(repository.list()).toHaveLength(1)
    expect(repository.list()[0]?.id).toBe('recovered')
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
          category: { course: 'course', laps, mode: 'normal' } })
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
    // Legacy corruption checks explicitly bypass the authoritative modern snapshot.
    storage.values.delete('trackforge-preferences-snapshot-v1')
    storage.values.set('trackforge-race-laps', '999')
    expect(preferences.load().raceLaps).toBe(2)
    expect(preferences.save({ ...preferences.load(), raceLaps: 3 })).toBe(true)
    expect(preferences.load().raceLaps).toBe(3)
  })

  it('defaults legacy and malformed steering sensitivity and persists each option', () => {
    const storage = new MemoryStore()
    const preferences = new BrowserPreferencesRepository(storage)
    expect(preferences.load()).toMatchObject({ steeringLayout: 'drag', steeringHand: 'left', controlSize: 'standard' })
    expect(preferences.save({ ...preferences.load(), steeringLayout: 'buttons', steeringHand: 'right', controlSize: 'large' })).toBe(true)
    expect(new BrowserPreferencesRepository(storage).load()).toMatchObject({ steeringLayout: 'buttons', steeringHand: 'right', controlSize: 'large' })
    expect(preferences.load().steeringSensitivity).toBe(1)
    for (const steeringSensitivity of [0.75, 1.5, 1] as const) {
      expect(preferences.save({ ...preferences.load(), steeringSensitivity })).toBe(true)
      expect(new BrowserPreferencesRepository(storage).load().steeringSensitivity).toBe(steeringSensitivity)
    }
    // Legacy corruption checks explicitly bypass the authoritative modern snapshot.
    storage.values.delete('trackforge-preferences-snapshot-v1')
    storage.values.set('trackforge-steering-sensitivity', '2')
    expect(preferences.load().steeringSensitivity).toBe(1)
  })

  it('falls back for invalid preferences and persists valid changes', () => {
    const storage = new MemoryStore()
    storage.values.set('trackforge-last-car', 'purple')
    const preferences = new BrowserPreferencesRepository(storage, () => ({ icon: 'star', color: 'cyan' }))

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

it('restores legacy and themed scenery with bounded malformed data', () => {
  const storage = new MemoryStore()
  const repository = new BrowserTrackRepository(storage)
  const track = createStarterTrack(asTrackId('appearance'), 10)
  storage.values.set('trackforge-library-v2', JSON.stringify([{ ...track, environmentId: undefined, scenery: undefined }]))
  expect(repository.find(track.id)).toMatchObject({ environmentId: 'grass', scenery: [] })
  const scenery = [{ kind: 'city-house' as const, x: 13, y: -25 }, { kind: 'desert-cactus' as const, x: -2, y: 5 }]
  expect(repository.save({ ...track, environmentId: 'cityscape', scenery, raceRevision: 3 })).toBe(true)
  expect(repository.find(track.id)).toMatchObject({ environmentId: 'cityscape', scenery, raceRevision: 3 })
})

it('bounds local scenery decoding and drops invalid positions, kinds, and revisions', () => {
  const storage = new MemoryStore()
  const track = createStarterTrack(asTrackId('malformed-scenery'), 10)
  const valid = { kind: 'desert-boulder', x: 10_000_000, y: -10_000_000 }
  storage.values.set('trackforge-library-v2', JSON.stringify([{ ...track,
    environmentId: 'unknown', raceRevision: -1,
    scenery: [{ kind: 'invalid', x: 0, y: 0 }, { ...valid, x: 10_000_001 }, ...Array.from({ length: 255 }, () => valid)],
  }]))
  const loaded = new BrowserTrackRepository(storage).find(track.id)!
  expect(loaded.environmentId).toBe('grass')
  expect(loaded.scenery).toHaveLength(254)
  expect(loaded.scenery?.[0]).toEqual(valid)
  expect(loaded.raceRevision).toBeUndefined()
})

it('round-trips route topology and defaults legacy tracks to circuits', () => {
  const storage = new MemoryStore()
  const repository = new BrowserTrackRepository(storage)
  const track = createStarterTrack(asTrackId('route-kind'), 10)
  expect(repository.save({ ...track, routeKind: 'point-to-point' })).toBe(true)
  expect(new BrowserTrackRepository(storage).find(track.id)?.routeKind).toBe('point-to-point')
  expect(repository.save(track)).toBe(true)
  expect(repository.find(track.id)?.routeKind).toBe('circuit')
})

it('stores favorite track ids locally and rejects malformed preference data', () => {
  const memory = new MemoryStore()
  const repo = new BrowserPreferencesRepository(memory)
  expect(repo.load().favoriteTrackIds).toEqual([])
  expect(repo.save({ ...repo.load(), favoriteTrackIds: ['track-a', 'track-b'] })).toBe(true)
  expect(new BrowserPreferencesRepository(memory).load().favoriteTrackIds).toEqual(['track-a', 'track-b'])
  // Legacy corruption checks explicitly bypass the authoritative modern snapshot.
  memory.values.delete('trackforge-preferences-snapshot-v1')
  memory.values.set('trackforge-favorite-tracks-v1', '{broken')
  expect(repo.load().favoriteTrackIds).toEqual([])
  memory.values.set('trackforge-favorite-tracks-v1', JSON.stringify(['good', 'good', '', 42, 'x'.repeat(129)]))
  expect(repo.load().favoriteTrackIds).toEqual(['good'])
})
