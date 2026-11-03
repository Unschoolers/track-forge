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

export interface Tree extends Vector2 {}

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

export interface Track {
  readonly id: TrackId
  readonly name: string
  readonly version: 8
  readonly points: readonly TrackPoint[]
  readonly trees: readonly Tree[]
  readonly terrain: TerrainMap
  readonly start?: TrackStart
  readonly lighting: LightingMode
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
