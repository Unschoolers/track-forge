import { describe, expect, it } from 'vitest'
import { BrowserLastRaceRepository } from '@/infrastructure/storage/lastRaceRepository'
import { asTrackId } from '@/domain/model'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

describe('last race storage', () => {
  it('round trips a resolved setup and rejects corrupt entries', () => {
    const data = new Map<string, string>()
    const store = new BrowserLastRaceRepository({ get: (key) => data.get(key) ?? null, set: (key, value) => { data.set(key, value); return true }, remove: (key) => data.delete(key) })
    const race = { trackId: asTrackId('saved'), course: 'v2:123', setup: { car: 'blue' as const, difficulty: 'normal' as const, laps: 2, handling: 'simulation' as const, mode: 'ghost' as const, lighting: 'night' as const } }
    expect(store.save(race)).toBe(true)
    expect(store.load()).toEqual(race)
    data.set(STORAGE_KEYS.lastRace, '{broken')
    expect(store.load()).toBeNull()
  })
})
