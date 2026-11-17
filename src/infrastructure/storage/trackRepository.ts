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

  constructor(
    private readonly storage: KeyValueStore,
    dependencies: Partial<RepositoryDependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  list(): readonly Track[] {
    const current = this.decodeLibrary(
      parse(this.storage.get(STORAGE_KEYS.tracks)),
    )
    if (this.storage.get(STORAGE_KEYS.trackMigration) === '1') {
      return current
    }

    const legacy = this.decodeLibrary(
      parse(this.storage.get(STORAGE_KEYS.legacyTracks)),
    )
    if (current.length > 0 || legacy.length > 0) {
      const merged = this.mergeLibraries(legacy, current)
      if (
        this.storage.set(STORAGE_KEYS.tracks, JSON.stringify(merged))
      ) {
        this.storage.set(STORAGE_KEYS.trackMigration, '1')
      }
      return merged
    }
    return this.recoverLegacy()
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
    return this.storage.set(STORAGE_KEYS.tracks, JSON.stringify(tracks))
  }

  remove(id: TrackId): boolean {
    return this.storage.set(
      STORAGE_KEYS.tracks,
      JSON.stringify(this.list().filter((track) => track.id !== id)),
    )
  }

  private decodeLibrary(value: unknown): readonly Track[] {
    if (!Array.isArray(value)) return []
    const now = this.dependencies.now()
    return value
      .map((track) => decodeTrack(track, now))
      .filter((track) => track !== undefined)
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
        if (
          this.storage.set(
            STORAGE_KEYS.tracks,
            JSON.stringify([track]),
          )
        ) {
          this.storage.set(STORAGE_KEYS.trackMigration, '1')
        }
        return [track]
      }
    }
    return []
  }
}
