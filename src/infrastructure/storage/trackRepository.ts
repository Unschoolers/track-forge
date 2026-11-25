import type { KeyValueStore, TrackStore } from '@/application/ports/storage'
import { asTrackId, type Track, type TrackId } from '@/domain/model'
import { decodeTrack } from '@/domain/track/trackCodec'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

interface RepositoryDependencies {
  readonly createId: () => TrackId
  readonly now: () => number
}

const defaults: RepositoryDependencies = {
  createId: () =>
    asTrackId(
      `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ),
  now: () => Date.now(),
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function parse(value: string | null): unknown {
  if (value === null) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

export class BrowserTrackRepository implements TrackStore {
  private readonly dependencies: RepositoryDependencies
  private cachedRawLibrary: string | null | undefined
  private cachedLibrary: readonly Track[] = []

  constructor(
    private readonly storage: KeyValueStore,
    dependencies: Partial<RepositoryDependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  list(): readonly Track[] {
    const rawLibrary = this.storage.get(STORAGE_KEYS.tracks)
    const migrationComplete =
      this.storage.get(STORAGE_KEYS.trackMigration) === '1'
    if (
      migrationComplete &&
      this.cachedRawLibrary !== undefined &&
      rawLibrary === this.cachedRawLibrary
    ) {
      return this.readCachedLibrary()
    }

    const current = this.decodeLibrary(parse(rawLibrary))
    if (migrationComplete) {
      this.cacheLibrary(rawLibrary, current)
      return this.copyTracks(current)
    }

    const legacy = this.decodeLibrary(
      parse(this.storage.get(STORAGE_KEYS.legacyTracks)),
    )
    if (current.length > 0 || legacy.length > 0) {
      const merged = this.mergeLibraries(legacy, current)
      const serialized = JSON.stringify(merged)
      if (this.storage.set(STORAGE_KEYS.tracks, serialized)) {
        this.storage.set(STORAGE_KEYS.trackMigration, '1')
        this.cacheLibrary(serialized, merged)
      }
      return this.copyTracks(merged)
    }
    return this.copyTracks(this.recoverLegacy())
  }

  find(id: TrackId): Track | undefined {
    return this.list().find((track) => track.id === id)
  }

  save(track: Track): boolean {
    const tracks = [...this.list()]
    const normalized = decodeTrack(track, this.dependencies.now())
    if (!normalized) return false
    const index = tracks.findIndex((item) => item.id === normalized.id)
    if (index >= 0) tracks[index] = normalized
    else tracks.push(normalized)
    const serialized = JSON.stringify(tracks)
    if (!this.storage.set(STORAGE_KEYS.tracks, serialized)) return false
    this.cacheLibrary(serialized, tracks)
    return true
  }

  saveMany(updated: readonly Track[]): boolean {
    const now = this.dependencies.now()
    const decoded = updated.map((track) => decodeTrack(track, now))
    if (decoded.some((track) => !track)) return false
    const tracks = new Map(this.list().map((track) => [track.id, track]))
    for (const track of decoded) {
      if (track) tracks.set(track.id, track)
    }
    const savedTracks = [...tracks.values()]
    const serialized = JSON.stringify(savedTracks)
    if (!this.storage.set(STORAGE_KEYS.tracks, serialized)) return false
    this.cacheLibrary(serialized, savedTracks)
    return true
  }

  remove(id: TrackId): boolean {
    const tracks = this.list().filter((track) => track.id !== id)
    const serialized = JSON.stringify(tracks)
    if (!this.storage.set(STORAGE_KEYS.tracks, serialized)) return false
    this.cacheLibrary(serialized, tracks)
    return true
  }

  private decodeLibrary(value: unknown): readonly Track[] {
    if (!Array.isArray(value)) return []
    const now = this.dependencies.now()
    return value
      .map((track) => decodeTrack(track, now))
      .filter((track) => track !== undefined)
  }

  private cacheLibrary(rawLibrary: string | null, tracks: readonly Track[]): void {
    this.cachedRawLibrary = rawLibrary
    this.cachedLibrary = tracks
  }

  private readCachedLibrary(): readonly Track[] {
    return this.copyTracks(this.cachedLibrary)
  }

  private copyTracks(tracks: readonly Track[]): readonly Track[] {
    return tracks.map((track) => ({
      ...track,
      ...(track.creator ? { creator: { ...track.creator } } : {}),
      points: track.points.map((point) => ({ ...point })),
      trees: track.trees.map((tree) => ({ ...tree })),
      terrain: {
        ...track.terrain,
        cells: track.terrain.cells.map((cell) => ({ ...cell })),
      },
      ...(track.start ? { start: { ...track.start } } : {}),
      ...(track.recoveryCheckpoints
        ? { recoveryCheckpoints: [...track.recoveryCheckpoints] }
        : {}),
      ...(track.scenery
        ? { scenery: track.scenery.map((prop) => ({ ...prop })) }
        : {}),
    }))
  }

  private mergeLibraries(
    legacy: readonly Track[],
    current: readonly Track[],
  ): readonly Track[] {
    const tracks = new Map<TrackId, Track>()
    for (const track of [...legacy, ...current]) {
      const existing = tracks.get(track.id)
      if (!existing || track.updatedAt >= existing.updatedAt) {
        tracks.set(track.id, track)
      }
    }
    return [...tracks.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )
  }

  private recoverLegacy(): readonly Track[] {
    for (const key of STORAGE_KEYS.legacyAutosaves) {
      const raw = object(parse(this.storage.get(key)))
      if (!raw || !Array.isArray(raw.points)) continue
      const now = this.dependencies.now()
      const track = decodeTrack(
        {
          ...raw,
          id: this.dependencies.createId(),
          name: 'Recovered Track',
          createdAt: now,
          updatedAt: now,
        },
        now,
      )
      if (track) {
        const serialized = JSON.stringify([track])
        if (!this.storage.set(STORAGE_KEYS.tracks, serialized)) {
          // The legacy autosave remains intact. Do not advertise an ephemeral
          // recovered track as saved when storage has denied the write.
          return []
        }
        this.storage.set(STORAGE_KEYS.trackMigration, '1')
        this.cacheLibrary(serialized, [track])
        return [track]
      }
    }
    return []
  }
}
