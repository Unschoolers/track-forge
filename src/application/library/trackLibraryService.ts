import type {
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import {
  normalizeTrackName,
  type TrackNameResult,
} from '@/application/library/trackName'
import type { Track, TrackId } from '@/domain/model'
import { isSeededTrack, type TrackCreator } from '@/domain/track/trackCreator'
import { allocateUniqueTrackName } from '@/application/library/uniqueTrackName'
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
      autoCheckpoints: true,
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
    const name = allocateUniqueTrackName(
      source.name,
      this.dependencies.trackStore.list().map(track => track.name),
    )
    const track: Track = {
      ...source, id: this.dependencies.createId(), name, origin: 'imported',
      createdAt: now, updatedAt: now, raceRevision: now,
    }
    return this.dependencies.trackStore.save(track)
      ? { ok: true, track }
      : { ok: false, message: 'Shared track could not be saved.' }
  }

  /** Save a draft as a new track without changing its original or its records. */
  saveAs(source: Track, value: string, creator?: TrackCreator): TrackMutationResult {
    const validated = this.validateName(value)
    if (!validated.ok) return validated
    const now = this.dependencies.now()
    const copy: Track = {
      ...source,
      id: this.dependencies.createId(),
      name: validated.name,
      origin: 'local',
      ...(creator ? { creator } : {}),
      createdAt: now,
      updatedAt: now,
      raceRevision: now,
    }
    return this.dependencies.trackStore.save(copy)
      ? { ok: true, track: copy }
      : { ok: false, message: 'Track copy could not be saved.' }
  }

  /** Update only tracks with this installation's stable creator ID. */
  recredit(creator: TrackCreator): { readonly ok: boolean; readonly count: number } {
    const updated = this.dependencies.trackStore.list()
      .filter((track) => !isSeededTrack(track) && track.creator?.id === creator.id)
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

  /** Fork built-in geometry to a new personal, shareable track before editing. */
  forkSeededForEdit(source: Track, creator?: TrackCreator): TrackMutationResult {
    if (!isSeededTrack(source)) return { ok: false, message: 'Not a built-in track.' }
    const now = this.dependencies.now()
    const name = allocateUniqueTrackName(
      source.name,
      this.dependencies.trackStore.list().map(track => track.name),
    )
    // Omit the seeded creator instead of accidentally inheriting system credit.
    const { creator: systemCreator, ...sourceWithoutCreator } = source
    void systemCreator
    const copy: Track = {
      ...sourceWithoutCreator,
      id: this.dependencies.createId(),
      name,
      origin: 'local',
      ...(creator ? { creator } : {}),
      createdAt: now,
      updatedAt: now,
      raceRevision: now,
    }
    return this.dependencies.trackStore.save(copy)
      ? { ok: true, track: copy }
      : { ok: false, message: 'Could not copy the built-in track.' }
  }

  /** Validate a rename without persisting an editor draft. */
  renameDraft(source: Track, value: string): TrackMutationResult {
    const validated = this.validateName(value, source.id)
    return validated.ok
      ? { ok: true, track: { ...source, name: validated.name } }
      : validated
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
