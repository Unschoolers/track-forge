import { describe, expect, it, vi } from 'vitest'
import type {
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import { TrackLibraryService } from '@/application/library/trackLibraryService'
import { asTrackId, type Track, type TrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

class TrackMemory implements TrackStore {
  readonly tracks = new Map<TrackId, Track>()

  list = (): readonly Track[] => [...this.tracks.values()]
  find = (id: TrackId): Track | undefined => this.tracks.get(id)
  save = (track: Track): boolean => {
    this.tracks.set(track.id, track)
    return true
  }
  remove = (id: TrackId): boolean => this.tracks.delete(id)
}

function setup(initial: readonly Track[] = []) {
  const trackStore = new TrackMemory()
  for (const track of initial) trackStore.save(track)
  const scoreStore: ScoreStore = {
    forTrack: () => [],
    record: vi.fn(() => true),
    removeTrack: vi.fn(() => true),
  }
  const service = new TrackLibraryService({
    trackStore,
    scoreStore,
    createId: () => asTrackId('created'),
    now: () => 500,
  })
  return { service, trackStore, scoreStore }
}

describe('TrackLibraryService', () => {
  it('normalizes a unique name and creates an empty persisted track', () => {
    const { service, trackStore } = setup()

    expect(service.create('  Midnight   Harbor  ')).toEqual({
      ok: true,
      track: {
        id: 'created',
        name: 'Midnight Harbor',
        version: 8,
        points: [],
        trees: [],
        terrain: { cellSize: 32, cells: [] },
        start: { ratio: 0, reversed: false },
        lighting: 'day',
        environmentId: 'grass',
        scenery: [],
        raceRevision: 500,
        createdAt: 500,
        updatedAt: 500,
      },
    })
    expect(trackStore.find(asTrackId('created'))?.name).toBe(
      'Midnight Harbor',
    )
  })

  it('rejects empty and case-insensitively duplicated names', () => {
    const existing = createStarterTrack(asTrackId('starter'), 1)
    const { service } = setup([existing])

    expect(service.create('   ')).toEqual({
      ok: false,
      message: 'Enter a track name.',
    })
    expect(service.create('starter circuit')).toEqual({
      ok: false,
      message: 'That track name is already in use.',
    })
    expect(service.rename(existing.id, '  Starter   Circuit ')).toEqual({
      ok: true,
      track: existing,
    })
  })

  it('renames with a stable id and removes scores when deleting', () => {
    const first = createStarterTrack(asTrackId('first'), 1)
    const second = createStarterTrack(asTrackId('second'), 2)
    const { service, trackStore, scoreStore } = setup([first, second])

    expect(service.rename(first.id, 'Coastal Run')).toMatchObject({
      ok: true,
      track: {
        id: 'first',
        name: 'Coastal Run',
        createdAt: 1,
        updatedAt: 500,
      },
    })
    expect(service.delete(second.id)).toBe(true)
    expect(trackStore.find(second.id)).toBeUndefined()
    expect(scoreStore.removeTrack).toHaveBeenCalledWith(second.id)
  })
  it('attributes old local tracks, but preserves imported credits across renames and share copies', () => {
    const legacy = createStarterTrack(asTrackId('legacy-local'), 42)
    const imported = { ...createStarterTrack(asTrackId('imported'), 30), origin: 'imported' as const }
    const other = {
      ...createStarterTrack(asTrackId('other'), 20),
      creator: { id: 'different-user-id', name: 'Another Racer' },
      origin: 'imported' as const,
    }
    const { service, trackStore } = setup([{ ...legacy, creator: { id: 'local-user-123', name: 'Old Name' } }, imported, other])
    const creator = { id: 'local-user-123', name: 'First Name' }
    expect(service.recredit(creator)).toEqual({ ok: true, count: 1 })
    const first = trackStore.find(legacy.id)
    expect(first?.creator).toEqual(creator)
    expect(first?.updatedAt).toBe(42)
    expect(first?.raceRevision).toBe(legacy.raceRevision)
    expect(trackStore.find(imported.id)?.creator).toBeUndefined()
    expect(trackStore.find(other.id)?.creator?.name).toBe('Another Racer')
    expect(service.recredit({ ...creator, name: 'New Name' })).toEqual({ ok: true, count: 1 })
    expect(trackStore.find(legacy.id)?.creator?.name).toBe('New Name')
    expect(service.recredit({ ...creator, name: 'New Name' })).toEqual({ ok: true, count: 0 })
    const shared = service.importShared(other)
    expect(shared.ok).toBe(true)
    if (shared.ok) {
      expect(shared.track.creator).toEqual(other.creator)
      expect(shared.track.origin).toBe('imported')
    }
  })

  it('credits new tracks immediately when a profile exists', () => {
    const { service } = setup()
    const creator = { id: 'local-user-123', name: 'Julien QC' }
    const result = service.create('Morning Rally', creator)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.track.creator).toEqual(creator)
  })
})
