import { Capacitor, registerPlugin } from '@capacitor/core'
import type { CreatorGhostChallenge, Track } from '@/domain/model'
import { isSeededTrack } from '@/domain/track/trackCreator'
import { MAX_TRACK_EXPORT_CHARS, TRACK_EXPORT_FORMAT, trackExportFormatVersion } from '@/domain/track/trackCodec'
import { decodeCreatorGhostChallenge } from '@/domain/track/creatorGhostChallenge'
import {
  serializeSignedTrack,
  serializeSignedTrackReply,
  verifySignedTrackReply,
} from '@/application/library/trackSignature'
import { getTrackSigningKeys } from '@/infrastructure/storage/trackSigningKeyStore'

export const TRACK_FILE_MIME_TYPE = 'application/vnd.trackforge.track+json'

export type IncomingTrackFile =
  | { readonly pending: false }
  | { readonly pending: true; readonly content: string }
  | { readonly pending: true; readonly error: string }

const nativeExporter = registerPlugin<{
  save(options: { filename: string; content: string }): Promise<{ saved: boolean }>
  share(options: { filename: string; content: string; text?: string }): Promise<{ shared: boolean }>
  consumeIncomingTrack(): Promise<IncomingTrackFile>
}>('TrackExport')
function trackFilename(track: Track): string {
  const name = track.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'track'
  return `${name}.trackforge`
}

export function serializeTrack(track: Track): { filename: string; content: string } {
  const legacyTrack = { ...track }
  delete legacyTrack.signedSource
  delete legacyTrack.signedChallengeSource
  delete legacyTrack.creatorChallenge
  const content = JSON.stringify({ format: TRACK_EXPORT_FORMAT, formatVersion: trackExportFormatVersion(legacyTrack),
    track: legacyTrack })
  return {
    filename: trackFilename(track),
    content,
  }
}

export async function serializeSharedTrack(track: Track, creatorChallenge?: CreatorGhostChallenge): Promise<string> {
  const challenge = creatorChallenge === undefined ? undefined : decodeCreatorGhostChallenge(creatorChallenge)
  if (creatorChallenge !== undefined && !challenge) throw new Error('Creator ghost challenge is invalid or oversized.')

  if (challenge && track.signedSource) {
    const content = await serializeSignedTrackReply(track.signedSource, challenge, getTrackSigningKeys)
    if (content.length > MAX_TRACK_EXPORT_CHARS) throw new Error('Track and creator ghost challenge are too large to share together.')
    return content
  }
  if (!challenge && track.signedChallengeSource) {
    let parsed: unknown
    try { parsed = JSON.parse(track.signedChallengeSource) as unknown }
    catch { throw new Error('The original track reply signature is invalid.') }
    const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined
    if (track.signedSource && envelope?.original === track.signedSource &&
        envelope.format === 'trackforge-track-reply' && await verifySignedTrackReply(envelope)) {
      if (track.signedChallengeSource.length > MAX_TRACK_EXPORT_CHARS) {
        throw new Error('Track and creator ghost challenge are too large to share together.')
      }
      return track.signedChallengeSource
    }
    throw new Error('The original track reply signature is invalid.')
  }

  const authoredTrack = { ...track }
  delete authoredTrack.signedSource
  delete authoredTrack.signedChallengeSource
  if (challenge) authoredTrack.creatorChallenge = challenge
  const content = await serializeSignedTrack(authoredTrack, getTrackSigningKeys, challenge ? undefined : track.signedSource)
  if (content.length > MAX_TRACK_EXPORT_CHARS) throw new Error('Track export is too large to import safely.')
  return content
}

export async function exportTrack(track: Track, creatorChallenge?: CreatorGhostChallenge): Promise<boolean> {
  return saveJsonFile({ filename: trackFilename(track), content: await serializeSharedTrack(track, creatorChallenge) })
}

export async function consumeIncomingTrack(): Promise<IncomingTrackFile> {
  if (!Capacitor.isNativePlatform()) return { pending: false }
  return nativeExporter.consumeIncomingTrack()
}

export async function saveJsonFile(file: { filename: string; content: string }): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return (await nativeExporter.save(file)).saved
  const url = URL.createObjectURL(new Blob([file.content], { type: TRACK_FILE_MIME_TYPE }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

/** Returns false when sharing is unavailable so the caller can offer a file export. */
export async function shareTrack(track: Track, text?: string, creatorChallenge?: CreatorGhostChallenge): Promise<boolean> {
  if (isSeededTrack(track)) throw new Error('Built-in tracks cannot be shared.')
  const file = { filename: trackFilename(track), content: await serializeSharedTrack(track, creatorChallenge) }
  if (Capacitor.isNativePlatform()) return (await nativeExporter.share({ ...file, ...(text === undefined ? {} : { text }) })).shared
  const attachment = new File([file.content], file.filename, { type: TRACK_FILE_MIME_TYPE })
  try {
    if (!navigator.share || !navigator.canShare?.({ files: [attachment] })) return false
    await navigator.share({ title: 'Track Forge challenge', ...(text === undefined ? {} : { text }), files: [attachment] })
    return true
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError'
  }
}
