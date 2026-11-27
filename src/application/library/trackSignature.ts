import type { Track } from '@/domain/model'
import { MAX_TRACK_EXPORT_CHARS, TRACK_EXPORT_FORMAT, trackHasJumpRamps } from '@/domain/track/trackCodec'
import { decodeCreatorGhostChallenge } from '@/domain/track/creatorGhostChallenge'

export const SIGNED_TRACK_FORMAT_VERSION = 2
export const SIGNED_JUMP_TRACK_FORMAT_VERSION = 4
export const SIGNED_TRACK_REPLY_FORMAT = 'trackforge-track-reply'
export const SIGNED_TRACK_REPLY_FORMAT_VERSION = 1
const ALGORITHM = 'ECDSA-P256-SHA256'
const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' }

export function createTrackSigningKey(): Promise<CryptoKeyPair> {
  // Web Crypto always makes the public half exportable.
  return crypto.subtle.generateKey(KEY_ALGORITHM, false, ['sign', 'verify'])
}

function trackEnvelope(track: unknown) {
  return { format: TRACK_EXPORT_FORMAT, formatVersion: trackHasJumpRamps(track) ? SIGNED_JUMP_TRACK_FORMAT_VERSION : SIGNED_TRACK_FORMAT_VERSION, track }
}

function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(value, (_key, nested: unknown) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested
    const object = nested as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]))
  })
  return new TextEncoder().encode(json)
}

function signingBytes(track: unknown): Uint8Array<ArrayBuffer> {
  return canonicalBytes(trackEnvelope(track))
}

function encodeBytes(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function decodeBytes(value: unknown, length: number): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || value.length !== Math.ceil(length / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  return bytes.length === length && encodeBytes(bytes.buffer) === value ? bytes : null
}

/** Verifies the received data before the import codec normalizes or assigns local IDs. */
export async function verifyTrackSignature(envelope: Record<string, unknown>): Promise<boolean> {
  if (envelope.format !== TRACK_EXPORT_FORMAT || envelope.formatVersion !== trackEnvelope(envelope.track).formatVersion ||
      Object.keys(envelope).length !== 4 || !envelope.track) return false
  const raw = envelope.signature
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const signature = raw as Record<string, unknown>
  if (Object.keys(signature).length !== 3 || signature.algorithm !== ALGORITHM) return false
  try {
    const publicKey = decodeBytes(signature.publicKey, 65)
    const value = decodeBytes(signature.value, 64)
    if (!publicKey || !value) return false
    const key = await crypto.subtle.importKey('raw', publicKey, KEY_ALGORITHM, false, ['verify'])
    return await crypto.subtle.verify(SIGN_ALGORITHM, key, value, signingBytes(envelope.track))
  } catch {
    // Invalid encoding, invalid curve points and oversized nesting are rejected.
    return false
  }
}

export async function verifySignedTrackReply(envelope: Record<string, unknown>): Promise<boolean> {
  if (envelope.format !== SIGNED_TRACK_REPLY_FORMAT ||
      envelope.formatVersion !== SIGNED_TRACK_REPLY_FORMAT_VERSION || Object.keys(envelope).length !== 5 ||
      typeof envelope.original !== 'string' || envelope.original.length > MAX_TRACK_EXPORT_CHARS ||
      !decodeCreatorGhostChallenge(envelope.creatorChallenge)) return false
  try {
    const original: unknown = JSON.parse(envelope.original)
    if (!original || typeof original !== 'object' || Array.isArray(original) ||
        !await verifyTrackSignature(original as Record<string, unknown>)) return false
    const raw = envelope.signature
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    const signature = raw as Record<string, unknown>
    if (Object.keys(signature).length !== 3 || signature.algorithm !== ALGORITHM) return false
    const publicKey = decodeBytes(signature.publicKey, 65)
    const value = decodeBytes(signature.value, 64)
    if (!publicKey || !value) return false
    const key = await crypto.subtle.importKey('raw', publicKey, KEY_ALGORITHM, false, ['verify'])
    const signedPayload = {
      format: SIGNED_TRACK_REPLY_FORMAT,
      formatVersion: SIGNED_TRACK_REPLY_FORMAT_VERSION,
      original: envelope.original,
      creatorChallenge: envelope.creatorChallenge,
    }
    return await crypto.subtle.verify(SIGN_ALGORITHM, key, value, canonicalBytes(signedPayload))
  } catch {
    return false
  }
}

export async function serializeSignedTrackReply(
  signedSource: string, creatorChallenge: unknown, getKeys: () => Promise<CryptoKeyPair>,
): Promise<string> {
  const challenge = decodeCreatorGhostChallenge(creatorChallenge)
  let original: unknown
  try { original = JSON.parse(signedSource) as unknown }
  catch { throw new Error('The original track signature is invalid.') }
  if (!challenge || signedSource.length > MAX_TRACK_EXPORT_CHARS || !original || typeof original !== 'object' ||
      Array.isArray(original) || !await verifyTrackSignature(original as Record<string, unknown>)) {
    throw new Error('The original track signature is invalid.')
  }
  const signedPayload = {
    format: SIGNED_TRACK_REPLY_FORMAT,
    formatVersion: SIGNED_TRACK_REPLY_FORMAT_VERSION,
    original: signedSource,
    creatorChallenge: challenge,
  }
  const keys = await getKeys()
  const [publicKey, value] = await Promise.all([
    crypto.subtle.exportKey('raw', keys.publicKey),
    crypto.subtle.sign(SIGN_ALGORITHM, keys.privateKey, canonicalBytes(signedPayload)),
  ])
  return JSON.stringify({
    ...signedPayload,
    signature: { algorithm: ALGORITHM, publicKey: encodeBytes(publicKey), value: encodeBytes(value) },
  })
}

export async function serializeSignedTrack(
  track: Track, getKeys: () => Promise<CryptoKeyPair>, signedSource?: string,
): Promise<string> {
  if (signedSource !== undefined) {
    const source: unknown = JSON.parse(signedSource)
    if (source && typeof source === 'object' && !Array.isArray(source) &&
        await verifyTrackSignature(source as Record<string, unknown>)) {
      return signedSource
    }
    throw new Error('The original track signature is invalid.')
  }
  // Snapshot once so the envelope and signed bytes use the same authored data.
  const authoredTrack: unknown = JSON.parse(JSON.stringify(track))
  const keys = await getKeys()
  const [publicKey, value] = await Promise.all([
    crypto.subtle.exportKey('raw', keys.publicKey),
    crypto.subtle.sign(SIGN_ALGORITHM, keys.privateKey, signingBytes(authoredTrack)),
  ])
  return JSON.stringify({
    ...trackEnvelope(authoredTrack),
    signature: { algorithm: ALGORITHM, publicKey: encodeBytes(publicKey), value: encodeBytes(value) },
  })
}
