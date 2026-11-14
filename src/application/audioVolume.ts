import type { Preferences } from '@/application/ports/storage'

export const DEFAULT_MUSIC_VOLUME = 35
export const DEFAULT_SOUND_EFFECTS_VOLUME = 100

export type AudioVolumeSetting = 'musicVolume' | 'soundEffectsVolume'

export function audioVolumes(preferences: Preferences): Record<AudioVolumeSetting, number> {
  return {
    musicVolume: preferences.musicVolume ?? (preferences.audioEnabled ? DEFAULT_MUSIC_VOLUME : 0),
    soundEffectsVolume: preferences.soundEffectsVolume ?? (preferences.audioEnabled ? DEFAULT_SOUND_EFFECTS_VOLUME : 0),
  }
}
