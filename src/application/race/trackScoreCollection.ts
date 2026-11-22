import type { ScoreEntry, ScoreStore } from '@/application/ports/storage'
import { normalizeRouteKind, type Track } from '@/domain/model'

/** One storage lookup per track ID; built-in content takes precedence on ID collisions. */
export function collectTrackScores(
  libraryTracks: readonly Track[],
  officialTracks: readonly Track[],
  store: Pick<ScoreStore, 'forTrack'>,
): Readonly<Record<string, readonly ScoreEntry[]>> {
  const distinct = new Map<string, Track>()
  for (const track of libraryTracks) distinct.set(track.id, track)
  for (const track of officialTracks) distinct.set(track.id, track)

  const scores: Record<string, readonly ScoreEntry[]> = {}
  for (const track of distinct.values()) {
    const route = normalizeRouteKind(track.routeKind)
    scores[track.id] = store.forTrack(track.id).filter(
      score => normalizeRouteKind(score.category?.routeKind) === route,
    )
  }
  return scores
}
