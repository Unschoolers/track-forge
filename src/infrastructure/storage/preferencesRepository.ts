import type {
  KeyValueStore,
  Preferences,
  PreferencesStore,
} from '@/application/ports/storage'
import { audioVolumes, DEFAULT_MUSIC_VOLUME, DEFAULT_SOUND_EFFECTS_VOLUME } from '@/application/audioVolume'
import {
  isCarId,
  isDifficultyId,
} from '@/domain/model'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

export const DEFAULT_PREFERENCES: Preferences = {
  car: 'blue',
  difficulty: 'normal',
  audioEnabled: true,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  soundEffectsVolume: DEFAULT_SOUND_EFFECTS_VOLUME,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
  steeringLayout: 'drag',
  steeringHand: 'left',
  controlSize: 'standard',
  steeringSensitivity: 1,
  handling: 'arcade',
  raceLaps: 2,
  raceMode: 'normal',
}

function boolean(value: string | null, fallback: boolean): boolean {
  return value === null ? fallback : value !== '0'
}

function volume(value: string | null, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : fallback
}

export class BrowserPreferencesRepository implements PreferencesStore {
  constructor(private readonly storage: KeyValueStore) {}

  load(): Preferences {
    const car = this.storage.get(STORAGE_KEYS.car)
    const difficulty = this.storage.get(STORAGE_KEYS.difficulty)
    const handling = this.storage.get(STORAGE_KEYS.handling)
    const raceLaps = this.storage.get(STORAGE_KEYS.raceLaps)
    const steeringSensitivity = this.storage.get(STORAGE_KEYS.steeringSensitivity)
    const legacyAudio = boolean(this.storage.get(STORAGE_KEYS.audio), DEFAULT_PREFERENCES.audioEnabled)
    const musicVolume = volume(this.storage.get(STORAGE_KEYS.musicVolume), legacyAudio ? DEFAULT_MUSIC_VOLUME : 0)
    const soundEffectsVolume = volume(this.storage.get(STORAGE_KEYS.soundEffectsVolume), legacyAudio ? DEFAULT_SOUND_EFFECTS_VOLUME : 0)
    return {
      steeringLayout: this.storage.get(STORAGE_KEYS.steeringLayout) === 'buttons' ? 'buttons' : 'drag',
      steeringHand: this.storage.get(STORAGE_KEYS.steeringHand) === 'right' ? 'right' : 'left',
      controlSize: this.storage.get(STORAGE_KEYS.controlSize) === 'large' ? 'large' : 'standard',
      steeringSensitivity: steeringSensitivity === '0.75' ? 0.75 : steeringSensitivity === '1.5' ? 1.5 : 1,
      car: isCarId(car) ? car : DEFAULT_PREFERENCES.car,
      difficulty: isDifficultyId(difficulty)
        ? difficulty
        : DEFAULT_PREFERENCES.difficulty,
      handling: handling === 'simulation' ? 'simulation' : 'arcade',
      raceLaps: raceLaps === '1' ? 1 : raceLaps === '3' ? 3 : 2,
      raceMode: this.storage.get(STORAGE_KEYS.raceMode) === 'ghost' ? 'ghost' : 'normal',
      audioEnabled: soundEffectsVolume > 0,
      musicVolume,
      soundEffectsVolume,
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
    const { musicVolume, soundEffectsVolume } = audioVolumes(preferences)
    const writes = [
      this.storage.set(STORAGE_KEYS.steeringLayout, preferences.steeringLayout === 'buttons' ? 'buttons' : 'drag'),
      this.storage.set(STORAGE_KEYS.steeringHand, preferences.steeringHand === 'right' ? 'right' : 'left'),
      this.storage.set(STORAGE_KEYS.controlSize, preferences.controlSize === 'large' ? 'large' : 'standard'),
      this.storage.set(STORAGE_KEYS.steeringSensitivity, String(preferences.steeringSensitivity ?? 1)),
      this.storage.set(STORAGE_KEYS.car, preferences.car),
      this.storage.set(STORAGE_KEYS.difficulty, preferences.difficulty),
      this.storage.set(STORAGE_KEYS.handling, preferences.handling === 'simulation' ? 'simulation' : 'arcade'),
      this.storage.set(STORAGE_KEYS.raceLaps, String(preferences.raceLaps === 1 || preferences.raceLaps === 3 ? preferences.raceLaps : 2)),
      this.storage.set(STORAGE_KEYS.raceMode, preferences.raceMode === 'ghost' ? 'ghost' : 'normal'),
      this.storage.set(STORAGE_KEYS.audio, soundEffectsVolume > 0 ? '1' : '0'),
      this.storage.set(STORAGE_KEYS.musicVolume, String(musicVolume)),
      this.storage.set(STORAGE_KEYS.soundEffectsVolume, String(soundEffectsVolume)),
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
