import type { KeyValueStore, LastRace, LastRaceStore } from '@/application/ports/storage'
import { asTrackId, isCarId, isDifficultyId, isLightingMode } from '@/domain/model'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

export class BrowserLastRaceRepository implements LastRaceStore {
  constructor(private readonly storage: KeyValueStore) {}

  load(): LastRace | null {
    try {
      const value: unknown = JSON.parse(this.storage.get(STORAGE_KEYS.lastRace) ?? 'null')
      if (!value || typeof value !== 'object') return null
      const item = value as Record<string, unknown>
      if (item.version !== 1 || typeof item.trackId !== 'string' || !item.trackId || typeof item.course !== 'string' || !item.course || !item.setup || typeof item.setup !== 'object') return null
      const setup = item.setup as Record<string, unknown>
      if (!isCarId(setup.car) || !isDifficultyId(setup.difficulty) || (setup.laps !== 1 && setup.laps !== 2 && setup.laps !== 3) || (setup.handling !== 'arcade' && setup.handling !== 'simulation') || (setup.mode !== 'normal' && setup.mode !== 'ghost') || !isLightingMode(setup.lighting)) return null
      return { trackId: asTrackId(item.trackId), course: item.course, setup: { car: setup.car, difficulty: setup.difficulty, laps: setup.laps, handling: setup.handling, mode: setup.mode, lighting: setup.lighting } }
    } catch { return null }
  }

  save(race: LastRace): boolean {
    return this.storage.set(STORAGE_KEYS.lastRace, JSON.stringify({ version: 1, ...race }))
  }
}
