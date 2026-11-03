import type { KeyValueStore, TrackStore } from '@/application/ports/storage'
import {
  asTrackId,
  isLightingMode,
  isSurfaceId,
  type Track,
  type TrackId,
  type TrackPoint,
  type RoadStructure,
  type TrackStart,
  type Tree,
} from '@/domain/model'
import { normalizeTerrain } from '@/domain/terrain/terrainField'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

interface LegacyTrackElevation {
  readonly firstSegment: number
  readonly secondSegment: number
  readonly upperSegment: number
}

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

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

interface DecodedTrackPoint {
  readonly point: TrackPoint
  readonly hasStructure: boolean
}

function decodePoint(
  value: unknown,
  index: number,
): DecodedTrackPoint | undefined {
  const item = object(value)
  if (
    !item ||
    !finite(item.x) ||
    !finite(item.y) ||
    !isSurfaceId(item.surface)
  ) {
    return undefined
  }
  const id =
    typeof item.id === 'string' && item.id.trim().length > 0
      ? item.id.trim().slice(0, 64)
      : `point-${index}`
  const curve = item.curve === 'corner' ? 'corner' : 'smooth'
  const rawTension = finite(item.tension) ? item.tension : 0.5
  const hasStructure =
    item.structure === 'surface' || item.structure === 'overpass'
  const structure: RoadStructure =
    item.structure === 'surface' || item.structure === 'overpass'
      ? item.structure
      : item.elevation === 'overhead'
        ? 'overpass'
        : 'surface'
  return {
    point: {
      x: item.x,
      y: item.y,
      surface: item.surface,
      id,
      curve,
      tension: Math.max(0, Math.min(1, rawTension)),
      structure,
    },
    hasStructure,
  }
}

function decodeStart(value: unknown): TrackStart {
  const item = object(value)
  return {
    ratio:
      item && finite(item.ratio)
        ? Math.max(0, Math.min(0.999_999, item.ratio))
        : 0,
    reversed: item?.reversed === true,
  }
}

function decodeTree(value: unknown): Tree | undefined {
  const item = object(value)
  return item && finite(item.x) && finite(item.y)
    ? { x: item.x, y: item.y }
    : undefined
}

function decodeElevation(value: unknown): LegacyTrackElevation | undefined {
  const item = object(value)
  if (
    !item ||
    !Number.isInteger(item.firstSegment) ||
    !Number.isInteger(item.secondSegment) ||
    !Number.isInteger(item.upperSegment)
  ) {
    return undefined
  }
  const firstSegment = Math.min(
    item.firstSegment as number,
    item.secondSegment as number,
  )
  const secondSegment = Math.max(
    item.firstSegment as number,
    item.secondSegment as number,
  )
  const upperSegment = item.upperSegment as number
  if (
    firstSegment < 0 ||
    firstSegment === secondSegment ||
    (upperSegment !== firstSegment && upperSegment !== secondSegment)
  ) {
    return undefined
  }
  return { firstSegment, secondSegment, upperSegment }
}

function normalizeName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 32)
    : ''
}

function decodeTrack(value: unknown, now: number): Track | undefined {
  const item = object(value)
  if (!item || typeof item.id !== 'string' || !Array.isArray(item.points)) {
    return undefined
  }
  const name = normalizeName(item.name)
  const points = item.points.map(decodePoint)
  const rawTrees = Array.isArray(item.trees) ? item.trees : []
  const trees = rawTrees.map(decodeTree)
  const rawElevations = Array.isArray(item.elevations) ? item.elevations : []
  const elevations = rawElevations
    .map(decodeElevation)
    .filter((elevation) => elevation !== undefined)
  const uniqueElevations = [
    ...new Map(
      elevations.map((elevation) => [
        `${elevation.firstSegment}:${elevation.secondSegment}`,
        elevation,
      ]),
    ).values(),
  ]
  if (
    name.length === 0 ||
    points.some((point) => point === undefined) ||
    trees.some((tree) => tree === undefined)
  ) {
    return undefined
  }
  const normalizedPoints = points.filter(
    (point): point is DecodedTrackPoint => point !== undefined,
  )
  const migratedPoints = normalizedPoints.map(
    ({ point, hasStructure }, index): TrackPoint => ({
      ...point,
      structure:
        hasStructure ||
        item.version === 7 ||
        !uniqueElevations.some((elevation) => elevation.upperSegment === index)
          ? (point.structure ?? 'surface')
          : 'overpass',
    }),
  )
  return {
    id: asTrackId(item.id),
    name,
    version: 8,
    points: migratedPoints,
    trees: trees.filter((tree) => tree !== undefined),
    terrain: normalizeTerrain(item.terrain),
    start: decodeStart(item.start),
    lighting: isLightingMode(item.lighting)
      ? item.lighting
      : isLightingMode(item.timeOfDay)
        ? item.timeOfDay
        : 'day',
    createdAt: finite(item.createdAt) ? item.createdAt : now,
    updatedAt: finite(item.updatedAt) ? item.updatedAt : now,
  }
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
