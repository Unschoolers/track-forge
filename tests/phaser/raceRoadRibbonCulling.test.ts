import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import {
  renderRaceTrackGeometryBase,
  renderTrackGeometryBase,
} from '@/phaser/rendering/trackRenderer'

vi.mock('phaser', () => ({
  default: {
    Display: {
      Color: { HexStringToColor: (hex: string) => ({ color: Number.parseInt(hex.slice(1), 16) }) },
    },
  },
}))

class RecordingGraphics {
  readonly paints: (string | number)[][] = []
  depth = 0
  visible = true
  private fillColor = 0
  private fillAlpha = 1
  private stroke: number[] = []
  private path: (string | number)[] = []

  setDepth(depth: number) {
    this.depth = depth
    return this
  }

  setVisible(visible: boolean) {
    this.visible = visible
    return this
  }

  fillStyle(color: number, alpha: number) {
    this.fillColor = color
    this.fillAlpha = alpha
  }

  lineStyle(width: number, color: number, alpha: number) {
    this.stroke = [width, color, alpha]
  }

  fillTriangle(...coordinates: number[]) {
    this.paints.push(['triangle', this.fillColor, this.fillAlpha, ...coordinates])
  }

  beginPath() { this.path = [] }
  moveTo(x: number, y: number) { this.path.push('move', x, y) }
  lineTo(x: number, y: number) { this.path.push('line', x, y) }
  closePath() { this.path.push('close') }
  fillPath() { this.paints.push(['fill', this.fillColor, this.fillAlpha, ...this.path]) }
  strokePath() { this.paints.push(['stroke', ...this.stroke, ...this.path]) }
}

function createRecordingScene() {
  const graphics: RecordingGraphics[] = []
  const scene = {
    add: {
      graphics() {
        const object = new RecordingGraphics()
        graphics.push(object)
        return object
      },
    },
  }
  return { scene: scene as unknown as Phaser.Scene, graphics }
}

function lineGeometry(halfLength: number) {
  return buildTrackGeometry({
    routeKind: 'point-to-point',
    points: [
      { x: -halfLength, y: -240, surface: 'street' },
      { x: halfLength, y: -240, surface: 'street' },
    ],
    terrain: EMPTY_TERRAIN,
  })
}

describe('race road ribbon culling', () => {
  it.each([false, true])('keeps the original paint order at a circuit crossing (night=%s)', (night) => {
    const geometry = buildTrackGeometry({
      points: [
        { x: -1700, y: -830, surface: 'street', curve: 'corner' },
        { x: 1600, y: 1110, surface: 'dirt', curve: 'corner' },
        { x: 1750, y: -946, surface: 'ice', curve: 'corner' },
        { x: -1660, y: 821, surface: 'street', curve: 'corner' },
        { x: -1700, y: -830, surface: 'street', curve: 'corner' },
      ],
      terrain: EMPTY_TERRAIN,
      start: { ratio: 0.12, reversed: true },
    })
    expect(geometry.path.closed).toBe(true)
    expect(geometry.path.crossings.some(({ upperSegment }) => upperSegment === null)).toBe(true)
    const base = new RecordingGraphics()
    renderTrackGeometryBase(base as unknown as Phaser.GameObjects.Graphics, geometry, night)

    const { scene, graphics } = createRecordingScene()
    expect(renderRaceTrackGeometryBase(scene, geometry, night)).toBeTypeOf('function')
    expect(graphics.every(({ depth }) => depth === WORLD_RENDER_DEPTH.road)).toBe(true)
    expect(graphics.flatMap(({ paints }) => paints)).toEqual(base.paints)
  })

  it('skips most ribbon triangles on a long stage and restores batches as the camera moves', () => {
    const geometry = lineGeometry(2400)
    const { scene, graphics } = createRecordingScene()
    const update = renderRaceTrackGeometryBase(scene, geometry, false)
    if (!update) throw new Error('Expected batched road ribbon')
    const ribbon = graphics.slice(0, -1)
    const markings = graphics.at(-1)
    const view = { centerX: -1450, centerY: -240, width: 1024, height: 768, zoom: 1.2, rotation: 0.35 }
    const countTriangles = (batches: readonly RecordingGraphics[]) =>
      batches.reduce((count, batch) => count + batch.paints.length, 0)

    update(view)
    const firstBatches = ribbon.filter(({ visible }) => visible)
    expect(countTriangles(firstBatches)).toBeGreaterThan(0)
    expect(countTriangles(firstBatches)).toBeLessThan(countTriangles(ribbon) / 3)
    expect(markings?.visible).toBe(true)

    update({ ...view, centerX: 1450 })
    expect(firstBatches.every(({ visible }) => !visible)).toBe(true)
    expect(ribbon.some(({ visible }) => visible)).toBe(true)

    update(view)
    expect(ribbon.filter(({ visible }) => visible)).toEqual(firstBatches)
    update({ ...view, zoom: Number.NaN })
    expect(ribbon.every(({ visible }) => visible)).toBe(true)
  })

  it('uses the rotated, resized camera bounds', () => {
    const { scene, graphics } = createRecordingScene()
    const update = renderRaceTrackGeometryBase(scene, lineGeometry(2400), false)
    if (!update) throw new Error('Expected batched road ribbon')
    const ribbon = graphics.slice(0, -1)
    const view = { centerX: -1450, centerY: -840, width: 1600, height: 240, zoom: 1, rotation: 0 }

    update(view)
    expect(ribbon.every(({ visible }) => !visible)).toBe(true)
    const rotated = { ...view, rotation: Math.PI / 4 }
    update(rotated)
    expect(ribbon.some(({ visible }) => visible)).toBe(true)
    update({ ...rotated, width: 400 })
    expect(ribbon.every(({ visible }) => !visible)).toBe(true)
  })

  it('draws a small ribbon and its markings in one graphics object', () => {
    const { scene, graphics } = createRecordingScene()
    const geometry = lineGeometry(200)
    expect(renderRaceTrackGeometryBase(scene, geometry, false)).toBeUndefined()
    expect(graphics).toHaveLength(1)
    expect(graphics[0]?.paints.some(([kind]) => kind === 'triangle')).toBe(true)
    expect(graphics[0]?.paints.some(([kind]) => kind === 'stroke')).toBe(true)
  })
})
