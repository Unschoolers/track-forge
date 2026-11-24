import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { isUntouchedLegacyStarter } from '@/migrations/legacyStarterIdentity'

function original() {
  const { recoveryCheckpoints: _markers, autoCheckpoints: _auto, ...track } =
    createStarterTrack(asTrackId('starter-original'), 0)
  void _markers
  void _auto
  return track
}

describe('retired starter safety', () => {
  it('recognizes only an untouched legacy copy', () => {
    const old = original()
    expect(isUntouchedLegacyStarter(old)).toBe(true)
    expect(isUntouchedLegacyStarter({ ...old, id: asTrackId('my-race') })).toBe(false)
  })

  it('preserves every independently edited cosmetic or racing field', () => {
    const old = original()
    const edits = [
      { ...old, lighting: 'night' as const },
      { ...old, scenery: [{ kind: 'grass-rock' as const, x: 12, y: 23 }] },
      { ...old, start: { ratio: 0.2, reversed: false } },
      { ...old, recoveryCheckpoints: [] },
      { ...old, autoCheckpoints: false },
      { ...old, points: old.points.map((p, i) => i === 0 ? { ...p, x: p.x + 5 } : p) },
      { ...old, trees: [...old.trees, { x: 1, y: 2 }] },
    ]
    for (const edit of edits) expect(isUntouchedLegacyStarter(edit)).toBe(false)
  })
})
