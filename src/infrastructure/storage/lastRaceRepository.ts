import type { KeyValueStore, LastRace, LastRaceStore } from '@/application/ports/storage'
import { asTrackId, isCarId, isDifficultyId, isLightingMode } from '@/domain/model'
import { DRIFT_BOOST_V1_RULES, type DriftBoostRules } from '@/domain/race/driftBoost'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

function isDriftBoostRules(value: unknown): value is DriftBoostRules {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return Object.entries(DRIFT_BOOST_V1_RULES)
    .every(([key, expected]) => candidate[key] === expected)
}

export class BrowserLastRaceRepository implements LastRaceStore {
  constructor(private readonly storage: KeyValueStore) {}

  load(): LastRace | null {
    const current = this.storage.get(STORAGE_KEYS.lastRace)
    if (current !== null) return this.decode(current, 2)
    const legacy = this.decode(this.storage.get('trackforge-last-race-v1'), 1)
    if (legacy && !this.save(legacy)) console.warn('Track Forge: last race migration not yet persisted.')
    return legacy
  }

  private decode(raw: string | null, version: 1 | 2): LastRace | null {
    try {
      const value: unknown = JSON.parse(raw ?? 'null')
      if (!value || typeof value !== 'object') return null
      const item = value as Record<string, unknown>
      if (item.version !== version || typeof item.trackId !== 'string' || !item.trackId || typeof item.course !== 'string' || !item.course || !item.setup || typeof item.setup !== 'object') return null
      const setup = item.setup as Record<string, unknown>
      if (version === 1 && setup.handling !== 'arcade') return null
      const mode = setup.mode
      if (!isCarId(setup.car) || !isDifficultyId(setup.difficulty) || (setup.laps !== 1 && setup.laps !== 2 && setup.laps !== 3) ||
          (mode !== 'normal' && mode !== 'ghost' && mode !== 'time-trial' && mode !== 'boost-practice') || !isLightingMode(setup.lighting)) return null
      if (mode === 'boost-practice' && !isDriftBoostRules(setup.driftBoostRules)) return null
      return {
        trackId: asTrackId(item.trackId), course: item.course,
        setup: {
          car: setup.car, difficulty: setup.difficulty, laps: setup.laps, mode, lighting: setup.lighting,
          ...(mode === 'boost-practice' ? { driftBoostRules: DRIFT_BOOST_V1_RULES } : {}),
        },
      }
    } catch { return null }
  }

  save(race: LastRace): boolean {
    return this.storage.set(STORAGE_KEYS.lastRace, JSON.stringify({ version: 2, ...race }))
  }
}
