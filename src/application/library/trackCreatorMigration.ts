import type { KeyValueStore, PreferencesStore, TrackStore } from '@/application/ports/storage'
import { courseIdentity } from '@/application/race/raceRecords'
import { asTrackId, type Track } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { isSeededTrack, SYSTEM_STARTER_TRACK_ID, TRACK_FORGE_CREATOR } from '@/domain/track/trackCreator'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

const legacyStarterSignature = courseIdentity(createStarterTrack(asTrackId(SYSTEM_STARTER_TRACK_ID), 0))

function isOriginalLegacyStarter(track: Track): boolean {
  return track.origin === undefined &&
    track.id.startsWith('starter-') &&
    courseIdentity(track) === legacyStarterSignature
}

/**
 * Run at application startup, before building AppController, exactly once per
 * local storage installation. Existing track and score IDs remain unchanged.
 */
export function migrateTrackCreatorCredits(
  storage: KeyValueStore,
  tracks: TrackStore,
  preferences: PreferencesStore,
  createId: () => string = () => crypto.randomUUID(),
): { readonly ok: boolean; readonly changed: number } {
  if (storage.get(STORAGE_KEYS.creatorMigration) === '1') return { ok: true, changed: 0 }
  const profile = preferences.load()
  const id = profile.creatorId ?? createId()
  if (!profile.creatorId && !preferences.save({ ...profile, creatorId: id })) {
    return { ok: false, changed: 0 }
  }
  const creator = { id, name: profile.displayName ?? 'Player' }
  const updated: Track[] = []
  for (const track of tracks.list()) {
    // Older starter tracks had random IDs; preserve them for scores and ghosts.
    // An edited historical starter is a user's creation, not a built-in.
    const seeded = track.origin === 'seeded' || track.creator?.id === TRACK_FORGE_CREATOR.id ||
      (isSeededTrack(track) && (!track.id.startsWith('starter-') || isOriginalLegacyStarter(track)))
    if (seeded) {
      if (track.origin !== 'seeded' || track.creator?.id !== TRACK_FORGE_CREATOR.id ||
        track.creator.name !== TRACK_FORGE_CREATOR.name) {
        updated.push({ ...track, origin: 'seeded', creator: TRACK_FORGE_CREATOR })
      }
    } else if (!track.creator && track.origin !== 'imported') {
      updated.push({ ...track, origin: 'local', creator })
    }
  }
  if (updated.length) {
    if (!tracks.saveMany || !tracks.saveMany(updated)) return { ok: false, changed: 0 }
  }
  return storage.set(STORAGE_KEYS.creatorMigration, '1')
    ? { ok: true, changed: updated.length }
    : { ok: false, changed: updated.length }
}
