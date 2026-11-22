import { describe, expect, it } from 'vitest'
import { normalizeTerrain, planTerrainPaint } from '@/domain/terrain/terrainField'

describe('terrain brush no-op fast path', () => {
  const original = normalizeTerrain({ cells: Array.from({ length: 1000 }, (_, index) => ({
    column: index % 100, row: Math.floor(index / 100), kind: 'hill',
  })) })

  it('returns a zero-change plan without allocating another revision for an empty stroke', () => {
    const result = planTerrainPaint(original, [], 'water')
    expect(result).toEqual({ ok: true, terrain: original, changedCells: [] })
    if (result.ok) expect(result.terrain).toBe(original)
  })

  it('still rejects malformed coordinates in a nonempty brush atomically', () => {
    expect(planTerrainPaint(original, [{ column: Number.NaN, row: 0 }], 'water'))
      .toEqual({ ok: false, reason: 'coordinate-bounds' })
    expect(original.cells[0]?.kind).toBe('hill')
  })
})
