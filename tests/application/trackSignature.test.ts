import { expect, it, vi } from 'vitest'
import { parseSharedTrackImport } from '@/application/library/trackImport'
import {
  createTrackSigningKey,
  serializeSignedTrack,
  serializeSignedTrackReply,
} from '@/application/library/trackSignature'
import { asTrackId, type Track } from '@/domain/model'
import { TRACK_EXPORT_FORMAT, TRACK_EXPORT_FORMAT_VERSION } from '@/domain/track/trackCodec'
import { MAX_CREATOR_GHOST_FRAMES } from '@/domain/track/creatorGhostChallenge'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('signed-track'), 1)

it('verifies a signed track and forwards its original file even if the local name changed', async () => {
  const key = await createTrackSigningKey()
  expect(key.privateKey.extractable).toBe(false)
  const file = await serializeSignedTrack(track, async () => key)
  const raw = JSON.parse(file) as { track: Track; signature: object; format: string; formatVersion: number }
  const reordered = JSON.stringify({
    signature: raw.signature, track: raw.track, format: raw.format, formatVersion: raw.formatVersion,
  }, null, 2)
  const result = await parseSharedTrackImport(reordered)
  expect(result).toMatchObject({ ok: true, signedSource: reordered })
  if (!result.ok) throw new Error(result.message)
  expect(result.track.name).toBe(track.name)

  const loadKey = vi.fn(async () => key)
  await expect(serializeSignedTrack({ ...result.track, name: 'Local alias' }, loadKey, result.signedSource))
    .resolves.toBe(reordered)
  expect(loadKey).not.toHaveBeenCalled()
})

it('rejects edits to the signed payload, stripped signatures in v2 and signature-bearing v1 files', async () => {
  const file = await serializeSignedTrack(track, createTrackSigningKey)
  const raw = JSON.parse(file) as { track: Track; signature: object; format: string; formatVersion: number }
  const { signature: _signature, ...unsigned } = raw
  for (const edited of [
    { ...raw, track: { ...raw.track, name: 'Changed track' } },
    { ...raw, track: { ...raw.track, trees: [{ x: 7, y: 5 }] } },
    unsigned,
    { ...raw, formatVersion: TRACK_EXPORT_FORMAT_VERSION },
  ]) {
    await expect(parseSharedTrackImport(JSON.stringify(edited))).resolves.toMatchObject({ ok: false })
  }
})

it('accepts unsigned legacy files and ignores provenance fields supplied inside the track payload', async () => {
  const legacy = JSON.stringify({
    format: TRACK_EXPORT_FORMAT, formatVersion: TRACK_EXPORT_FORMAT_VERSION,
    track: { ...track, signedSource: 'untrusted' },
  })
  const result = await parseSharedTrackImport(legacy)
  expect(result).toMatchObject({ ok: true })
  expect(result).not.toHaveProperty('signedSource')
  expect(result).not.toHaveProperty('track.signedSource')
})

it('signs creator replay metadata as part of the track payload', async () => {
  const key = await createTrackSigningKey()
  const creatorChallenge = { car: 'red' as const, laps: 1 as const, time: 1, frames: [
    { t: 0, x: 0, y: 0, angle: 0, z: 0, structureRunId: null },
    { t: 1, x: 1, y: 1, angle: 0, z: 0, structureRunId: null },
  ] }
  const file = await serializeSignedTrack({ ...track, creatorChallenge }, async () => key)
  const raw = JSON.parse(file) as { track: Track & { creatorChallenge: typeof creatorChallenge } }
  expect(raw.track.creatorChallenge).toEqual(creatorChallenge)
  expect(await parseSharedTrackImport(file)).toMatchObject({ ok: true })
  const tampered = JSON.stringify({ ...JSON.parse(file), track: {
    ...raw.track, creatorChallenge: { ...creatorChallenge, frames: [
      ...creatorChallenge.frames.slice(0, 1), { ...creatorChallenge.frames[1], x: 99 },
    ] },
  } })
  await expect(parseSharedTrackImport(tampered)).resolves.toMatchObject({ ok: false })
})

it('rejects a correctly signed v2 payload with oversized replay metadata', async () => {
  const frames = Array.from({ length: MAX_CREATOR_GHOST_FRAMES + 1 }, (_, t) => ({
    t, x: 0, y: 0, angle: 0, z: 0, structureRunId: null,
  }))
  const oversized = { car: 'blue' as const, laps: 1 as const, time: MAX_CREATOR_GHOST_FRAMES, frames }
  const file = await serializeSignedTrack({ ...track, creatorChallenge: oversized }, createTrackSigningKey)
  await expect(parseSharedTrackImport(file)).resolves.toMatchObject({ ok: false })
})

it('signs Send Back replies over the canonical creator file and keeps reply chains flat', async () => {
  const creatorKey = await createTrackSigningKey()
  const responderKey = await createTrackSigningKey()
  const originalChallenge = { car: 'blue' as const, laps: 1 as const, time: 2, frames: [
    { t: 0, x: 0, y: 0, angle: 0, z: 0, structureRunId: null },
    { t: 2, x: 2, y: 0, angle: 0, z: 0, structureRunId: null },
  ] }
  const replyChallenge = { car: 'green' as const, laps: 1 as const, time: 3, frames: [
    { t: 0, x: 0, y: 0, angle: 0, z: 0, structureRunId: null },
    { t: 3, x: 3, y: 0, angle: 0, z: 0, structureRunId: null },
  ] }
  const original = await serializeSignedTrack({ ...track, creatorChallenge: originalChallenge }, async () => creatorKey)
  const reply = await serializeSignedTrackReply(original, replyChallenge, async () => responderKey)
  const imported = await parseSharedTrackImport(reply)
  expect(imported).toMatchObject({ ok: true, signedSource: original, signedChallengeSource: reply,
    track: { creatorChallenge: replyChallenge } })
  if (!imported.ok || !imported.signedSource) throw new Error('Signed reply failed to import.')
  const canonical = await parseSharedTrackImport(imported.signedSource)
  expect(canonical.ok && canonical.track.creatorChallenge).toEqual(originalChallenge)

  const raw = JSON.parse(reply) as Record<string, unknown>
  const changedReply = JSON.stringify({ ...raw, creatorChallenge: {
    ...replyChallenge,
    frames: [...replyChallenge.frames.slice(0, 1), { ...replyChallenge.frames[1], x: 9 }],
  } })
  await expect(parseSharedTrackImport(changedReply)).resolves.toMatchObject({ ok: false })

  const secondReply = await serializeSignedTrackReply(imported.signedSource, originalChallenge, async () => responderKey)
  const second = JSON.parse(secondReply) as Record<string, unknown>
  expect(second.original).toBe(original)
  expect(typeof second.original).toBe('string')
  expect(second.original).not.toContain('trackforge-track-reply')
})

it('uses a distinct signed version for jump tracks and rejects a legacy version downgrade', async () => {
  const jumpTrack: Track = { ...track, points: track.points.map((point, index) =>
    index === 2 ? { ...point, structure: 'jump' } : point) }
  const file = await serializeSignedTrack(jumpTrack, createTrackSigningKey)
  const raw = JSON.parse(file) as { track: Track; format: string; formatVersion: number }
  expect(raw.formatVersion).toBe(4)
  const parsed = await parseSharedTrackImport(file)
  expect(parsed.ok && parsed.track.points[2]?.structure).toBe('jump')
  await expect(parseSharedTrackImport(JSON.stringify({ ...raw, formatVersion: 2 }))).resolves.toMatchObject({ ok: false })
  await expect(parseSharedTrackImport(JSON.stringify({ format: TRACK_EXPORT_FORMAT, formatVersion: 1, track: jumpTrack }))).resolves.toMatchObject({ ok: false })
  await expect(parseSharedTrackImport(JSON.stringify({ format: TRACK_EXPORT_FORMAT, formatVersion: 3, track: jumpTrack }))).resolves.toMatchObject({ ok: true })
})
