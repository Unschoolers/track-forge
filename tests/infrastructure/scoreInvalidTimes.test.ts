import { describe, expect, it } from 'vitest'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'
import { asTrackId } from '@/domain/model'

describe('score time validity', () => {
  it('never records zero or negative race times as leaderboard records', () => {
    const values = new Map([[STORAGE_KEYS.scoreMigration, '1']])
    const repository = new BrowserScoreRepository({
      get: key => values.get(key) ?? null,
      set: (key, value) => { values.set(key, value); return true },
      remove: key => values.delete(key),
    })
    const track = asTrackId('valid-time')
    const score = { car: 'blue' as const, difficulty: 'normal' as const, recordedAt: 100 }
    expect(repository.record(track, { ...score, time: 0 })).toBe(false)
    expect(repository.record(track, { ...score, time: -5 })).toBe(false)
    expect(repository.record(track, { ...score, time: 12.5 })).toBe(true)
    expect(repository.forTrack(track).map(entry => entry.time)).toEqual([12.5])
  })
})
