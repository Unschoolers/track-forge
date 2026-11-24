import { asTrackId, type Track } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { SYSTEM_STARTER_TRACK_ID } from '@/domain/track/trackCreator'

const legacy = createStarterTrack(asTrackId(SYSTEM_STARTER_TRACK_ID), 0)

/**
 * An old bundled starter is removable only when all user-editable content
 * still matches the original. Race identity intentionally omits cosmetic
 * fields and must never be used to decide whether to delete user data.
 */
export function isUntouchedLegacyStarter(track: Track): boolean {
  if (track.name !== legacy.name ||
      (track.id !== SYSTEM_STARTER_TRACK_ID && !track.id.startsWith('starter-')) ||
      track.version !== legacy.version ||
      track.routeKind !== legacy.routeKind ||
      track.lighting !== legacy.lighting ||
      track.environmentId !== legacy.environmentId ||
      track.recoveryCheckpoints !== undefined ||
      track.autoCheckpoints !== undefined) return false

  return JSON.stringify([
    track.points, track.trees, track.terrain, track.start, track.scenery ?? [],
  ]) === JSON.stringify([
    legacy.points, legacy.trees, legacy.terrain, legacy.start, legacy.scenery ?? [],
  ])
}
