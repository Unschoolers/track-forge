import { isRecoveryCheckpointRatio, MAX_RECOVERY_CHECKPOINTS } from '@/domain/track/recoveryCheckpoints'

/** Return null for a no-op, so editor history is not polluted. */
export function toggleAuthoredCheckpoint(
  checkpoints: readonly number[],
  ratio: number,
): readonly number[] | null {
  if (!isRecoveryCheckpointRatio(ratio)) return null
  if (checkpoints.includes(ratio)) return checkpoints.filter(mark => mark !== ratio)
  if (checkpoints.length >= MAX_RECOVERY_CHECKPOINTS) return null
  return [...checkpoints, ratio].sort((a, b) => a - b)
}

export function moveAuthoredCheckpoint(
  checkpoints: readonly number[],
  from: number,
  to: number,
): readonly number[] | null {
  if (!isRecoveryCheckpointRatio(to) || !checkpoints.includes(from) ||
      from === to || checkpoints.includes(to)) return null
  return [...checkpoints.filter(mark => mark !== from), to].sort((a, b) => a - b)
}
