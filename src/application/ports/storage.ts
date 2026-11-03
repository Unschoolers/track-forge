import type {
  CarId,
  DifficultyId,
  LightingMode,
  Track,
  TrackId,
} from '@/domain/model'

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): boolean
}

export interface TrackStore {
  list(): readonly Track[]
  find(id: TrackId): Track | undefined
  save(track: Track): boolean
  remove(id: TrackId): boolean
}

export interface ScoreEntry {
  readonly time: number
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly recordedAt: number
}

export interface ScoreStore {
  forTrack(trackId: TrackId): readonly ScoreEntry[]
  record(trackId: TrackId, score: ScoreEntry): boolean
  removeTrack(trackId: TrackId): boolean
}

export interface Preferences {
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly lighting: LightingMode
  readonly audioEnabled: boolean
  readonly hapticsEnabled: boolean
  readonly dynamicZoomEnabled: boolean
}

export interface PreferencesStore {
  load(): Preferences
  save(preferences: Preferences): boolean
}
