import { describe, expect, it } from 'vitest'
import { MAX_RECOVERY_CHECKPOINTS, normalizeRecoveryCheckpoints, resolveRecoveryCheckpoints } from '@/domain/track/recoveryCheckpoints'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import { buildRoadPath } from '@/domain/track/pathBuilder'

describe('imported recovery checkpoint normalization', () => {
  it('does not let duplicate or invalid early entries consume the marker capacity', () => {
    const input = [
      ...Array.from({ length: MAX_RECOVERY_CHECKPOINTS }, () => 0.5),
      Number.NaN, -1, 1,
      0.75, 0.25,
    ]
    expect(normalizeRecoveryCheckpoints(input)).toEqual([0.25, 0.5, 0.75])
  })

  it('retains at most the first 64 distinct valid markers, in route order', () => {
    const distinct = Array.from({ length: 80 }, (_, i) => (i + 1) / 100)
    const normalized = normalizeRecoveryCheckpoints([...distinct, 0.9])
    expect(normalized).toHaveLength(MAX_RECOVERY_CHECKPOINTS)
    expect(normalized[0]).toBeCloseTo(0.01)
    expect(normalized.at(-1)).toBeCloseTo(0.64)
  })

  it('resolves unsorted imported marker ratios to sorted path indices without duplicates', () => {
    const track = createStarterTrack(asTrackId('normalized-checkpoint'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const indices = resolveRecoveryCheckpoints(path, [0.75, 0.25, 0.25, Number.NaN])
    expect(indices).toHaveLength(2)
    expect(indices[0]).toBeLessThan(indices[1]!)
  })
})
