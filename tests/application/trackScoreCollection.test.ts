import { describe, expect, it, vi } from 'vitest'
import type { ScoreEntry } from '@/application/ports/storage'
import { collectTrackScores } from '@/application/race/trackScoreCollection'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

const local = createStarterTrack(asTrackId('same-id'), 1)
const official = { ...local, routeKind: 'point-to-point' as const }
const circuit: ScoreEntry = { car: 'blue', difficulty: 'normal', recordedAt: 1, time: 20,
  category: { course: 'v2:test', laps: 2, handling: 'arcade', mode: 'normal', routeKind: 'circuit' } }
const open: ScoreEntry = { ...circuit, category: { ...circuit.category!, routeKind: 'point-to-point' } }

describe('track score lookup', () => {
  it('reads each unique track id once, using official route metadata for id collisions', () => {
    const forTrack = vi.fn(() => [circuit, open])
    const result = collectTrackScores([local, local], [official], { forTrack })
    expect(forTrack).toHaveBeenCalledTimes(1)
    expect(forTrack).toHaveBeenCalledWith(local.id)
    expect(result[local.id]).toEqual([open])
  })

  it('keeps reserved-looking track IDs as ordinary own keys', () => {
    const special = createStarterTrack(asTrackId('__proto__'), 1)
    const result = collectTrackScores([special], [], { forTrack: () => [circuit] })
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(result['__proto__']).toEqual([circuit])
  })

  it('does not read scores for absent tracks and keeps legacy circuit scores', () => {
    const forTrack = vi.fn(() => [circuit, { time: 18, car: 'blue' as const, difficulty: 'normal' as const, recordedAt: 2 }])
    expect(collectTrackScores([], [], { forTrack })).toEqual({})
    expect(forTrack).not.toHaveBeenCalled()
    const result = collectTrackScores([local], [], { forTrack })
    expect(result[local.id]).toHaveLength(2)
  })
})
