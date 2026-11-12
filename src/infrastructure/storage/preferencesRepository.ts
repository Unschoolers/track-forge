import type {
  KeyValueStore,
  Preferences,
  PreferencesStore,
} from '@/application/ports/storage'
import {
  isCarId,
  isDifficultyId,
  isLightingMode,
} from '@/domain/model'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

export const DEFAULT_PREFERENCES: Preferences = {
  car: 'blue',
  difficulty: 'normal',
  lighting: 'day',
  audioEnabled: true,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
  steeringSensitivity: 1,
  handling: 'arcade',
  raceLaps: 2,
  raceMode: 'normal',
}

function boolean(value: string | null, fallback: boolean): boolean {
  return value === null ? fallback : value !== '0'
}

export class BrowserPreferencesRepository implements PreferencesStore {
  constructor(private readonly storage: KeyValueStore) {}

  load(): Preferences {
    const car = this.storage.get(STORAGE_KEYS.car)
    const difficulty = this.storage.get(STORAGE_KEYS.difficulty)
    const lighting = this.storage.get(STORAGE_KEYS.lighting)
    const handling = this.storage.get(STORAGE_KEYS.handling)
    const raceLaps = this.storage.get(STORAGE_KEYS.raceLaps)
    const steeringSensitivity = this.storage.get(STORAGE_KEYS.steeringSensitivity)
    return {
      steeringSensitivity: steeringSensitivity === '0.75' ? 0.75 : steeringSensitivity === '1.5' ? 1.5 : 1,
      car: isCarId(car) ? car : DEFAULT_PREFERENCES.car,
      difficulty: isDifficultyId(difficulty)
        ? difficulty
        : DEFAULT_PREFERENCES.difficulty,
      handling: handling === 'simulation' ? 'simulation' : 'arcade',
      raceLaps: raceLaps === '1' ? 1 : raceLaps === '3' ? 3 : 2,
      raceMode: this.storage.get(STORAGE_KEYS.raceMode) === 'ghost' ? 'ghost' : 'normal',
      lighting: isLightingMode(lighting)
        ? lighting
        : DEFAULT_PREFERENCES.lighting,
      audioEnabled: boolean(
        this.storage.get(STORAGE_KEYS.audio),
        DEFAULT_PREFERENCES.audioEnabled,
      ),
      hapticsEnabled: boolean(
        this.storage.get(STORAGE_KEYS.haptics),
        DEFAULT_PREFERENCES.hapticsEnabled,
      ),
      dynamicZoomEnabled: boolean(
        this.storage.get(STORAGE_KEYS.dynamicZoom),
        DEFAULT_PREFERENCES.dynamicZoomEnabled,
      ),
    }
  }

  save(preferences: Preferences): boolean {
    const writes = [
      this.storage.set(STORAGE_KEYS.steeringSensitivity, String(preferences.steeringSensitivity ?? 1)),
      this.storage.set(STORAGE_KEYS.car, preferences.car),
      this.storage.set(STORAGE_KEYS.difficulty, preferences.difficulty),
      this.storage.set(STORAGE_KEYS.lighting, preferences.lighting),
      this.storage.set(STORAGE_KEYS.handling, preferences.handling === 'simulation' ? 'simulation' : 'arcade'),
      this.storage.set(STORAGE_KEYS.raceLaps, String(preferences.raceLaps === 1 || preferences.raceLaps === 3 ? preferences.raceLaps : 2)),
      this.storage.set(STORAGE_KEYS.raceMode, preferences.raceMode === 'ghost' ? 'ghost' : 'normal'),
      this.storage.set(
        STORAGE_KEYS.audio,
        preferences.audioEnabled ? '1' : '0',
      ),
      this.storage.set(
        STORAGE_KEYS.haptics,
        preferences.hapticsEnabled ? '1' : '0',
      ),
      this.storage.set(
        STORAGE_KEYS.dynamicZoom,
        preferences.dynamicZoomEnabled ? '1' : '0',
      ),
    ]
    return writes.every(Boolean)
  }
}
