import { describe, expect, it } from 'vitest'
import { courseIdentity, raceCategory, sameCategory } from '@/application/race/raceRecords'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('records'), 1)
const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 3 }

describe('race record identity', () => {
  it('keeps metadata changes but partitions layout and start changes', () => {
    const original = courseIdentity(track)
    expect(courseIdentity({ ...track, name: 'Renamed', updatedAt: 100, lighting: 'night' })).toBe(original)
    expect(courseIdentity({ ...track, points: track.points.map((point, i) => i ? point : { ...point, x: point.x + 1 }) })).not.toBe(original)
    expect(courseIdentity({ ...track, start: { ratio: 0.5, reversed: true } })).not.toBe(original)
  })

  it('keeps large terrain identities compact and deterministic', () => {
    const cells = Array.from({ length: 20000 }, (_, i) => ({ column: i, row: 0, kind: 'hill' as const }))
    const large = { ...track, terrain: { ...track.terrain, cells } }
    expect(courseIdentity(large)).toMatch(/^v2:[0-9a-f]{16}$/)
    expect(courseIdentity({ ...large, terrain: { ...large.terrain, cells: [...cells].reverse() } })).toBe(courseIdentity(large))
    expect(courseIdentity({ ...large, terrain: { ...large.terrain, cells: cells.slice(1) } })).not.toBe(courseIdentity(large))
  })

  it('partitions laps, handling, format, car and difficulty', () => {
    const category = raceCategory(track, setup)
    const score = { time: 10, car: setup.car, difficulty: setup.difficulty, recordedAt: 1, category }
    expect(sameCategory(score, category, setup)).toBe(true)
    for (const changed of [{ ...setup, laps: 1 }, { ...setup, handling: 'simulation' as const }, { ...setup, mode: 'ghost' as const }, { ...setup, car: 'red' as const }, { ...setup, difficulty: 'hard' as const }]) {
      expect(sameCategory(score, raceCategory(track, changed), changed)).toBe(false)
    }
    expect(sameCategory({ time: 10, car: 'blue', difficulty: 'normal', recordedAt: 1 }, category, setup)).toBe(false)
  })
})
