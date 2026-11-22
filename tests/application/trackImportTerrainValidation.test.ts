import { describe, expect, it } from 'vitest'
import { decodeTrackExport } from '@/application/library/trackImport'
import { TRACK_EXPORT_FORMAT, TRACK_EXPORT_FORMAT_VERSION } from '@/domain/track/trackCodec'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'

const base = createStarterTrack(asTrackId('incoming-track'), 1)
function decodeTerrain(terrain: unknown) {
  return decodeTrackExport({
    format: TRACK_EXPORT_FORMAT, formatVersion: TRACK_EXPORT_FORMAT_VERSION,
    track: { ...base, terrain },
  })
}

describe('shared track terrain validation', () => {
  it('rejects malformed terrain instead of silently replacing the shared artwork with empty ground', () => {
    expect(decodeTerrain({ cells: 'not an array' }).ok).toBe(false)
    expect(decodeTerrain({ cells: [{ column: 0, row: 0, kind: 'lava' }] }).ok).toBe(false)
    expect(decodeTerrain({ cells: [{ column: 2049, row: 0, kind: 'hill' }] }).ok).toBe(false)
    expect(decodeTerrain({ cells: [{ column: 0.5, row: 0, kind: 'water' }] }).ok).toBe(false)
  })

  it('retains supported sparse terrain cells and accepts legacy exports without a terrain field', () => {
    const terrain = { cellSize: 32, cells: [{ column: -2, row: 3, kind: 'water' }] }
    const decoded = decodeTerrain(terrain)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.track.terrain.cells).toEqual(terrain.cells)

    const legacy = decodeTrackExport({
      format: TRACK_EXPORT_FORMAT, formatVersion: TRACK_EXPORT_FORMAT_VERSION,
      track: { ...base, terrain: undefined },
    })
    expect(legacy.ok).toBe(true)
  })
})
