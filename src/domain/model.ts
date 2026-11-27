import type { SceneryTransform } from '@/domain/track/sceneryTransform'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { TrackCreator } from '@/domain/track/trackCreator'

export const SURFACE_IDS = ['street', 'dirt', 'ice'] as const
export const CAR_IDS = ['blue', 'red', 'green', 'yellow'] as const
export const DIFFICULTY_IDS = ['easy', 'normal', 'hard'] as const
export const LIGHTING_MODES = ['day', 'night'] as const
export const TERRAIN_KINDS = ['hill', 'water'] as const

export type SurfaceId = (typeof SURFACE_IDS)[number]
export type CarId = (typeof CAR_IDS)[number]
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]
export type LightingMode = (typeof LIGHTING_MODES)[number]
export type TerrainKind = (typeof TERRAIN_KINDS)[number]
export type TerrainBrushKind = TerrainKind | 'ground'
export type RoadStructure = 'surface' | 'overpass'
export type CurveMode = 'smooth' | 'corner'
export type RouteKind = 'circuit' | 'point-to-point'

export function normalizeRouteKind(value: unknown): RouteKind {
  return value === 'point-to-point' ? 'point-to-point' : 'circuit'
}

export type TrackId = string & { readonly __trackId: unique symbol }

export interface Vector2 {
  readonly x: number
  readonly y: number
}

export interface TrackPoint extends Vector2 {
  readonly surface: SurfaceId
  /**
   * Stable authoring metadata is optional on in-memory legacy inputs. The
   * repository upgrades it before exposing persisted tracks.
   */
  readonly id?: string
  readonly curve?: CurveMode
  readonly tension?: number
  /** Structure of the authored road section leading to the next point. */
  readonly structure?: RoadStructure
}

export interface Tree extends Vector2, SceneryTransform {}

export interface TerrainCell {
  readonly column: number
  readonly row: number
  readonly kind: TerrainKind
}

export interface TerrainMap {
  readonly cellSize: number
  readonly cells: readonly TerrainCell[]
}

export interface TrackStart {
  /** Normalized distance around the closed center path. */
  readonly ratio: number
  readonly reversed: boolean
}

/** A bounded replay attached to an explicitly shared creator time challenge. */
export interface CreatorGhostChallenge {
  readonly car: CarId
  readonly laps: 1 | 2 | 3
  readonly time: number
  readonly frames: readonly {
    readonly t: number
    readonly x: number
    readonly y: number
    readonly angle: number
    readonly z: number
    readonly structureRunId: string | null
    readonly cut?: boolean
  }[]
  readonly splits?: readonly number[]
}

export interface Track {
  readonly id: TrackId
  readonly name: string
  /** Creator credit is independent of the editable track name and racing identity. */
  readonly creator?: TrackCreator
  /** Explicit provenance; old saved tracks may be unclassified until first startup migration. */
  readonly origin?: 'imported' | 'seeded' | 'local'
  /** Verified original file retained for forwarding an imported track. */
  readonly signedSource?: string
  /** Independently signed reply for the canonical source, never a nested wrapper. */
  readonly signedChallengeSource?: string
  readonly version: 8
  readonly points: readonly TrackPoint[]
  readonly routeKind?: RouteKind
  readonly trees: readonly Tree[]
  readonly terrain: TerrainMap
  readonly start?: TrackStart
  readonly recoveryCheckpoints?: readonly number[]
  /** New tracks add a checkpoint roughly every ten authored road points. */
  readonly autoCheckpoints?: boolean
  readonly lighting: LightingMode
  readonly environmentId?: TrackEnvironmentId
  readonly scenery?: readonly SceneryProp[]
  /** Present only when this track was imported from a creator ghost challenge. */
  readonly creatorChallenge?: CreatorGhostChallenge
  readonly raceRevision?: number
  readonly createdAt: number
  readonly updatedAt: number
}

export function asTrackId(value: string): TrackId {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error('Track id cannot be empty')
  }
  return normalized as TrackId
}

export function isSurfaceId(value: unknown): value is SurfaceId {
  return typeof value === 'string' && SURFACE_IDS.some((id) => id === value)
}

export function isCarId(value: unknown): value is CarId {
  return typeof value === 'string' && CAR_IDS.some((id) => id === value)
}

export function isDifficultyId(value: unknown): value is DifficultyId {
  return (
    typeof value === 'string' &&
    DIFFICULTY_IDS.some((id) => id === value)
  )
}

export function isLightingMode(value: unknown): value is LightingMode {
  return (
    typeof value === 'string' &&
    LIGHTING_MODES.some((mode) => mode === value)
  )
}
