import { describe, expect, it } from 'vitest'
import { BrowserLastRaceRepository } from '@/infrastructure/storage/lastRaceRepository'
import { asTrackId } from '@/domain/model'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'
import { DRIFT_BOOST_V1_RULES } from '@/domain/race/driftBoost'

describe('last race storage', () => {
  it('round trips a resolved setup and rejects corrupt entries', () => {
    const data = new Map<string, string>()
    const store = new BrowserLastRaceRepository({ get: (key) => data.get(key) ?? null, set: (key, value) => { data.set(key, value); return true }, remove: (key) => data.delete(key) })
    const race = { trackId: asTrackId('saved'), course: 'v2:123', setup: { car: 'blue' as const, difficulty: 'normal' as const, laps: 2, mode: 'ghost' as const, lighting: 'night' as const } }
    expect(store.save(race)).toBe(true)
    expect(store.load()).toEqual(race)
    data.set(STORAGE_KEYS.lastRace, '{broken')
    expect(store.load()).toBeNull()
  })

  it('round trips Boost Practice only with its exact frozen rules', () => {
    const data = new Map<string, string>()
    const store = new BrowserLastRaceRepository({ get: (key) => data.get(key) ?? null, set: (key, value) => { data.set(key, value); return true }, remove: (key) => data.delete(key) })
    const race = {
      trackId: asTrackId('boost-practice'), course: 'v3:123',
      setup: { car: 'blue' as const, difficulty: 'normal' as const, laps: 2, mode: 'boost-practice' as const,
        lighting: 'night' as const, driftBoostRules: DRIFT_BOOST_V1_RULES },
    }
    expect(store.save(race)).toBe(true)
    expect(store.load()).toEqual(race)
    const saved = JSON.parse(data.get(STORAGE_KEYS.lastRace) ?? 'null') as { setup: Record<string, unknown> }
    saved.setup.driftBoostRules = { ...DRIFT_BOOST_V1_RULES, revision: 'drift-boost-v1', secondsToFull: 5 }
    data.set(STORAGE_KEYS.lastRace, JSON.stringify(saved))
    expect(store.load()).toEqual(race)
    saved.setup.driftBoostRules = { ...DRIFT_BOOST_V1_RULES, secondsToFull: 4 }
    data.set(STORAGE_KEYS.lastRace, JSON.stringify(saved))
    expect(store.load()).toBeNull()
  })
})
