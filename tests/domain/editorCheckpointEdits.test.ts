import { describe, expect, it } from 'vitest'
import { toggleAuthoredCheckpoint, moveAuthoredCheckpoint } from '@/domain/editor/checkpointEdits'
import { MAX_RECOVERY_CHECKPOINTS } from '@/domain/track/recoveryCheckpoints'

describe('authored editor checkpoint edits', () => {
  it('adds markers in sorted order and toggles an existing marker off without mutation', () => {
    const originals = [0.2, 0.7]
    expect(toggleAuthoredCheckpoint(originals, 0.5)).toEqual([0.2, 0.5, 0.7])
    expect(toggleAuthoredCheckpoint(originals, 0.2)).toEqual([0.7])
    expect(originals).toEqual([0.2, 0.7])
  })

  it('does not alter geometry when a ratio is invalid or the maximum is reached', () => {
    const checkpoints = [0.2]
    expect(toggleAuthoredCheckpoint(checkpoints, Number.NaN)).toBeNull()
    expect(toggleAuthoredCheckpoint(checkpoints, 1)).toBeNull()
    const full = Array.from({ length: MAX_RECOVERY_CHECKPOINTS }, (_, index) => index / MAX_RECOVERY_CHECKPOINTS)
    expect(toggleAuthoredCheckpoint(full, 0.999)).toBeNull()
    expect(toggleAuthoredCheckpoint(full, full[0]!)).toHaveLength(MAX_RECOVERY_CHECKPOINTS - 1)
  })

  it('moves a marker and rejects collisions, missing handles and out-of-range destinations', () => {
    const points = [0.1, 0.4, 0.8]
    expect(moveAuthoredCheckpoint(points, 0.4, 0.6)).toEqual([0.1, 0.6, 0.8])
    expect(moveAuthoredCheckpoint(points, 0.4, 0.8)).toBeNull()
    expect(moveAuthoredCheckpoint(points, 0.3, 0.6)).toBeNull()
    expect(moveAuthoredCheckpoint(points, 0.4, Number.POSITIVE_INFINITY)).toBeNull()
    expect(moveAuthoredCheckpoint(points, 0.4, 0.4)).toBeNull()
    expect(points).toEqual([0.1, 0.4, 0.8])
  })
})
