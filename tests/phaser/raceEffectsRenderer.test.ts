// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import type { RaceParticle } from '@/domain/race/effects'
import { renderRaceEffects } from '@/phaser/rendering/raceEffectsRenderer'

function renderParticle(particle: RaceParticle, native = false) {
  const graphics = { lineStyle: vi.fn(), lineBetween: vi.fn(), fillStyle: vi.fn(), fillCircle: vi.fn() }
  renderRaceEffects(graphics as unknown as Phaser.GameObjects.Graphics, {
    particles: [particle], skids: [], previousTires: {},
  }, native)
  return graphics
}

const speedLine: RaceParticle = {
  kind: 'speed-line', x: 10, y: 20, vx: -3, vy: -4, life: 0.11, maxLife: 0.22, size: 1.2,
}

describe('race speed-line rendering', () => {
  it('draws a fading streak whose tail trails the particle velocity', () => {
    const graphics = renderParticle(speedLine)
    expect(graphics.lineStyle).toHaveBeenCalledWith(expect.any(Number), 0xe8f3ff, 0.36)
    expect(graphics.fillCircle).not.toHaveBeenCalled()
    expect(graphics.lineBetween).toHaveBeenCalledOnce()
    const [headX, headY, tailX, tailY] = graphics.lineBetween.mock.calls[0] as [number, number, number, number]
    expect(headX).toBe(10)
    expect(headY).toBe(20)
    expect(tailX).toBeGreaterThan(10)
    expect(tailY).toBeGreaterThan(20)
    expect((tailX - 10) / (tailY - 20)).toBeCloseTo(3 / 4)
    expect(Math.hypot(tailX - 10, tailY - 20)).toBeLessThanOrEqual(20)
  })

  it('does not double draw wind when native particles own presentation', () => {
    const graphics = renderParticle(speedLine, true)
    expect(graphics.lineBetween).not.toHaveBeenCalled()
  })

  it('avoids invalid coordinates for a stationary speed-line particle', () => {
    const graphics = renderParticle({ ...speedLine, vx: 0, vy: 0 })
    expect(graphics.lineBetween).not.toHaveBeenCalled()
  })
})

it('renders only effects belonging to each bridge layer', () => {
  const graphics = { lineStyle: vi.fn(), lineBetween: vi.fn(), fillStyle: vi.fn(), fillCircle: vi.fn() }
  const mark = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, width: 1, life: 1, maxLife: 1 }
  const effects = { particles: [speedLine, { ...speedLine, x: 30, raised: true as const }],
    skids: [mark, { ...mark, start: { x: 20, y: 20 }, raised: true as const }], previousTires: {} }
  const g = graphics as unknown as Phaser.GameObjects.Graphics
  renderRaceEffects(g, effects)
  expect(graphics.lineBetween.mock.calls.map(args => args[0])).toEqual([0, 10])
  graphics.lineBetween.mockClear()
  renderRaceEffects(g, effects, false, false, true)
  expect(graphics.lineBetween.mock.calls.map(args => args[0])).toEqual([20, 30])
})
