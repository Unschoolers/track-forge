import { buildRoadPath, nearestPathPoint, type RoadPath } from '@/domain/track/pathBuilder'
import type { RouteKind, TerrainMap, TrackPoint } from '@/domain/model'
import { isSafeRoadRecoverySample } from '@/domain/track/waterExposure'

export const MAX_RECOVERY_CHECKPOINTS = 64

export function isRecoveryCheckpointRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
}

export function normalizeRecoveryCheckpoints(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.slice(0, MAX_RECOVERY_CHECKPOINTS).filter(isRecoveryCheckpointRatio))]
    .sort((left, right) => left - right)
}

export function resolveRecoveryCheckpoints(
  path: RoadPath,
  ratios: readonly number[] | undefined,
): readonly number[] {
  const last = path.points.length - 1
  if (!ratios?.length || last < 1) return []
  const samples = path.closed ? path.points.length : last
  return [...new Set(ratios.filter(isRecoveryCheckpointRatio)
    .map(ratio => Math.min(last, Math.round(ratio * samples))))]
    .filter(index => (path.closed || index < last) && isSafeRoadRecoverySample(path, index))
}

/** Checkpoints are authored ratios; automatic additions never replace manual edits. */
export const AUTO_CHECKPOINT_POINT_INTERVAL = 10

function authoredRoadLength(points: readonly TrackPoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]
    const after = points[index]
    if (before && after) length += Math.hypot(after.x - before.x, after.y - before.y)
  }
  return length
}

/**
 * Extend a drawn road without shifting existing markers in world space.
 * Existing marker distances are preserved; only the newly reached tenth
 * control point can create a new automatic marker.
 */
export function extendAutoRecoveryCheckpoints(
  before: readonly TrackPoint[],
  after: readonly TrackPoint[],
  checkpoints: readonly number[],
  terrain: TerrainMap,
  routeKind: RouteKind,
): readonly number[] {
  const previousLength = authoredRoadLength(before)
  const nextLength = authoredRoadLength(after)
  if (nextLength <= 0) return checkpoints
  const preserved = previousLength > 0
    ? checkpoints.map(ratio => Math.min(0.999_999, ratio * previousLength / nextLength))
    : [...checkpoints]
  if (after.length < AUTO_CHECKPOINT_POINT_INTERVAL ||
      after.length % AUTO_CHECKPOINT_POINT_INTERVAL !== 0 ||
      preserved.length >= MAX_RECOVERY_CHECKPOINTS) return preserved

  // Use the compiled centreline (and terrain safety), not a raw polygon chord.
  // The penultimate node remains stable while the last control point is drawn.
  const anchor = after[after.length - 2]
  if (!anchor) return preserved
  const path = buildRoadPath(after, terrain, 0, routeKind)
  const nearest = nearestPathPoint(path, anchor)
  if (!nearest || path.totalLength <= 0 ||
      !isSafeRoadRecoverySample(path, nearest.index)) return preserved
  const ratio = nearest.point.distance / path.totalLength
  if (!isRecoveryCheckpointRatio(ratio) ||
      preserved.some(mark => Math.abs(mark - ratio) * path.totalLength < 24)) return preserved
  return [...preserved, ratio].sort((a, b) => a - b)
}
