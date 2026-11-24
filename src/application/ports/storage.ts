import type {
  CarId,
  DifficultyId,
  Track,
  TrackId,
  RouteKind,
} from '@/domain/model'
import type { CupProgress } from '@/application/race/circuitCup'
import type { RaceSetup } from '@/application/race/raceSession'
import type { PlayerIdentity } from '@/application/multiplayer/playerIdentity'

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): boolean
}

export interface TrackStore {
  list(): readonly Track[]
  find(id: TrackId): Track | undefined
  save(track: Track): boolean
  /** Optional optimized atomic batch for attribution changes. */
  saveMany?(tracks: readonly Track[]): boolean
  remove(id: TrackId): boolean
}

export interface ScoreCategory {
  readonly course: string
  readonly laps: number
  readonly mode: 'normal' | 'ghost' | 'time-trial'
  readonly routeKind?: RouteKind
}

export interface ScoreEntry {
  /** Absent for historical scores whose race settings cannot be recovered. */
  readonly category?: ScoreCategory
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

export type PedalMode = 'auto' | 'manual'

export type SteeringSensitivity = 0.75 | 1 | 1.5

export interface Preferences {
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly audioEnabled: boolean
  readonly musicVolume?: number
  readonly soundEffectsVolume?: number
  readonly hapticsEnabled: boolean
  readonly dynamicZoomEnabled: boolean
  readonly steeringLayout?: 'drag' | 'buttons'
  readonly steeringHand?: 'left' | 'right'
  readonly controlSize?: 'standard' | 'large'
  readonly steeringSensitivity?: SteeringSensitivity
  readonly pedalMode?: PedalMode
  readonly raceLaps?: 1 | 2 | 3
  readonly raceMode?: 'normal' | 'ghost' | 'time-trial'
  readonly playerIdentity?: PlayerIdentity
  readonly displayName?: string
  readonly creatorId?: string
  /** Personal library ordering, never part of a shared track's geometry. */
  readonly favoriteTrackIds?: readonly string[]
}

export interface PreferencesStore {
  load(): Preferences
  save(preferences: Preferences): boolean
}

export interface LastRace {
  readonly trackId: TrackId
  readonly course: string
  readonly setup: RaceSetup
}

export interface LastRaceStore {
  load(): LastRace | null
  save(race: LastRace): boolean
}

export interface CupStore {
  load(): CupProgress
  save(progress: CupProgress): boolean
}
