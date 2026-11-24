import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from '@/application/ports/storage'
import { courseIdentity } from '@/application/race/raceRecords'
import { asTrackId, type Track } from '@/domain/model'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { SYSTEM_STARTER_TRACK_ID, TRACK_FORGE_CREATOR, isSeededTrack } from '@/domain/track/trackCreator'
import { BrowserPreferencesRepository } from '@/infrastructure/storage/preferencesRepository'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import { migrateTrackCreatorCredits } from '@/migrations/migration_track_creator_v1'

class Storage implements KeyValueStore {
  readonly data = new Map<string, string>()
  readonly blocked = new Set<string>()
  get(key: string) { return this.data.get(key) ?? null }
  set(key: string, value: string) {
    if (this.blocked.has(key)) return false
    this.data.set(key, value)
    return true
  }
  remove(key: string) { return this.data.delete(key) }
}

function setup() {
  const storage = new Storage()
  const tracks = new BrowserTrackRepository(storage, { now: () => 999 })
  const preferences = new BrowserPreferencesRepository(storage)
  const migrate = () => migrateTrackCreatorCredits(storage, tracks, preferences, () => 'local-player-id-123')
  return { storage, tracks, preferences, migrate }
}

describe('one-time track creator release migration', () => {
  it('claims every uncredited player track but preserves fixed system attribution and racing identity', () => {
    const { storage, tracks, preferences, migrate } = setup()
    // Old bundled starters predate authored checkpoint serialization.
    const { recoveryCheckpoints: _markers, autoCheckpoints: _auto, ...builtIn } =
      createStarterTrack(asTrackId('starter-old-generated-id'), 12)
    void _markers
    void _auto
    const userTrack: Track = {
      ...createStarterTrack(asTrackId('custom-rally'), 34),
      name: 'Rally',
      raceRevision: 12345,
    }
    const oldImported: Track = {
      ...createStarterTrack(asTrackId('old-import'), 44),
      name: 'Previously Imported',
      origin: 'imported',
    }
    const editedStarter: Track = {
      ...createStarterTrack(asTrackId('starter-edited-id'), 55),
      name: 'Custom Starter',
      points: [{ x: 11, y: 11, surface: 'street' }, { x: 72, y: 11, surface: 'street' }],
    }
    const official = OFFICIAL_CIRCUITS[0]?.track
    expect(official).toBeDefined()
    for (const track of [builtIn, userTrack, oldImported, editedStarter, official].filter((t): t is Track => !!t)) {
      expect(tracks.save(track)).toBe(true)
    }
    const beforeCourse = courseIdentity(userTrack)
    expect(migrate()).toEqual({ ok: true, changed: 4 })
    expect(storage.get('trackforge-creator-migration-v1')).toBe('1')

    const seeded = tracks.find(builtIn.id)
    expect(seeded).toMatchObject({ id: builtIn.id, origin: 'seeded', creator: TRACK_FORGE_CREATOR })
    expect(isSeededTrack(seeded!)).toBe(true)
    expect(tracks.find(official!.id)).toMatchObject({ creator: TRACK_FORGE_CREATOR, origin: 'seeded' })
    for (const track of [userTrack, oldImported, editedStarter]) {
      expect(tracks.find(track.id)?.creator).toEqual({ id: 'local-player-id-123', name: 'Player' })
      expect(tracks.find(track.id)?.origin).toBe('local')
      expect(isSeededTrack(tracks.find(track.id)!)).toBe(false)
    }
    expect(courseIdentity(tracks.find(userTrack.id)!)).toBe(beforeCourse)
    expect(tracks.find(userTrack.id)?.raceRevision).toBe(12345)
    expect(tracks.find(userTrack.id)?.updatedAt).toBe(34)
    expect(preferences.load().creatorId).toBe('local-player-id-123')
    expect(preferences.load().displayName).toBeUndefined()

    // Idempotent on subsequent launches, including new uncredited imports.
    const lateTrack = createStarterTrack(asTrackId('uncredited-after-migration'), 50)
    expect(tracks.save(lateTrack)).toBe(true)
    expect(migrate()).toEqual({ ok: true, changed: 0 })
    expect(tracks.find(lateTrack.id)?.creator).toBeUndefined()
  })

  it('does not rewrite already credited personal or imported tracks', () => {
    const { tracks, migrate } = setup()
    const anotherCreator = { id: 'different-player-id', name: 'Other Player' }
    const credited = { ...createStarterTrack(asTrackId('imported-credit'), 13),
      origin: 'imported' as const, creator: anotherCreator }
    expect(tracks.save(credited)).toBe(true)
    expect(migrate()).toEqual({ ok: true, changed: 0 })
    expect(tracks.find(credited.id)?.creator).toEqual(anotherCreator)
    expect(tracks.find(credited.id)?.origin).toBe('imported')
  })

  it('does not mark migration complete when the batch write fails and retries on next launch', () => {
    const { storage, tracks, migrate } = setup()
    const old = createStarterTrack(asTrackId('user-legacy'), 17)
    expect(tracks.save(old)).toBe(true)
    storage.blocked.add('trackforge-library-v2')
    expect(migrate()).toEqual({ ok: false, changed: 0 })
    expect(storage.get('trackforge-creator-migration-v1')).toBeNull()
    expect(tracks.find(old.id)?.creator).toBeUndefined()
    storage.blocked.delete('trackforge-library-v2')
    expect(migrate()).toEqual({ ok: true, changed: 1 })
    expect(tracks.find(old.id)?.creator?.id).toBe('local-player-id-123')
  })

  it('uses an identical hard-coded system identity and starter ID across installations', () => {
    expect(SYSTEM_STARTER_TRACK_ID).toBe('system-starter-circuit')
    expect(TRACK_FORGE_CREATOR).toEqual({ id: 'trackforge-system', name: 'Track Forge' })
    expect(isSeededTrack(createStarterTrack(asTrackId(SYSTEM_STARTER_TRACK_ID), 0))).toBe(true)
  })
})
