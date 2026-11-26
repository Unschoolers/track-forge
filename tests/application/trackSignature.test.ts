import { expect, it, vi } from 'vitest'
import { parseSharedTrackImport } from '@/application/library/trackImport'
import { createTrackSigningKey, serializeSignedTrack } from '@/application/library/trackSignature'
import { asTrackId, type Track } from '@/domain/model'
import { TRACK_EXPORT_FORMAT, TRACK_EXPORT_FORMAT_VERSION } from '@/domain/track/trackCodec'
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
