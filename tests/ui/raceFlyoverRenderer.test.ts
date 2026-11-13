import { describe, expect, it, vi } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { createRaceFlyoverRenderer } from '@/ui/components/raceFlyoverRenderer'

function canvas() {
  const colors: string[] = []
  const gradient = { addColorStop: vi.fn() }
  const methods = new Map<string, ReturnType<typeof vi.fn>>()
  const ctx = new Proxy({}, {
    get(_target, property) {
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient
      const key = String(property)
      if (!methods.has(key)) methods.set(key, vi.fn())
      return methods.get(key)
    },
    set(_target, property, value) {
      if (property === 'fillStyle' && typeof value === 'string') colors.push(value)
      return true
    },
  }) as CanvasRenderingContext2D
  return { ctx, colors, methods }
}

describe('race flyover renderer', () => {
  it('keeps the camera continuous across the closed route seam', () => {
    const track = createStarterTrack(asTrackId('seam'), 1)
    const geometry = new TrackGeometryService().get(track)
    const render = createRaceFlyoverRenderer(geometry, track, 'blue', 'day', true)
    const frame = canvas()
    const last = geometry.path.points.at(-1)
    const first = geometry.path.points[0]
    if (!last || !first) throw new Error('Expected a complete route')
    const seamMiddle = (last.distance + geometry.path.totalLength) / 2
    render(frame.ctx, 320, 150, (seamMiddle - geometry.start.distance - 45) / 70)
    const camera = frame.methods.get('translate')?.mock.calls[1]
    expect(camera?.[0]).toBeCloseTo(-(last.x + first.x) / 2, 4)
    expect(camera?.[1]).toBeCloseTo(-(last.y + first.y) / 2, 4)
  })

  it('draws the selected car and rivals in normal mode but only the selected car in ghost mode', () => {
    const track = createStarterTrack(asTrackId('flyover'), 1)
    const geometry = new TrackGeometryService().get(track)
    const normal = canvas()
    createRaceFlyoverRenderer(geometry, track, 'blue', 'day', false)(normal.ctx, 320, 150, 0)
    expect(normal.colors).toContain('#3a8cff')
    expect(normal.colors).toContain('#ff4f4f')
    expect(normal.colors).toContain('#49d66f')
    const ghost = canvas()
    createRaceFlyoverRenderer(geometry, track, 'blue', 'night', true)(ghost.ctx, 320, 150, 1)
    expect(ghost.colors).toContain('#3a8cff')
    expect(ghost.colors).not.toContain('#ff4f4f')
    expect(ghost.colors).toContain('#182d2b')
  })
})
