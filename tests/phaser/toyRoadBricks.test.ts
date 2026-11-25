import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import { renderCurbSegments } from '@/phaser/rendering/curbRenderer'

function graphicsMock() {
  return { save: vi.fn(), restore: vi.fn(), translateCanvas: vi.fn(), rotateCanvas: vi.fn(),
    fillStyle: vi.fn(), fillRoundedRect: vi.fn(), fillCircle: vi.fn(),
    lineStyle: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), strokePath: vi.fn() }
}

describe('Kids Room apex bricks', () => {
  const curb = { start: { x: 10, y: 20 }, end: { x: 10, y: 38 }, width: 8, color: 'red' } as const
  it('draws molded bricks and studs only at supplied curb segments', () => {
    const g = graphicsMock()
    const graphics = g as unknown as Phaser.GameObjects.Graphics
    renderCurbSegments(graphics, [], false, 'kids-room')
    expect(g.fillRoundedRect).not.toHaveBeenCalled()
    renderCurbSegments(graphics, [curb], false, 'kids-room')
    expect(g.translateCanvas).toHaveBeenCalledWith(10, 29)
    expect(g.rotateCanvas).toHaveBeenCalledWith(Math.PI / 2)
    expect(g.fillRoundedRect).toHaveBeenCalledTimes(2)
    expect(g.fillCircle).toHaveBeenCalled()
    expect(g.strokePath).not.toHaveBeenCalled()
    expect(g.save).toHaveBeenCalledTimes(1)
    expect(g.restore).toHaveBeenCalledTimes(1)
    for (const [x, y, w, h] of g.fillRoundedRect.mock.calls) {
      expect(x).toBeGreaterThanOrEqual(-9)
      expect(y).toBeGreaterThanOrEqual(-4)
      expect(x + w).toBeLessThanOrEqual(9)
      expect(y + h).toBeLessThanOrEqual(4)
    }
  })
  it.each(['grass', 'desert', 'cityscape'] as const)('preserves ordinary curbs in %s', environment => {
    const g = graphicsMock()
    renderCurbSegments(g as unknown as Phaser.GameObjects.Graphics, [curb], false, environment)
    expect(g.lineStyle).toHaveBeenCalledWith(8, 0xd94141, 1)
    expect(g.strokePath).toHaveBeenCalledTimes(1)
    expect(g.fillCircle).not.toHaveBeenCalled()
  })
})
