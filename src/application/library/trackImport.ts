import { TERRAIN_LIMITS, WORLD_ELEVATION } from '@/domain/config'
import { TERRAIN_KINDS, type CreatorGhostChallenge, type Track, type Vector2 } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { CrossingWorkLimitError } from '@/domain/track/crossings'
import { roadPointsForPreview } from '@/domain/track/roadLength'
import { isRecoveryCheckpointRatio, MAX_RECOVERY_CHECKPOINTS } from '@/domain/track/recoveryCheckpoints'
import { MAX_SCENERY_PROPS, normalizeSceneryProps } from '@/domain/track/trackEnvironment'
import { decodeTrack, MAX_TRACK_EXPORT_CHARS, TRACK_EXPORT_FORMAT, trackExportFormatVersion } from '@/domain/track/trackCodec'
import { decodeCreatorGhostChallenge } from '@/domain/track/creatorGhostChallenge'
import {
  SIGNED_TRACK_FORMAT_VERSION,
  SIGNED_JUMP_TRACK_FORMAT_VERSION,
  SIGNED_TRACK_REPLY_FORMAT,
  SIGNED_TRACK_REPLY_FORMAT_VERSION,
  verifySignedTrackReply,
  verifyTrackSignature,
} from './trackSignature'

export type TrackImportResult =
  | { readonly ok: true; readonly track: Track; readonly signedSource?: string; readonly signedChallengeSource?: string }
  | { readonly ok: false; readonly message: string }

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

/** Shared exports must not silently erase malformed authored terrain. */
function validSharedTerrain(value: unknown): boolean {
  if (value === undefined) return true // older exports can omit terrain
  const input = object(value)
  if (!input || !Array.isArray(input.cells)) return false
  if (input.cellSize !== undefined && input.cellSize !== WORLD_ELEVATION.cellSize) return false
  if (input.cells.length > TERRAIN_LIMITS.maximumCells) return false
  const occupied = new Set<string>()
  for (const raw of input.cells) {
    const cell = object(raw)
    if (!cell || typeof cell.column !== 'number' || typeof cell.row !== 'number' ||
        !Number.isInteger(cell.column) || !Number.isInteger(cell.row) ||
        cell.column < TERRAIN_LIMITS.minimumCoordinate ||
        cell.column > TERRAIN_LIMITS.maximumCoordinate ||
        cell.row < TERRAIN_LIMITS.minimumCoordinate ||
        cell.row > TERRAIN_LIMITS.maximumCoordinate ||
        !TERRAIN_KINDS.some(kind => kind === cell.kind)) return false
    const key = `${cell.column}:${cell.row}`
    if (occupied.has(key)) return false
    occupied.add(key)
  }
  return true
}

/** Shared-file imports are treated as untrusted; the library supplies a fresh ID. */
export function parseTrackImport(content: string): TrackImportResult {
  const parsed = parseTrackFile(content)
  return parsed.ok ? decodeTrackExport(parsed.envelope) : parsed
}

function parseTrackFile(content: string):
  { readonly ok: true; readonly envelope: Record<string, unknown> } | { readonly ok: false; readonly message: string } {
  if (content.length > MAX_TRACK_EXPORT_CHARS) {
    return { ok: false, message: 'Track file is too large to import.' }
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) as unknown }
  catch { return { ok: false, message: 'Invalid track JSON file.' } }
  const envelope = object(parsed)
  return envelope?.format === TRACK_EXPORT_FORMAT || envelope?.format === SIGNED_TRACK_REPLY_FORMAT
    ? { ok: true, envelope }
    : { ok: false, message: 'Not a supported Track Forge export.' }
}

export async function parseSharedTrackImport(content: string): Promise<TrackImportResult> {
  const parsed = parseTrackFile(content)
  if (!parsed.ok) return parsed
  const { envelope } = parsed
  if (envelope.format === SIGNED_TRACK_REPLY_FORMAT &&
      envelope.formatVersion === SIGNED_TRACK_REPLY_FORMAT_VERSION) {
    if (!globalThis.crypto?.subtle) return { ok: false, message: 'Track signature verification is unavailable on this device.' }
    if (!await verifySignedTrackReply(envelope)) {
      return { ok: false, message: 'Invalid track reply signature. The original file is required.' }
    }
    const signedOriginal = envelope.original
    if (typeof signedOriginal !== 'string') return { ok: false, message: 'The signed track reply is invalid or incomplete.' }
    const original = await parseSharedTrackImport(signedOriginal)
    const challenge = decodeCreatorGhostChallenge(envelope.creatorChallenge)
    if (!original.ok || !original.signedSource || !challenge) {
      return { ok: false, message: 'The signed track reply is invalid or incomplete.' }
    }
    if (original.track.routeKind === 'point-to-point' && challenge.laps !== 1) {
      return { ok: false, message: 'A point-to-point creator ghost must use a single run.' }
    }
    return { ok: true,
      track: { ...original.track, creatorChallenge: challenge, signedChallengeSource: content },
      signedSource: original.signedSource,
      signedChallengeSource: content,
    }
  }
  if (envelope.formatVersion !== SIGNED_TRACK_FORMAT_VERSION && envelope.formatVersion !== SIGNED_JUMP_TRACK_FORMAT_VERSION) return decodeTrackExport(envelope)
  if (!globalThis.crypto?.subtle) return { ok: false, message: 'Track signature verification is unavailable on this device.' }
  if (!await verifyTrackSignature(envelope)) {
    return { ok: false, message: 'Invalid track signature. The original file is required.' }
  }
  const decoded = decodeTrackPayload(envelope.track)
  return decoded.ok ? { ...decoded, signedSource: content } : decoded
}

export function decodeTrackExport(parsed: unknown): TrackImportResult {
  const envelope = object(parsed)
  if (envelope?.format !== TRACK_EXPORT_FORMAT || envelope.formatVersion !== trackExportFormatVersion(envelope.track) ||
      Object.hasOwn(envelope, 'signature')) {
    return { ok: false, message: 'Not a supported Track Forge export.' }
  }
  if (Object.hasOwn(envelope, 'creatorChallenge')) {
    return { ok: false, message: 'Creator ghost challenges require a signed track file.' }
  }
  const source = object(envelope.track)
  if (!source) return { ok: false, message: 'Track contents are missing.' }
  if (Object.hasOwn(source, 'creatorChallenge')) {
    return { ok: false, message: 'Creator ghost challenges require a signed track file.' }
  }
  return decodeTrackPayload(source)
}

function decodeTrackPayload(payload: unknown): TrackImportResult {
  const source = object(payload)
  if (!source) return { ok: false, message: 'Track contents are missing.' }
  const creatorChallenge: CreatorGhostChallenge | undefined = source.creatorChallenge === undefined
    ? undefined : decodeCreatorGhostChallenge(source.creatorChallenge)
  if (source.creatorChallenge !== undefined && !creatorChallenge) {
    return { ok: false, message: 'The creator ghost challenge is invalid or oversized.' }
  }
  const { points, trees } = source
  if (creatorChallenge && source.routeKind === 'point-to-point' && creatorChallenge.laps !== 1) {
    return { ok: false, message: 'A point-to-point creator ghost must use a single run.' }
  }
  if (typeof source.name !== 'string' || !source.name.trim() ||
      !Array.isArray(points) || points.length > MAX_POINTS ||
      !Array.isArray(trees) || trees.length > MAX_TREES ||
      !validSharedTerrain(source.terrain) ||
      (source.scenery !== undefined && (
        !Array.isArray(source.scenery) ||
        source.scenery.length > MAX_SCENERY_PROPS ||
        normalizeSceneryProps(source.scenery).length !== source.scenery.length
      )) ||
      (source.recoveryCheckpoints !== undefined && (
        !Array.isArray(source.recoveryCheckpoints) ||
        source.recoveryCheckpoints.length > MAX_RECOVERY_CHECKPOINTS ||
        !source.recoveryCheckpoints.every(isRecoveryCheckpointRatio)
      )) ||
      (source.autoCheckpoints !== undefined && typeof source.autoCheckpoints !== 'boolean')) {
    return { ok: false, message: 'The shared track has invalid or oversized geometry.' }
  }
  const now = Date.now()
  const localSource = { ...source }
  delete localSource.signedSource
  delete localSource.signedChallengeSource
  const track = decodeTrack({
    ...localSource,
    ...(creatorChallenge ? { creatorChallenge } : {}),
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
