/**
 * TEMPORARY ONE-TIME RELEASE MIGRATION — DELETE AFTER THE MIGRATION WINDOW.
 *
 * Cleanup: remove this module, the single import + invocation in main.ts,
 * and its focused regression test. The marker is intentionally private to
 * this file. Keep permanent creator ownership and sharing rules elsewhere.
 */
import type { KeyValueStore, PreferencesStore, TrackStore } from '@/application/ports/storage'
import { courseIdentity } from '@/application/race/raceRecords'
import { asTrackId, type Track } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { SYSTEM_STARTER_TRACK_ID, TRACK_FORGE_CREATOR } from '@/domain/track/trackCreator'

const MIGRATION_MARKER = 'trackforge-creator-migration-v1'

const { recoveryCheckpoints: _unusedMarkers, autoCheckpoints: _unusedAuto, ...legacyStarter } =
  createStarterTrack(asTrackId(SYSTEM_STARTER_TRACK_ID), 0)
void _unusedMarkers
void _unusedAuto
const originalStarterSignature = courseIdentity(legacyStarter)

function isLegacyBuiltInStarter(track: Track): boolean {
  // Pre-credit starter tracks had a random "starter-..." ID. Identify only
  // unchanged originals; customized versions belong to the player.
  return !track.origin && !track.creator &&
    track.id.startsWith('starter-') &&
    courseIdentity(track) === originalStarterSignature
}

function isBuiltIn(track: Track): boolean {
  return track.origin === 'seeded' ||
    track.creator?.id === TRACK_FORGE_CREATOR.id ||
    track.id === SYSTEM_STARTER_TRACK_ID ||
    track.id.startsWith('official-') ||
    isLegacyBuiltInStarter(track)
}

/**
 * Execute once on startup before the controller loads the library.
 * Preserve IDs, geometry, timestamps, race revisions, highscores and ghosts.
 */
export function migrateTrackCreatorCredits(
  storage: KeyValueStore,
  tracks: TrackStore,
  preferences: PreferencesStore,
  createId: () => string = () => crypto.randomUUID(),
): { readonly ok: boolean; readonly changed: number } {
  if (storage.get(MIGRATION_MARKER) === '1') return { ok: true, changed: 0 }

  const profile = preferences.load()
  const id = profile.creatorId ?? createId()
  // Create the stable ID before the name prompt, so no second migration run
  // is required when the player picks their name.
  if (!profile.creatorId && !preferences.save({ ...profile, creatorId: id })) {
    return { ok: false, changed: 0 }
  }

  const creator = { id, name: profile.displayName ?? 'Player' }
  const updated: Track[] = []
  for (const track of tracks.list()) {
    if (isBuiltIn(track)) {
      if (track.origin !== 'seeded' || track.creator?.id !== TRACK_FORGE_CREATOR.id ||
        track.creator.name !== TRACK_FORGE_CREATOR.name) {
        updated.push({ ...track, origin: 'seeded', creator: TRACK_FORGE_CREATOR })
      }
    } else if (!track.creator) {
      // All other previously uncredited saved tracks are the local player's,
      // per the release migration contract (even legacy uncredited imports).
      updated.push({ ...track, origin: 'local', creator })
    }
  }

  // One library write; never mark completed if persistence fails.
  if (updated.length && (!tracks.saveMany || !tracks.saveMany(updated))) {
    return { ok: false, changed: 0 }
  }
  if (!storage.set(MIGRATION_MARKER, '1')) return { ok: false, changed: updated.length }
  return { ok: true, changed: updated.length }
}
