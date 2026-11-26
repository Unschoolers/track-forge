import { normalizeSceneryProps, normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { normalizeTrackCreator } from '@/domain/track/trackCreator'
import { normalizeRecoveryCheckpoints } from '@/domain/track/recoveryCheckpoints'
import {
  asTrackId,
  normalizeRouteKind,
  isLightingMode,
  isSurfaceId,
  type Track,
  type TrackPoint,
  type RoadStructure,
  type TrackStart,
  type Tree,
} from '@/domain/model'
import { normalizeTerrain } from '@/domain/terrain/terrainField'
import { decodeCreatorGhostChallenge } from '@/domain/track/creatorGhostChallenge'

export const TRACK_EXPORT_FORMAT = 'trackforge-track'
export const TRACK_EXPORT_FORMAT_VERSION = 1
export const MAX_TRACK_EXPORT_CHARS = 2_000_000

interface LegacyTrackElevation {
  readonly firstSegment: number
  readonly secondSegment: number
  readonly upperSegment: number
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

export function decodeTrack(value: unknown, now: number): Track | undefined {
  const item = object(value)
  if (!item || typeof item.id !== 'string' || !item.id.trim() || !Array.isArray(item.points)) {
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
  const elevationByCrossing = new Map(elevations.map((elevation) => [
    `${elevation.firstSegment}:${elevation.secondSegment}`,
    elevation.upperSegment,
  ]))
  const upperSegments = new Set(elevationByCrossing.values())
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
        !upperSegments.has(index)
          ? (point.structure ?? 'surface')
          : 'overpass',
    }),
  )
  const creator = normalizeTrackCreator(item.creator)
  const creatorChallenge = item.creatorChallenge === undefined
    ? undefined : decodeCreatorGhostChallenge(item.creatorChallenge)
  if (item.creatorChallenge !== undefined && !creatorChallenge) return undefined
  return {
    id: asTrackId(item.id),
    name,
    ...(creator ? { creator } : {}),
    ...(item.origin === 'imported' || item.origin === 'seeded' || item.origin === 'local' ? { origin: item.origin } : {}),
    ...(item.origin === 'imported' && typeof item.signedSource === 'string' &&
      item.signedSource.length <= MAX_TRACK_EXPORT_CHARS ? { signedSource: item.signedSource } : {}),
    ...(item.origin === 'imported' && typeof item.signedChallengeSource === 'string' &&
      item.signedChallengeSource.length <= MAX_TRACK_EXPORT_CHARS ? { signedChallengeSource: item.signedChallengeSource } : {}),
    version: 8,
    points: migratedPoints,
    routeKind: normalizeRouteKind(item.routeKind),
    ...(Array.isArray(item.recoveryCheckpoints) ? {
      recoveryCheckpoints: normalizeRecoveryCheckpoints(item.recoveryCheckpoints),
    } : {}),
    ...(typeof item.autoCheckpoints === 'boolean' ? { autoCheckpoints: item.autoCheckpoints } : {}),
    trees: trees.filter((tree) => tree !== undefined),
    terrain: normalizeTerrain(item.terrain),
    start: decodeStart(item.start),
    environmentId: normalizeTrackEnvironmentId(item.environmentId),
    scenery: normalizeSceneryProps(item.scenery),
    ...(creatorChallenge ? { creatorChallenge } : {}),
    ...(finite(item.raceRevision) && item.raceRevision >= 0 ? { raceRevision: item.raceRevision } : {}),
    lighting: isLightingMode(item.lighting)
      ? item.lighting
      : isLightingMode(item.timeOfDay)
        ? item.timeOfDay
        : 'day',
    createdAt: finite(item.createdAt) ? item.createdAt : now,
    updatedAt: finite(item.updatedAt) ? item.updatedAt : now,
  }
}
