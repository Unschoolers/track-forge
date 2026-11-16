import type { RoadPath } from '@/domain/track/pathBuilder'
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
