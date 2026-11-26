import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { boundsVisible } from '@/phaser/rendering/roadRibbonRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { createRaceBitmapAtlas } from '@/phaser/rendering/raceBitmapAtlas'
import { ROAD_MARKINGS_DEPTH } from '@/phaser/rendering/meadowBitmapRenderer'
import { renderRoadTransitions } from '@/phaser/rendering/trackCues'
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

vi.mock('@/phaser/rendering/raceBitmapAtlas', () => ({ createRaceBitmapAtlas: vi.fn() }))

class RecordingGraphics {
  readonly paints: (string | number)[][] = []
  depth = 0
  visible = true
  private fillColor = 0
  private fillAlpha = 1
  private stroke: number[] = []
  private path: (string | number)[] = []
  private transformDepth = 0

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

  lineBetween(x1: number, y1: number, x2: number, y2: number) {
    this.paints.push(['line', ...this.stroke, x1, y1, x2, y2])
  }
  save() {
    this.transformDepth++
    this.paints.push(['save'])
  }

  restore() {
    if (this.transformDepth === 0) throw new Error('Unbalanced graphics restore')
    this.transformDepth--
    this.paints.push(['restore'])
  }

  translateCanvas(x: number, y: number) {
    this.paints.push(['translate', x, y])
  }

  rotateCanvas(angle: number) {
    this.paints.push(['rotate', angle])
  }

  fillRoundedRect(x: number, y: number, width: number, height: number, radius: number) {
    this.paints.push(['roundedRect', this.fillColor, this.fillAlpha, x, y, width, height, radius])
  }

  fillCircle(x: number, y: number, radius: number) {
    this.paints.push(['circle', this.fillColor, this.fillAlpha, x, y, radius])
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
  it.each([120, 1800])('uses the complete road atlas without duplicate ribbon graphics (halfLength=%s)', halfLength => {
    const bitmap = { render: vi.fn(), warmVisible: vi.fn(), destroy: vi.fn(), coverage: () => [] }
    vi.mocked(createRaceBitmapAtlas).mockReturnValueOnce(bitmap)
    const { scene, graphics } = createRecordingScene()
    const update = renderRaceTrackGeometryBase(scene, lineGeometry(halfLength), false)
    expect(update?.bitmap).toBe(bitmap)
    expect(graphics.length).toBeGreaterThan(0)
    expect(graphics.every(object => object.depth === ROAD_MARKINGS_DEPTH)).toBe(true)
    const view = { centerX: 0, centerY: -240, width: 640, height: 480, zoom: 1, rotation: 0 }
    update?.(view)
    expect(bitmap.render).toHaveBeenCalledOnce()
  });

  it('bakes atlas-backed toy curbs in texture-local coordinates and releases their textures on shutdown', () => {
    vi.mocked(createRaceBitmapAtlas).mockReturnValueOnce({
      render: vi.fn(), warmVisible: vi.fn(), destroy: vi.fn(), coverage: () => [],
    })
    const geometry = buildTrackGeometry({
      points: [
        { x: 1_000, y: 2_000, surface: 'street' },
        { x: 1_300, y: 2_000, surface: 'street' },
        { x: 1_300, y: 2_300, surface: 'street' },
        { x: 1_000, y: 2_300, surface: 'street' },
        { x: 1_000, y: 2_000, surface: 'street' },
      ],
      terrain: EMPTY_TERRAIN,
    })
    const textures = new Map<string, { firstPaint: readonly (string | number)[] | undefined; width: number; height: number }>()
    const images: { x: number; y: number; key: string; object: RecordingGraphics }[] = []
    const removed = vi.fn()
    const onShutdown = vi.fn()
    const scene = {
      add: {
        graphics: () => {
          const graphics = new RecordingGraphics()
          return Object.assign(graphics, {
            generateTexture(key: string, width: number, height: number) {
              textures.set(key, { firstPaint: graphics.paints[0], width, height })
            },
            destroy: vi.fn(),
          })
        },
        image: (x: number, y: number, key: string) => {
          const object = Object.assign(new RecordingGraphics(), { setOrigin: () => object })
          images.push({ x, y, key, object })
          return object
        },
      },
      events: { once: onShutdown },
      textures: { exists: (key: string) => textures.has(key), remove: removed },
    }
    const update = renderRaceTrackGeometryBase(scene as unknown as Phaser.Scene, geometry, false, 'kids-room')
    expect(images.length).toBeGreaterThan(0)
    for (const { x, y, key, object } of images) {
      const texture = textures.get(key)
      expect(texture?.firstPaint).toEqual(['translate', -x, -y])
      expect(texture?.width).toBeLessThanOrEqual(2_048)
      expect(texture?.height).toBeLessThanOrEqual(2_048)
      expect(object.depth).toBe(ROAD_MARKINGS_DEPTH)
    }
    update?.({ centerX: 0, centerY: 0, width: 400, height: 400, zoom: 1, rotation: 0 })
    expect(images.every(({ object }) => !object.visible)).toBe(true)
    expect(onShutdown).toHaveBeenCalledWith('shutdown', expect.any(Function))
    onShutdown.mock.calls[0]?.[1]()
    expect(removed.mock.calls).toEqual(images.map(({ key }) => [key]))
  })

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
    renderRoadTransitions(base as unknown as Phaser.GameObjects.Graphics, geometry.path, night)

    const { scene, graphics } = createRecordingScene()
    expect(renderRaceTrackGeometryBase(scene, geometry, night)).toBeTypeOf('function')
    expect(graphics.every(({ depth }) => depth === WORLD_RENDER_DEPTH.road)).toBe(true)
    expect(graphics.flatMap(({ paints }) => paints)).toEqual(base.paints)
  })

  it.each(['grass', 'desert', 'cityscape', 'kids-room'] as const)(
    'draws %s road material detail in the same order across small and batched ribbons', (environment) => {
      const geometry = buildTrackGeometry({
        points: [
          { x: -1800, y: -800, surface: 'street', curve: 'corner' },
          { x: 1600, y: 1100, surface: 'dirt', curve: 'corner' },
          { x: 1850, y: -930, surface: 'ice', curve: 'corner' },
          { x: -1720, y: 850, surface: 'street', curve: 'corner' },
          { x: -1800, y: -800, surface: 'street', curve: 'corner' },
        ],
        terrain: EMPTY_TERRAIN,
        start: { ratio: 0.1, reversed: false },
      })
      const direct = new RecordingGraphics()
      renderTrackGeometryBase(direct as unknown as Phaser.GameObjects.Graphics, geometry, false, environment)
      renderRoadTransitions(direct as unknown as Phaser.GameObjects.Graphics, geometry.path, false)
      const { scene, graphics } = createRecordingScene()
      const update = renderRaceTrackGeometryBase(scene, geometry, false, environment)
      expect(update).toBeTypeOf('function')
      expect(graphics.flatMap(({ paints }) => paints)).toEqual(direct.paints)
      expect(graphics.some(({ paints }) => paints.some(([kind]) => kind === 'line'))).toBe(true)
      const commands = direct.paints
      const count = (kind: string) => commands.filter(([command]) => command === kind).length
      if (environment === 'kids-room') {
        expect(count('roundedRect')).toBeGreaterThan(0)
        expect(count('circle')).toBeGreaterThan(0)
        expect(count('save')).toBeGreaterThan(0)
        expect(count('restore')).toBe(count('save'))
      } else {
        expect(count('roundedRect')).toBe(0)
        expect(count('circle')).toBe(0)
      }
    },
  )

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

  it('culls distant markings and restores them when the camera moves', () => {
    const { scene, graphics } = createRecordingScene()
    const update = renderRaceTrackGeometryBase(scene, lineGeometry(5000), false)
    if (!update) throw new Error('Expected batched road markings')
    const strokes = (objects: readonly RecordingGraphics[]) => objects.reduce(
      (sum, object) => sum + object.paints.filter(([kind]) => kind === 'stroke').length, 0,
    )
    const view = { centerX: -3500, centerY: -240, width: 844, height: 390, zoom: 1, rotation: 0 }
    const total = strokes(graphics)
    update(view)
    const first = graphics.filter(({ visible }) => visible)
    expect(strokes(first)).toBeLessThan(total / 2)
    update({ ...view, centerX: 3500 })
    expect(strokes(graphics.filter(({ visible }) => visible))).toBeLessThan(total / 2)
    update({ ...view, zoom: Number.NaN })
    expect(strokes(graphics.filter(({ visible }) => visible))).toBe(total)
  })

  it('keeps static road batches inside a padded visibility window until the camera exits it', () => {
    const { scene, graphics } = createRecordingScene()
    const update = renderRaceTrackGeometryBase(scene, lineGeometry(2400), false)
    if (!update) throw new Error('Expected batched road geometry')
    const road = graphics.slice(0, -1)
    // Camera is far from the road; the wider precomputed window overlaps the
    // middle section, so that section must remain rendered despite being
    // outside the current instantaneous viewport.
    const farView = { centerX: 0, centerY: 3000, width: 400, height: 200, zoom: 1, rotation: 0 }
    update(farView)
    expect(road.every(({ visible }) => !visible)).toBe(true)
    update(farView, { left: -500, right: 500, top: -500, bottom: 500 })
    expect(road.some(({ visible }) => visible)).toBe(true)
    update(farView)
    expect(road.every(({ visible }) => !visible)).toBe(true)
  })

  it('keeps batches visible when either set of bounds is invalid', () => {
    const viewport = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(boundsVisible({ left: Number.NaN, top: 20, right: 30, bottom: 30 }, viewport)).toBe(true)
    expect(boundsVisible({ left: 30, top: 20, right: 20, bottom: 30 }, viewport)).toBe(true)
    expect(boundsVisible({ left: 20, top: 20, right: 30, bottom: 30 }, viewport)).toBe(false)
  })

  it('limits marking batches on very long roads', () => {
    const { scene, graphics } = createRecordingScene()
    const source = lineGeometry(2400)
    const points = Array.from({ length: 40 }, () => source.path.points).flat()
    const ribbon = Array.from({ length: 40 }, () => source.ribbon).flat()
    const geometry = { ...source, path: { ...source.path, points }, ribbon }
    expect(renderRaceTrackGeometryBase(scene, geometry, false)).toBeDefined()
    // At most 64 edge, 64 road, 64 material, 64 curb and 64
    // stripe batches, plus one marker layer.
    expect(graphics.length).toBeLessThanOrEqual(321)
  })

  it('keeps ramp approach cues outside the deck and culls them in bounded batches', () => {
    const points = Array.from({ length: 145 }, (_, index) => ({
      x: index * 80,
      y: 0,
      surface: 'street' as const,
      structure: index % 2 === 0 ? 'surface' as const : 'overpass' as const,
    }))
    const geometry = buildTrackGeometry({ points, terrain: EMPTY_TERRAIN, routeKind: 'point-to-point' })
    const { scene, graphics } = createRecordingScene()
    const update = renderRaceTrackGeometryBase(scene, geometry, true)
    if (!update) throw new Error('Expected bounded road cue batches')
    const cues = graphics.filter(({ paints }) => paints.some(([kind]) => kind === 'circle'))
    expect(cues.length).toBeGreaterThan(1)
    expect(cues.length).toBeLessThanOrEqual(64)

    const firstView = { centerX: 500, centerY: 0, width: 1_000, height: 400, zoom: 1, rotation: 0 }
    update(firstView)
    const firstVisible = cues.filter(({ visible }) => visible)
    expect(firstVisible.length).toBeGreaterThan(0)
    expect(firstVisible.length).toBeLessThan(cues.length)
    update({ ...firstView, centerY: 5_000 })
    expect(cues.every(({ visible }) => !visible)).toBe(true)
    update(firstView)
    expect(cues.filter(({ visible }) => visible)).toEqual(firstVisible)
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
