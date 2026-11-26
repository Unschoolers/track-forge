import type { Track } from '@/domain/model'

export const SHARED_TRACK_READ_ONLY_MESSAGE = 'Shared track is read-only. Save as a new track to edit.'

export function isSharedTrack(track: Pick<Track, 'origin'> | null | undefined): boolean {
  return track?.origin === 'imported'
}
