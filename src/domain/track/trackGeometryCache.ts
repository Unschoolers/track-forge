import { TERRAIN_LIMITS } from '@/domain/config'
import type { Track } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'

type GeometryInput = Pick<Track, 'points' | 'start' | 'terrain'>

interface GeometryCacheEntry {
  readonly key: string
  readonly geometry: TrackGeometry
  readonly weight: number
  readonly points: GeometryInput['points']
  readonly terrain: GeometryInput['terrain']
  readonly startRatio: number
  readonly reversed: boolean
}

interface GeometryIdentity {
  readonly points: GeometryInput['points']
  readonly terrain: GeometryInput['terrain']
  readonly startRatio: number
  readonly reversed: boolean
}

interface GeometryIdentitySlot {
  forward?: GeometryCacheEntry
  reversed?: GeometryCacheEntry
}

type GeometryIdentityByTerrain = WeakMap<
  GeometryInput['terrain'],
  Map<number, GeometryIdentitySlot>
>

// Two maximum-cell checkerboard surfaces fit; a third large graph does not.
// Very long paths add their own weight and may deliberately receive less reuse.
export const TRACK_GEOMETRY_CACHE_LIMITS = {
  maximumWeight: TERRAIN_LIMITS.maximumCells * 34,
  terrainCellWeight: 10,
  pathPointWeight: 4,
  signatureCharactersPerWeight: 8,
} as const

export function trackGeometrySignature(track: GeometryInput): string {
  const points = track.points
    .map(
      (point) =>
        `${point.id ?? ''},${point.x},${point.y},${point.surface},${point.curve ?? 'smooth'},${point.tension ?? 0.5},${point.structure ?? 'surface'}`,
    )
    .join(';')
  const terrain = track.terrain.cells
    .map((cell) => `${cell.column},${cell.row},${cell.kind}`)
    .join(';')
  return `${points}|${track.start?.ratio ?? 0},${track.start?.reversed === true}|${track.terrain.cellSize}|${terrain}`
}

function geometryIdentity(
  track: GeometryInput,
): GeometryIdentity {
  const start = track.start
  return {
    points: track.points,
    terrain: track.terrain,
    startRatio: start?.ratio ?? 0,
    reversed: start?.reversed === true,
  }
}

function entryWeight(
  track: GeometryInput,
  geometry: TrackGeometry,
  key: string,
): number {
  const contourPoints = geometry.path.terrainSurface.contours.reduce(
    (total, contour) => total + contour.points.length,
    0,
  )
  return (
    track.terrain.cells.length *
      TRACK_GEOMETRY_CACHE_LIMITS.terrainCellWeight +
    geometry.path.points.length *
      TRACK_GEOMETRY_CACHE_LIMITS.pathPointWeight +
    contourPoints +
    Math.ceil(
      key.length /
        TRACK_GEOMETRY_CACHE_LIMITS.signatureCharactersPerWeight,
    )
  )
}

/**
 * Content-keyed geometry LRU with an immutable-reference fast path. Entries
 * own every strong reference used by lookup, so weighted eviction also makes
 * their TerrainSurface presentation keys collectible.
 */
export class TrackGeometryCache {
  private readonly entries = new Map<string, GeometryCacheEntry>()
  private identityByPoints = new WeakMap<
    GeometryInput['points'],
    GeometryIdentityByTerrain
  >()
  private retainedWeight = 0

  get(
    track: GeometryInput,
    createKey: () => string,
  ): TrackGeometry | undefined {
    const identity = geometryIdentity(track)
    const indexed = this.indexedEntry(identity)
    if (indexed && this.entries.get(indexed.key) === indexed) {
      this.touch(indexed.key, indexed)
      return indexed.geometry
    }

    const key = createKey()
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.unindex(entry)
    const rebound: GeometryCacheEntry = {
      ...entry,
      ...identity,
    }
    this.touch(key, rebound)
    this.index(rebound)
    return rebound.geometry
  }

  set(
    track: GeometryInput,
    key: string,
    geometry: TrackGeometry,
  ): void {
    const weight = entryWeight(track, geometry, key)
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.unindex(existing)
      this.retainedWeight -= existing.weight
    }
    if (weight > TRACK_GEOMETRY_CACHE_LIMITS.maximumWeight) return
    const entry: GeometryCacheEntry = {
      key,
      geometry,
      weight,
      ...geometryIdentity(track),
    }
    this.entries.set(key, entry)
    this.index(entry)
    this.retainedWeight += weight
    while (
      this.retainedWeight > TRACK_GEOMETRY_CACHE_LIMITS.maximumWeight
    ) {
      const oldest = this.entries.entries().next().value
      if (!oldest) break
      const [oldestKey, oldestEntry] = oldest
      this.entries.delete(oldestKey)
      this.unindex(oldestEntry)
      this.retainedWeight -= oldestEntry.weight
    }
  }

  clear(): void {
    this.entries.clear()
    this.identityByPoints = new WeakMap()
    this.retainedWeight = 0
  }

  private touch(key: string, entry: GeometryCacheEntry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }

  private indexedEntry(
    identity: GeometryIdentity,
  ): GeometryCacheEntry | undefined {
    const slot = this.identityByPoints
      .get(identity.points)
      ?.get(identity.terrain)
      ?.get(identity.startRatio)
    return identity.reversed ? slot?.reversed : slot?.forward
  }

  private index(entry: GeometryCacheEntry): void {
    let byTerrain = this.identityByPoints.get(entry.points)
    if (!byTerrain) {
      byTerrain = new WeakMap()
      this.identityByPoints.set(entry.points, byTerrain)
    }
    let byStart = byTerrain.get(entry.terrain)
    if (!byStart) {
      byStart = new Map()
      byTerrain.set(entry.terrain, byStart)
    }
    let slot = byStart.get(entry.startRatio)
    if (!slot) {
      slot = {}
      byStart.set(entry.startRatio, slot)
    }
    if (entry.reversed) slot.reversed = entry
    else slot.forward = entry
  }

  private unindex(entry: GeometryCacheEntry): void {
    const byTerrain = this.identityByPoints.get(entry.points)
    const byStart = byTerrain?.get(entry.terrain)
    const slot = byStart?.get(entry.startRatio)
    if (!byTerrain || !byStart || !slot) return
    if (entry.reversed) {
      if (slot.reversed !== entry) return
      delete slot.reversed
    } else {
      if (slot.forward !== entry) return
      delete slot.forward
    }
    if (slot.forward || slot.reversed) return
    byStart.delete(entry.startRatio)
    if (byStart.size === 0) byTerrain.delete(entry.terrain)
  }
}
