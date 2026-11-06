import type {
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import {
  normalizeTrackName,
  type TrackNameResult,
} from '@/application/library/trackName'
import type { Track, TrackId } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

export type TrackMutationResult =
  | { readonly ok: true; readonly track: Track }
  | { readonly ok: false; readonly message: string }

export interface TrackLibraryDependencies {
  readonly trackStore: TrackStore
  readonly scoreStore: ScoreStore
  readonly createId: () => TrackId
  readonly now: () => number
}

export class TrackLibraryService {
  constructor(private readonly dependencies: TrackLibraryDependencies) {}

  list(): readonly Track[] {
    return [...this.dependencies.trackStore.list()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )
  }

  select(id: TrackId): Track | undefined {
    return this.dependencies.trackStore.find(id)
  }

  create(value: string): TrackMutationResult {
    const validated = this.validateName(value)
    if (!validated.ok) return validated
    const now = this.dependencies.now()
    const track: Track = {
      id: this.dependencies.createId(),
      name: validated.name,
      version: 8,
      points: [],
      trees: [],
      terrain: EMPTY_TERRAIN,
      start: { ratio: 0, reversed: false },
      lighting: 'day',
      createdAt: now,
      updatedAt: now,
    }
    return this.dependencies.trackStore.save(track)
      ? { ok: true, track }
      : { ok: false, message: 'Track could not be saved.' }
  }

  importShared(source: Track): TrackMutationResult {
    // A shared track is always a copy. Never overwrite the sender's or
    // receiver's existing circuit, scores or best-time ghosts.
    const now = this.dependencies.now()
    let name = source.name.slice(0, 32)
    let number = 2
    while (this.dependencies.trackStore.list().some(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    )) {
      const suffix = ` (${number++})`
      name = source.name.slice(0, 32 - suffix.length) + suffix
    }
    const track: Track = {
      ...source, id: this.dependencies.createId(), name,
      createdAt: now, updatedAt: now,
    }
    return this.dependencies.trackStore.save(track)
      ? { ok: true, track }
      : { ok: false, message: 'Shared track could not be saved.' }
  }

  rename(id: TrackId, value: string): TrackMutationResult {
    const existing = this.dependencies.trackStore.find(id)
    if (!existing) {
      return { ok: false, message: 'Track unavailable.' }
    }
    const validated = this.validateName(value, id)
    if (!validated.ok) return validated
    if (validated.name === existing.name) {
      return { ok: true, track: existing }
    }
    const track = {
      ...existing,
      name: validated.name,
      updatedAt: this.dependencies.now(),
    }
    return this.dependencies.trackStore.save(track)
      ? { ok: true, track }
      : { ok: false, message: 'Track could not be saved.' }
  }

  delete(id: TrackId): boolean {
    if (!this.dependencies.trackStore.remove(id)) return false
    this.dependencies.scoreStore.removeTrack(id)
    return true
  }

  private validateName(
    value: string,
    currentId?: TrackId,
  ): TrackNameResult {
    const normalized = normalizeTrackName(value)
    if (!normalized.ok) return normalized
    const duplicate = this.dependencies.trackStore
      .list()
      .some(
        (track) =>
          track.id !== currentId &&
          track.name.toLowerCase() === normalized.name.toLowerCase(),
      )
    return duplicate
      ? {
          ok: false,
          message: 'That track name is already in use.',
        }
      : normalized
  }
}
