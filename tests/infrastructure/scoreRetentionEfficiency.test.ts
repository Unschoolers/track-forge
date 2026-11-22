import { describe, expect, it, vi } from 'vitest'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'
import { asTrackId } from '@/domain/model'
import type { ScoreEntry } from '@/application/ports/storage'

const track = asTrackId('many-results')
const category = { course: 'v2:many', laps: 2, handling: 'arcade' as const, mode: 'normal' as const }
const entry = (time: number, handling: 'arcade' | 'simulation' = 'arcade'): ScoreEntry => ({
  time, car: 'blue', difficulty: 'normal', recordedAt: time,
  category: { ...category, handling },
})

describe('score repository bounded top-five retention', () => {
  it('keeps only the five best results per category and maintains ties in source order', () => {
    const values = new Map<string, string>([
      [STORAGE_KEYS.scoreMigration, '1'],
      [STORAGE_KEYS.scores, JSON.stringify({ [track]: [
        ...Array.from({ length: 500 }, (_, i) => entry(500 - i)),
        ...Array.from({ length: 9 }, (_, i) => entry(20 - i, 'simulation')),
      ] })],
    ])
    const repo = new BrowserScoreRepository({
      get: key => values.get(key) ?? null,
      set: (key, value) => { values.set(key, value); return true },
      remove: key => values.delete(key),
    })
    const scores = repo.forTrack(track)
    expect(scores.filter(s => s.category?.handling === 'arcade').map(s => s.time))
      .toEqual([1, 2, 3, 4, 5])
    expect(scores.filter(s => s.category?.handling === 'simulation').map(s => s.time))
      .toEqual([12, 13, 14, 15, 16])
  })

  it('performs one score-storage read when recording a new result', () => {
    const values = new Map<string, string>([
      [STORAGE_KEYS.scoreMigration, '1'],
      [STORAGE_KEYS.scores, JSON.stringify({ [track]: [entry(18)] })],
    ])
    const get = vi.fn((key: string) => values.get(key) ?? null)
    const repo = new BrowserScoreRepository({
      get,
      set: (key, value) => { values.set(key, value); return true },
      remove: key => values.delete(key),
    })
    expect(repo.record(track, entry(12))).toBe(true)
    expect(get.mock.calls.filter(([key]) => key === STORAGE_KEYS.scores)).toHaveLength(1)
    expect(repo.forTrack(track).map(s => s.time)).toEqual([12, 18])
  })
})
