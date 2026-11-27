import { describe, expect, it } from 'vitest'
import { solveRacingLine, racingLineOffset } from '@/domain/race/ai/racingLine'
import { ROAD_GEOMETRY } from '@/domain/config'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'

function circle(count = 120) {
  return Array.from({ length: count }, (_, i) => {
    const angle = i * Math.PI * 2 / count
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    return { point: { x: x * 120, y: y * 120 }, normal: { x: -x, y: -y }, limit: 20 }
  })
}

describe('continuous geometry racing line', () => {
  it('preserves a straight centerline and open endpoints', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      point: { x: i * 6, y: 0 }, normal: { x: 0, y: 1 }, limit: 20,
    }))
    expect(solveRacingLine(nodes, false).every(offset => offset === 0)).toBe(true)
    const open = solveRacingLine(circle(), false)
    expect(open[0]).toBe(0)
    expect(open.at(-1)).toBe(0)
  })

  it('chooses a bounded continuous inside line on a constant turn', () => {
    const offsets = solveRacingLine(circle(), true)
    expect(offsets.every(offset => offset > 0 && offset <= 20)).toBe(true)
    expect(Math.abs((offsets[0] ?? 0) - (offsets.at(-1) ?? 0))).toBeLessThan(1.51)
  })

  it('preserves pinned geometry and bounds the approach to it', () => {
    const nodes = circle().map((node, i) => i === 0 ? { ...node, limit: 0 } : node)
    const offsets = solveRacingLine(nodes, true)
    expect(offsets[0]).toBe(0)
    expect(Math.abs(offsets[1] ?? 0)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(offsets.at(-1) ?? 0)).toBeLessThanOrEqual(1.5)
    expect(offsets.every((offset, i) => Math.abs(offset - (offsets[(i + 1) % offsets.length] ?? 0)) <= 1.500001)).toBe(true)
  })

  it('is deterministic under reversal of the same geometry', () => {
    const nodes = circle().map((node, i) => i < 10 ? { ...node, limit: 0 } : node)
    const forward = solveRacingLine(nodes, true)
    const reversed = [...solveRacingLine([...nodes].reverse(), true)].reverse()
    forward.forEach((offset, i) => expect(offset).toBeCloseTo(reversed[i] ?? 0, 8))
  })

  it('caches compiled offsets and keeps support transitions centered', () => {
    const track = createStarterTrack(asTrackId('line'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const changed = { ...path, points: path.points.map((point, i) =>
      i === 20 ? { ...point, structure: 'overpass' as const } : point) }
    for (let i = 0; i < changed.points.length; i++) {
      const offset = racingLineOffset(changed, i)
      expect(Math.hypot(offset?.x ?? 0, offset?.y ?? 0)).toBeLessThanOrEqual(ROAD_GEOMETRY.onRoadRadius * 0.55 + 1e-8)
      expect(racingLineOffset(changed, i)).toBe(offset)
    }
    for (let i = 8; i <= 32; i++) expect(racingLineOffset(changed, i)).toBeUndefined()
  })
})
