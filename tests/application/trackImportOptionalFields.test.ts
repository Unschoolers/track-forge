import { describe, expect, it } from 'vitest'
import { decodeTrackExport } from '@/application/library/trackImport'
import { TRACK_EXPORT_FORMAT, TRACK_EXPORT_FORMAT_VERSION } from '@/domain/track/trackCodec'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'

const base = createStarterTrack(asTrackId('shared-artwork'), 1)
const decode = (overrides: Record<string, unknown>) => decodeTrackExport({
  format: TRACK_EXPORT_FORMAT,
  formatVersion: TRACK_EXPORT_FORMAT_VERSION,
  track: { ...base, ...overrides },
})

describe('shared track optional artwork is not silently lost', () => {
  it('rejects malformed present scenery and checkpoint fields instead of importing without them', () => {
    expect(decode({ scenery: { kind: 'city-house', x: 1, y: 2 } }).ok).toBe(false)
    expect(decode({ recoveryCheckpoints: '0.2,0.6' }).ok).toBe(false)
    expect(decode({ autoCheckpoints: 'false' }).ok).toBe(false)
    expect(decode({ scenery: [null] }).ok).toBe(false)
  })

  it('rejects conflicting duplicate sparse terrain cells that would be silently overwritten', () => {
    expect(decode({ terrain: { cellSize: 32, cells: [
      { column: 2, row: 4, kind: 'water' },
      { column: 2, row: 4, kind: 'hill' },
    ] } }).ok).toBe(false)
  })

  it('retains compatibility with absent optional fields and correct empty collections', () => {
    expect(decode({ scenery: undefined, recoveryCheckpoints: undefined, autoCheckpoints: undefined }).ok).toBe(true)
    expect(decode({ scenery: [], recoveryCheckpoints: [], autoCheckpoints: false }).ok).toBe(true)
  })
})
