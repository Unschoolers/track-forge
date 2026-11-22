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
import { DEFAULT_PLAYER_IDENTITY, normalizePlayerIdentity, randomPlayerIdentity, type PlayerIdentity } from '@/application/multiplayer/playerIdentity'
import { normalizeCreatorId, normalizeDisplayName } from '@/domain/track/trackCreator'

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
  playerIdentity: DEFAULT_PLAYER_IDENTITY,
  favoriteTrackIds: [],
}

function boolean(value: string | null, fallback: boolean): boolean {
  return value === null ? fallback : value !== '0'
}

function volume(value: string | null, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : fallback
}

/** Corrupt or oversized local preference data must not break the track library. */
function parseFavoriteTrackIds(raw: string | null): readonly string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((id): id is string =>
      typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id,
    ))].slice(0, 256)
  } catch {
    return []
  }
}

/** A single authoritative commit; legacy individual keys are mirrors only. */
const SNAPSHOT_KEYS = [
  STORAGE_KEYS.steeringLayout, STORAGE_KEYS.steeringHand, STORAGE_KEYS.controlSize,
  STORAGE_KEYS.steeringSensitivity, STORAGE_KEYS.car, STORAGE_KEYS.difficulty,
  STORAGE_KEYS.handling, STORAGE_KEYS.raceLaps, STORAGE_KEYS.raceMode,
  STORAGE_KEYS.playerIdentity, STORAGE_KEYS.displayName, STORAGE_KEYS.creatorId,
  STORAGE_KEYS.favoriteTrackIds, STORAGE_KEYS.audio, STORAGE_KEYS.musicVolume,
  STORAGE_KEYS.soundEffectsVolume, STORAGE_KEYS.haptics, STORAGE_KEYS.dynamicZoom,
] as const

function snapshotValues(raw: string | null): Record<string, string> | null {
  if (!raw || raw.length > 16_384) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const envelope = parsed as Record<string, unknown>
    const values = envelope.values
    if (envelope.version !== 1 || !values || typeof values !== 'object' || Array.isArray(values)) return null
    const record = values as Record<string, unknown>
    if (Object.keys(record).length !== SNAPSHOT_KEYS.length ||
      !SNAPSHOT_KEYS.every(key => Object.hasOwn(record, key) &&
        typeof record[key] === 'string' && (record[key] as string).length <= 4096)) return null
    return record as Record<string, string>
  } catch {
    // A corrupt snapshot is not authoritative: older installations remain readable.
    return null
  }
}

export class BrowserPreferencesRepository implements PreferencesStore {
  private firstIdentity: PlayerIdentity | undefined

  constructor(
    private readonly storage: KeyValueStore,
    private readonly createIdentity: () => PlayerIdentity = randomPlayerIdentity,
  ) {}

  load(): Preferences {
    const committed = snapshotValues(this.storage.get(STORAGE_KEYS.preferencesSnapshot))
    const read = (key: string): string | null => committed
      ? committed[key] ?? null : read(key)
    const car = read(STORAGE_KEYS.car)
    const difficulty = read(STORAGE_KEYS.difficulty)
    const handling = read(STORAGE_KEYS.handling)
    const raceLaps = read(STORAGE_KEYS.raceLaps)
    const raceMode = read(STORAGE_KEYS.raceMode)
    const storedIdentity = read(STORAGE_KEYS.playerIdentity)
    let playerIdentity: PlayerIdentity
    if (storedIdentity === null) {
      // Assign once, persist immediately, and keep the same choice this session
      // even if the storage write fails. Existing selections are never rerolled.
      playerIdentity = this.firstIdentity ??= normalizePlayerIdentity(this.createIdentity())
      this.storage.set(STORAGE_KEYS.playerIdentity, JSON.stringify(playerIdentity))
    } else {
      try {
        playerIdentity = normalizePlayerIdentity(JSON.parse(storedIdentity))
      } catch {
        playerIdentity = DEFAULT_PLAYER_IDENTITY
      }
    }
    const steeringSensitivity = read(STORAGE_KEYS.steeringSensitivity)
    const displayName = normalizeDisplayName(read(STORAGE_KEYS.displayName))
    const creatorId = normalizeCreatorId(read(STORAGE_KEYS.creatorId))
    const legacyAudio = boolean(read(STORAGE_KEYS.audio), DEFAULT_PREFERENCES.audioEnabled)
    const musicVolume = volume(read(STORAGE_KEYS.musicVolume), legacyAudio ? DEFAULT_MUSIC_VOLUME : 0)
    const soundEffectsVolume = volume(read(STORAGE_KEYS.soundEffectsVolume), legacyAudio ? DEFAULT_SOUND_EFFECTS_VOLUME : 0)
    return {
      steeringLayout: read(STORAGE_KEYS.steeringLayout) === 'buttons' ? 'buttons' : 'drag',
      steeringHand: read(STORAGE_KEYS.steeringHand) === 'right' ? 'right' : 'left',
      controlSize: read(STORAGE_KEYS.controlSize) === 'large' ? 'large' : 'standard',
      steeringSensitivity: steeringSensitivity === '0.75' ? 0.75 : steeringSensitivity === '1.5' ? 1.5 : 1,
      car: isCarId(car) ? car : DEFAULT_PREFERENCES.car,
      difficulty: isDifficultyId(difficulty)
        ? difficulty
        : DEFAULT_PREFERENCES.difficulty,
      handling: handling === 'simulation' ? 'simulation' : 'arcade',
      raceLaps: raceLaps === '1' ? 1 : raceLaps === '3' ? 3 : 2,
      raceMode: raceMode === 'ghost' || raceMode === 'time-trial' ? raceMode : 'normal',
      playerIdentity,
      favoriteTrackIds: parseFavoriteTrackIds(read(STORAGE_KEYS.favoriteTrackIds)),
      ...(displayName ? { displayName } : {}),
      ...(creatorId ? { creatorId } : {}),
      audioEnabled: soundEffectsVolume > 0,
      musicVolume,
      soundEffectsVolume,
      hapticsEnabled: boolean(
        read(STORAGE_KEYS.haptics),
        DEFAULT_PREFERENCES.hapticsEnabled,
      ),
      dynamicZoomEnabled: boolean(
        read(STORAGE_KEYS.dynamicZoom),
        DEFAULT_PREFERENCES.dynamicZoomEnabled,
      ),
    }
  }

  save(preferences: Preferences): boolean {
    const { musicVolume, soundEffectsVolume } = audioVolumes(preferences)
    const values: Record<string, string> = {
      [STORAGE_KEYS.steeringLayout]: preferences.steeringLayout === 'buttons' ? 'buttons' : 'drag',
      [STORAGE_KEYS.steeringHand]: preferences.steeringHand === 'right' ? 'right' : 'left',
      [STORAGE_KEYS.controlSize]: preferences.controlSize === 'large' ? 'large' : 'standard',
      [STORAGE_KEYS.steeringSensitivity]: String(preferences.steeringSensitivity ?? 1),
      [STORAGE_KEYS.car]: preferences.car,
      [STORAGE_KEYS.difficulty]: preferences.difficulty,
      [STORAGE_KEYS.handling]: preferences.handling === 'simulation' ? 'simulation' : 'arcade',
      [STORAGE_KEYS.raceLaps]: String(preferences.raceLaps === 1 || preferences.raceLaps === 3 ? preferences.raceLaps : 2),
      [STORAGE_KEYS.raceMode]: preferences.raceMode ?? 'normal',
      [STORAGE_KEYS.playerIdentity]: JSON.stringify(normalizePlayerIdentity(preferences.playerIdentity)),
      [STORAGE_KEYS.displayName]: normalizeDisplayName(preferences.displayName) ?? '',
      [STORAGE_KEYS.creatorId]: normalizeCreatorId(preferences.creatorId) ?? '',
      [STORAGE_KEYS.favoriteTrackIds]: JSON.stringify((preferences.favoriteTrackIds ?? []).slice(0, 256)),
      [STORAGE_KEYS.audio]: soundEffectsVolume > 0 ? '1' : '0',
      [STORAGE_KEYS.musicVolume]: String(musicVolume),
      [STORAGE_KEYS.soundEffectsVolume]: String(soundEffectsVolume),
      [STORAGE_KEYS.haptics]: preferences.hapticsEnabled ? '1' : '0',
      [STORAGE_KEYS.dynamicZoom]: preferences.dynamicZoomEnabled ? '1' : '0',
    }
    // A failed authoritative commit leaves every visible preference unchanged.
    if (!this.storage.set(STORAGE_KEYS.preferencesSnapshot,
      JSON.stringify({ version: 1, values }))) return false

    // Keep older builds able to read the last settings where storage allows.
    // Mirror failures cannot corrupt the snapshot used by this build.
    let legacyMirrorFailed = false
    for (const [key, value] of Object.entries(values)) {
      if (!this.storage.set(key, value)) legacyMirrorFailed = true
    }
    if (legacyMirrorFailed) console.warn('Track Forge: legacy preference mirror unavailable; snapshot is saved.')
    return true
  }
}
