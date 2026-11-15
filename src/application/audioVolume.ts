import type { Preferences } from '@/application/ports/storage'
import { clamp } from '@/domain/geometry/math'

export const DEFAULT_MUSIC_VOLUME = 35
export const DEFAULT_SOUND_EFFECTS_VOLUME = 100

export type AudioVolumeSetting = 'musicVolume' | 'soundEffectsVolume'

export function audioVolumes(preferences: Preferences): Record<AudioVolumeSetting, number> {
  return {
    musicVolume: preferences.musicVolume ?? (preferences.audioEnabled ? DEFAULT_MUSIC_VOLUME : 0),
    soundEffectsVolume: preferences.soundEffectsVolume ?? (preferences.audioEnabled ? DEFAULT_SOUND_EFFECTS_VOLUME : 0),
  }
}

/** Leave headroom for gameplay cues while giving the lower slider range finer control. */
export function musicGain(percent: number): number {
  return 0.7 * clamp(percent / 100, 0, 1) ** 1.6
}
