import type {
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import {
  normalizeTrackName,
  type TrackNameResult,
} from '@/application/library/trackName'
import type { Track, TrackId } from '@/domain/model'
import type { TrackCreator } from '@/domain/track/trackCreator'
import { DEFAULT_TRACK_ENVIRONMENT_ID } from '@/domain/track/trackEnvironment'
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

  create(value: string, creator?: TrackCreator): TrackMutationResult {
    const validated = this.validateName(value)
    if (!validated.ok) return validated
    const now = this.dependencies.now()
    const track: Track = {
      id: this.dependencies.createId(),
      name: validated.name,
      ...(creator ? { creator } : {}),
      version: 8,
      points: [],
      trees: [],
      terrain: EMPTY_TERRAIN,
      start: { ratio: 0, reversed: false },
      lighting: 'day',
      environmentId: DEFAULT_TRACK_ENVIRONMENT_ID,
      scenery: [],
      raceRevision: now,
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
      ...source, id: this.dependencies.createId(), name, origin: 'imported',
      createdAt: now, updatedAt: now, raceRevision: now,
    }
    return this.dependencies.trackStore.save(track)
      ? { ok: true, track }
      : { ok: false, message: 'Shared track could not be saved.' }
  }

  /**
   * Rename only tracks created by this installation. Uncredited pre-profile
   * tracks are adopted on first selection; explicitly imported tracks aren't.
   * No geometry or race revision is changed.
   */
  recredit(creator: TrackCreator): { readonly ok: boolean; readonly count: number } {
    const updated = this.dependencies.trackStore.list()
      .filter((track) => track.creator?.id === creator.id ||
        (!track.creator && track.origin !== 'imported'))
      .filter((track) => track.creator?.name !== creator.name || !track.creator)
      .map((track) => ({ ...track, creator }))
    if (updated.length === 0) return { ok: true, count: 0 }
    if (this.dependencies.trackStore.saveMany) {
      return { ok: this.dependencies.trackStore.saveMany(updated), count: updated.length }
    }
    for (const track of updated) {
      if (!this.dependencies.trackStore.save(track)) return { ok: false, count: 0 }
    }
    return { ok: true, count: updated.length }
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
      raceRevision: existing.raceRevision ?? existing.updatedAt,
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
