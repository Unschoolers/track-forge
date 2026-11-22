import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { buildEditorGrid, editorGridSpacing, renderEditorGrid } from '@/phaser/rendering/editorRenderer'

describe('adaptive editor grid', () => {
  const bounds = { left: -12_000, top: -4_000, right: 12_000, bottom: 4_000 }

  it('keeps a legible grid density and anchors it in world space across zoom levels', () => {
    for (const zoom of [0.005, 0.03, 0.05, 0.1, 0.3, 1, 2.7]) {
      const spacing = editorGridSpacing(zoom)
      expect(spacing * zoom).toBeGreaterThanOrEqual(32)
      expect(spacing * zoom).toBeLessThanOrEqual(100)
      const grid = buildEditorGrid(bounds, spacing)
      expect(grid.vertical.length).toBeLessThanOrEqual(240)
      expect(grid.horizontal.length).toBeLessThanOrEqual(240)
      for (const line of [...grid.vertical, ...grid.horizontal]) {
        const index = Math.round(line.position / spacing)
        expect(line.position).toBeCloseTo(index * spacing)
        expect(line.major).toBe(index % 5 === 0)
      }
    }
    expect(editorGridSpacing(0.05)).toBeGreaterThan(editorGridSpacing(1))
  })

  it('renders major and minor lines in consistent screen pixels with stronger contrast', () => {
    const styles: Array<[number, number, number]> = []
    const graphics = {
      lineStyle: vi.fn((width: number, color: number, alpha: number) => { styles.push([width, color, alpha]) }),
      lineBetween: vi.fn(),
    } as unknown as Phaser.GameObjects.Graphics
    const sampleBounds = { left: -400, right: 400, top: -400, bottom: 400 }
    renderEditorGrid(graphics, sampleBounds, false, 0.5)
    expect(styles.some(([width]) => width === 1.55 / 0.5)).toBe(true)
    expect(styles.some(([width]) => width === 0.85 / 0.5)).toBe(true)
    expect(styles.some(([, , alpha]) => alpha === 0.44)).toBe(true)
    expect(styles.some(([, , alpha]) => alpha === 0.23)).toBe(true)
    styles.length = 0
    renderEditorGrid(graphics, sampleBounds, true, 0.5)
    expect(styles.some(([, color, alpha]) => color === 0xc7e3dd && alpha === 0.48)).toBe(true)
    expect(styles.some(([, color, alpha]) => color === 0xc7e3dd && alpha === 0.26)).toBe(true)
  })
})
