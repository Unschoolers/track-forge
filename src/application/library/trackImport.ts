import { TERRAIN_LIMITS } from '@/domain/config'
import type { Track, Vector2 } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { CrossingWorkLimitError } from '@/domain/track/crossings'
import { roadPointsForPreview } from '@/domain/track/roadLength'
import { MAX_RECOVERY_CHECKPOINTS } from '@/domain/track/recoveryCheckpoints'
import { MAX_SCENERY_PROPS } from '@/domain/track/trackEnvironment'
import { decodeTrack, TRACK_EXPORT_FORMAT, TRACK_EXPORT_FORMAT_VERSION } from '@/domain/track/trackCodec'

export type TrackImportResult =
  | { readonly ok: true; readonly track: Track }
  | { readonly ok: false; readonly message: string }

const MAX_FILE_CHARS = 2_000_000
const MAX_POINTS = 2_000
const MAX_TREES = 5_000
const MAX_CROSSING_PAIR_CHECKS = 100_000

function coordinatesInBounds(point: Vector2): boolean {
  return Math.abs(point.x) <= 10_000_000 && Math.abs(point.y) <= 10_000_000
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Shared-file imports are treated as untrusted; the library supplies a fresh ID. */
export function parseTrackImport(content: string): TrackImportResult {
  if (content.length > MAX_FILE_CHARS) {
    return { ok: false, message: 'Track file is too large to import.' }
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) as unknown }
  catch { return { ok: false, message: 'Invalid track JSON file.' } }
  return decodeTrackExport(parsed)
}

export function decodeTrackExport(parsed: unknown): TrackImportResult {
  const envelope = object(parsed)
  if (envelope?.format !== TRACK_EXPORT_FORMAT || envelope.formatVersion !== TRACK_EXPORT_FORMAT_VERSION) {
    return { ok: false, message: 'Not a supported Track Forge export.' }
  }
  const source = object(envelope.track)
  if (!source) return { ok: false, message: 'Track contents are missing.' }
  const { points, trees } = source
  const terrain = object(source.terrain)
  if (typeof source.name !== 'string' || !source.name.trim() ||
      !Array.isArray(points) || points.length > MAX_POINTS ||
      !Array.isArray(trees) || trees.length > MAX_TREES ||
      (Array.isArray(terrain?.cells) && terrain.cells.length > TERRAIN_LIMITS.maximumCells) ||
      (Array.isArray(source.scenery) && source.scenery.length > MAX_SCENERY_PROPS) ||
      (Array.isArray(source.recoveryCheckpoints) && source.recoveryCheckpoints.length > MAX_RECOVERY_CHECKPOINTS)) {
    return { ok: false, message: 'The shared track has invalid or oversized geometry.' }
  }
  const now = Date.now()
  const track = decodeTrack({
    ...source,
    id: 'untrusted-shared-track',
    raceRevision: now,
    createdAt: now,
    updatedAt: now,
  }, now)
  if (!track?.points.every(coordinatesInBounds) || !track.trees.every(coordinatesInBounds)) {
    return { ok: false, message: 'The shared track contains invalid coordinates or surfaces.' }
  }
  const previewPoints = roadPointsForPreview(track)
  if (previewPoints.length === 0 && track.points.length > 0) {
    return { ok: false, message: 'The shared track is too long to import safely.' }
  }
  try {
    // Crossing candidates depend on road coordinates, never terrain height.
    // Preflight with a work limit before any untrusted circuit reaches storage.
    buildRoadPath(previewPoints, EMPTY_TERRAIN, MAX_CROSSING_PAIR_CHECKS, track.routeKind)
  } catch (error) {
    if (!(error instanceof CrossingWorkLimitError)) throw error
    return { ok: false, message: 'The shared track has too many overlapping road segments.' }
  }
  return { ok: true, track }
}
