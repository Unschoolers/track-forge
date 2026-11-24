// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneryPropKind } from '@/domain/track/trackEnvironment'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { getTrackEnvironment } from '@/presentation/environments'
import { createRaceFlyoverRenderer } from '@/ui/components/raceFlyoverRenderer'
import { createRaceFlyover, type RaceFlyoverPlayback } from '@/ui/components/raceFlyover'
import { VEHICLE_VISUAL_SCALE } from '@/presentation/vehicleArtwork'

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
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvas().ctx)
  })

  afterEach(() => vi.restoreAllMocks())

  it('cycles from default double speed to quadruple speed, pause and back', () => {
    let scheduled: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      scheduled = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { scheduled = undefined })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const track = createStarterTrack(asTrackId('playback'), 1)
    const geometry = new TrackGeometryService().get(track)
    const playback: RaceFlyoverPlayback = { elapsedSeconds: 0 }
    const view = createRaceFlyover(track, geometry, 'blue', 'day', true, playback)
    try {
      const preview = view.element.querySelector('canvas')!
      Object.defineProperties(preview, {
        clientWidth: { value: 320 }, clientHeight: { value: 150 },
      })
      document.body.append(view.element)
      const frame = (at: number) => {
        const callback = scheduled
        if (!callback) throw new Error('Expected an animation frame')
        scheduled = undefined
        callback(at)
      }
      const toggle = view.element.querySelector('button')!
      expect(toggle.getAttribute('aria-label')).toBe('Double flyover speed')
      expect(toggle.textContent).toBe('2×')
      frame(0)
      frame(50)
      expect(playback.elapsedSeconds).toBeCloseTo(0.1)
      toggle.click()
      expect(playback.speed).toBe(4)
      expect(toggle.getAttribute('aria-label')).toBe('Pause flyover')
      frame(100)
      frame(150)
      expect(playback.elapsedSeconds).toBeCloseTo(0.3)
      toggle.click()
      expect(playback.speed).toBe(0)
      expect(toggle.getAttribute('aria-label')).toBe('Play flyover')
      frame(200)
      expect(playback.elapsedSeconds).toBeCloseTo(0.3)
      expect(scheduled).toBeUndefined()
      toggle.click()
      expect(playback.speed).toBe(2)
      expect(toggle.getAttribute('aria-label')).toBe('Double flyover speed')
      frame(250)
      frame(300)
      expect(playback.elapsedSeconds).toBeCloseTo(0.4)
    } finally {
      view.destroy()
      view.element.remove()
    }
  })

  it.each([
    ['day', '#2d7344'],
    ['night', '#0e2b1d'],
  ] as const)('draws %s ground detail below the road', (lighting, baseColor) => {
    const track = { ...createStarterTrack(asTrackId('ground'), 1), trees: [] }
    const geometry = new TrackGeometryService().get(track)
    const frame = canvas()
    createRaceFlyoverRenderer(geometry, track, 'blue', lighting, true)(frame.ctx, 320, 150, 0)
    expect(frame.colors[0]).toBe(baseColor)
    expect(frame.methods.get('drawImage')).toHaveBeenCalled()
    expect(frame.methods.get('drawImage')?.mock.invocationCallOrder[0])
      .toBeLessThan(frame.methods.get('stroke')?.mock.invocationCallOrder[0] ?? 0)
  })

  it.each(['cityscape', 'desert'] as const)('uses the %s night palette and draws authored scenery', (environmentId) => {
    const base = createStarterTrack(asTrackId('themed'), 1)
    const [start] = base.points
    if (!start) throw new Error('Starter track has no road points')
    const kind: SceneryPropKind = environmentId === 'cityscape' ? 'city-building' : 'desert-cactus'
    const track = { ...base, environmentId, scenery: [{ ...start, kind }] }
    const geometry = new TrackGeometryService().get(track)
    const frame = canvas()
    createRaceFlyoverRenderer(geometry, track, 'blue', 'night', true)(frame.ctx, 320, 150, 0)
    expect(frame.colors[0]).toBe(getTrackEnvironment(environmentId).night.flyoverGround)
    expect(frame.methods.get('fill')).toHaveBeenCalled()
  })

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
    expect(normal.methods.get('scale')?.mock.calls.filter(
      ([x, y]) => x === VEHICLE_VISUAL_SCALE && y === VEHICLE_VISUAL_SCALE,
    )).toHaveLength(3)
    const ghost = canvas()
    createRaceFlyoverRenderer(geometry, track, 'blue', 'night', true)(ghost.ctx, 320, 150, 1)
    expect(ghost.colors).toContain('#3a8cff')
    expect(ghost.colors).not.toContain('#ff4f4f')
    expect(ghost.colors).toContain('#0e2b1d')
    expect(ghost.methods.get('scale')?.mock.calls.filter(
      ([x, y]) => x === VEHICLE_VISUAL_SCALE && y === VEHICLE_VISUAL_SCALE,
    )).toHaveLength(1)
  })
})
