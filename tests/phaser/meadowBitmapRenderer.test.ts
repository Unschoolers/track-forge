import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { BitmapTileRenderer, BitmapTileUploadScheduler, createMeadowBitmapRenderer, selectAheadTiles, type UploadRequest, type BitmapWorkObserver } from '@/phaser/rendering/meadowBitmapRenderer'

import * as bitmapLayers from '@/presentation/environments/meadowBitmapTiles'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TerrainMap } from '@/domain/model'

const view = {
  centerX: 128,
  centerY: 128,
  width: 400,
  height: 300,
  zoom: 1,
  rotation: -Math.PI / 2,
}

describe('selectAheadTiles', () => {
  it('selects a bounded set of forward tiles and excludes visible tiles', () => {
    const visible = [{ x: 0, y: 0, variant: 0 }]
    const candidates = [
      { x: -1, y: 0, variant: 0 },
      { x: 1, y: 0, variant: 0 },
      { x: 2, y: 0, variant: 0 },
      { x: 0, y: 1, variant: 0 },
      { x: 0, y: 0, variant: 0 },
    ]

    expect(selectAheadTiles(view, visible, candidates, 1)).toEqual([{ x: 1, y: 0, variant: 0 }])
    expect(selectAheadTiles(view, visible, candidates, 0)).toEqual([])
  })

  it('follows the camera heading after rotation', () => {
    const rotated = { ...view, rotation: 0 }
    const candidates = [
      { x: 0, y: -1, variant: 0 },
      { x: 0, y: 1, variant: 0 },
    ]

    expect(selectAheadTiles(rotated, [], candidates, 2)).toEqual([{ x: 0, y: -1, variant: 0 }])
  })
})

function schedulerFixture(observe?: BitmapWorkObserver) {
  let clock = 0
  const listeners = new Map<string, () => void>()
  const scene = { game: {
    loop: { rawDelta: 1000 / 60 },
    events: {
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string, callback: () => void) => {
        if (listeners.get(name) === callback) listeners.delete(name)
      },
    },
  } } as unknown as Phaser.Scene
  const scheduler = new BitmapTileUploadScheduler(scene, () => clock, observe)
  const frame = (elapsed = 2) => {
    listeners.get('prestep')?.()
    clock += elapsed
    listeners.get('postrender')?.()
    clock += 20
  }
  const canvas = {} as HTMLCanvasElement
  const makeOwner = (order: number) => {
    const resident = new Set<string>()
    const owner = {
      wants: (key: string) => !resident.has(key),
      prepare: vi.fn(() => canvas),
      upload: vi.fn((_tile: UploadRequest['tile'], key: string, _canvas: HTMLCanvasElement) => { resident.add(key) }),
    }
    const request = (x: number, priority: number): UploadRequest => ({
      owner, tile: { x, y: 0, variant: 0 }, key: `${x}:0`, priority,
      primaryDistance: x, secondaryDistance: 0, layerOrder: order, ownerOrder: order,
    })
    return { owner, request, resident }
  }
  return { scheduler, frame, makeOwner, listeners, scene, advance: (ms: number) => { clock += ms } }
}

describe('BitmapTileUploadScheduler', () => {
  it('warms only the visible startup window across layers', () => {
    const { scheduler, makeOwner, frame } = schedulerFixture()
    const road = makeOwner(0)
    const terrain = makeOwner(1)
    scheduler.replace(road.owner, [road.request(1, 0), road.request(2, 1)])
    scheduler.replace(terrain.owner, [terrain.request(3, 0)])
    scheduler.warmVisible()
    expect([...road.resident]).toEqual(['1:0'])
    expect([...terrain.resident]).toEqual(['3:0'])
    frame()
    expect(road.owner.prepare).toHaveBeenCalledTimes(2)
    expect(road.owner.upload).toHaveBeenCalledTimes(1)
    frame()
    expect([...road.resident]).toEqual(['1:0', '2:0'])
  })

  it('does not start work on a busy frame and separates canvas preparation from upload', () => {
    const { scheduler, makeOwner, frame } = schedulerFixture()
    const road = makeOwner(0)
    const terrain = makeOwner(1)
    scheduler.replace(road.owner, [road.request(1, 1)])
    scheduler.replace(terrain.owner, [terrain.request(2, 0)])
    frame(15)
    expect(road.owner.prepare).not.toHaveBeenCalled()
    expect(terrain.owner.prepare).not.toHaveBeenCalled()
    frame()
    expect(terrain.owner.prepare).toHaveBeenCalledTimes(1)
    expect(terrain.owner.upload).not.toHaveBeenCalled()
    expect(road.owner.prepare).not.toHaveBeenCalled()
    frame()
    expect([...terrain.resident]).toEqual(['2:0'])
    expect(road.owner.prepare).not.toHaveBeenCalled()
  })

  it('attributes deferred canvas and GPU registration work to separate frames', () => {
    const observe = vi.fn()
    const { scheduler, frame, makeOwner, advance } = schedulerFixture(observe)
    const road = makeOwner(0)
    road.owner.prepare.mockImplementation(() => {
      advance(7)
      return {} as HTMLCanvasElement
    })
    road.owner.upload.mockImplementation(() => { advance(11) })
    scheduler.replace(road.owner, [road.request(1, 0)])
    frame()
    expect(observe).toHaveBeenCalledExactlyOnceWith({
      operation: 'prepare', layer: 0, tile: '1:0', priority: 0, durationMs: 7,
    })
    frame()
    expect(observe).toHaveBeenLastCalledWith({
      operation: 'upload', layer: 0, tile: '1:0', priority: 0, durationMs: 11,
    })
    scheduler.destroy()
  })

  it('drops a canceled prepared tile and unregisters both callbacks on shutdown', () => {
    const { scheduler, makeOwner, frame, listeners } = schedulerFixture()
    const road = makeOwner(0)
    scheduler.replace(road.owner, [road.request(1, 0)])
    frame()
    scheduler.cancel(road.owner)
    frame()
    expect(road.owner.upload).not.toHaveBeenCalled()
    scheduler.destroy()
    expect(listeners.size).toBe(0)
  })

  it('prioritizes new visible work over already prepared speculation', () => {
    const { scheduler, makeOwner, frame } = schedulerFixture()
    const road = makeOwner(0)
    const terrain = makeOwner(1)
    scheduler.replace(road.owner, [road.request(1, 1)])
    frame()
    scheduler.replace(terrain.owner, [terrain.request(2, 0)])
    frame()
    expect(terrain.owner.prepare).toHaveBeenCalledTimes(1)
    expect(road.owner.upload).not.toHaveBeenCalled()
    frame()
    expect([...terrain.resident]).toEqual(['2:0'])
  })
})

describe('BitmapTileRenderer', () => {
  it('retains offscreen textures within capacity and reuses them on return', () => {
    const { scheduler, scene, frame } = schedulerFixture()
    const registered = new Set<string>()
    const removed: string[] = []
    const canvas = {} as HTMLCanvasElement
    Object.assign(scene, {
      textures: {
        addCanvas: (key: string) => { registered.add(key); return {} },
        remove: (key: string) => { registered.delete(key); removed.push(key) },
      },
      add: {
        image: () => {
          const image = {
            visible: true,
            setOrigin: () => image,
            setDepth: () => image,
            setVisible: (visible: boolean) => { image.visible = visible; return image },
            destroy: () => undefined,
          }
          return image
        },
      },
    })
    let tileOffset = 0
    const tiles = {
      visible: vi.fn(() => Array.from({ length: 12 }, (_, x) => ({ x: x + tileOffset, y: 0, variant: 0 }))),
      image: vi.fn(() => canvas),
    }
    const renderer = new BitmapTileRenderer(scene, scheduler, tiles, 0, 0)
    const initial = { ...view, rotation: 0 }
    renderer.render(initial)
    scheduler.warmVisible()
    expect(registered.size).toBe(12)
    renderer.render(initial)
    expect(tiles.visible).toHaveBeenCalledTimes(1)

    tileOffset = 12
    renderer.render({ ...initial, centerX: initial.centerX + 4096 })
    scheduler.warmVisible()
    expect(registered.size).toBe(24)
    expect(removed).toHaveLength(0)
    for (let i = 0; i < 12; i++) frame()
    expect(registered.size).toBe(24)
    expect(removed).toHaveLength(0)
    const coverage: number[] = []
    renderer.writeCoverage(coverage)
    expect(coverage).toEqual([12, 12, 24])
    tileOffset = 0
    renderer.render(initial)
    scheduler.warmVisible()
    expect(tiles.image).toHaveBeenCalledTimes(24)
    expect(registered.size).toBe(24)
    expect(removed).toHaveLength(0)
    renderer.destroy()
    scheduler.destroy()
    expect(registered.size).toBe(0)
  })

  it('never grows the GPU cache beyond 48 or evicts a current tile for a stale one', () => {
    const { scheduler, scene } = schedulerFixture()
    const registered = new Set<string>()
    let peak = 0
    Object.assign(scene, {
      textures: {
        addCanvas: (key: string) => { registered.add(key); peak = Math.max(peak, registered.size); return {} },
        remove: (key: string) => { registered.delete(key) },
      },
      add: {
        image: () => {
          const image = {
            visible: true,
            setOrigin: () => image,
            setDepth: () => image,
            setVisible: (visible: boolean) => { image.visible = visible; return image },
            destroy: () => undefined,
          }
          return image
        },
      },
    })
    let tileOffset = 0
    const renderer = new BitmapTileRenderer(scene, scheduler, {
      visible: () => Array.from({ length: 48 }, (_, x) => ({ x: x + tileOffset, y: 0, variant: 0 })),
      image: () => ({} as HTMLCanvasElement),
    }, 0, 0)
    renderer.render(view)
    scheduler.warmVisible()
    tileOffset = 24
    renderer.render({ ...view, centerX: view.centerX + 8192 })
    scheduler.warmVisible()
    expect(peak).toBe(48)
    expect(registered.size).toBe(48)
    expect([...registered].every(key => Number(key.split(':')[1]) >= 24)).toBe(true)
    renderer.destroy()
    scheduler.destroy()
  })
})

describe('editor water cache lifecycle', () => {
  it('keeps uploaded water across road edits and drawing gestures, but invalidates terrain edits', () => {
    const { scene, scheduler } = schedulerFixture()
    scheduler.destroy()
    const uploaded = vi.fn(() => ({}))
    const removed = vi.fn()
    Object.assign(scene, {
      events: { once: vi.fn(), off: vi.fn() },
      textures: { addCanvas: uploaded, remove: removed },
      add: {
        image: () => {
          const image = {
            visible: true,
            setOrigin: () => image,
            setDepth: () => image,
            setVisible: (visible: boolean) => { image.visible = visible; return image },
            destroy: vi.fn(),
          }
          return image
        },
      },
    })
    const source = (visible: boolean) => ({
      visible: () => visible ? [{ x: 0, y: 0, variant: 0 }] : [],
      image: vi.fn(() => ({} as HTMLCanvasElement)),
      all: () => [],
      bake: () => ({} as HTMLCanvasElement),
    })
    const water = source(true)
    const empty = source(false)
    const createWater = vi.spyOn(bitmapLayers, 'createEditorWaterBitmapTiles').mockReturnValue(water)
    const createRoad = vi.spyOn(bitmapLayers, 'createEditorRoadBitmapLayers').mockReturnValue({
      road: empty, bridgeApproach: undefined, bridgeDeck: undefined,
    })
    const renderer = createMeadowBitmapRenderer(scene)
    const terrain: TerrainMap = { cellSize: 32, cells: [{ column: 0, row: 0, kind: 'water' }] }
    const geometry = () => ({} as TrackGeometry)
    try {
      renderer.update(geometry(), terrain, '', false, false, 'grass')
      renderer.render(view)
      renderer.warmVisible()
      expect(uploaded).toHaveBeenCalledTimes(1)
      expect(water.image).toHaveBeenCalledTimes(1)

      renderer.update(geometry(), terrain, '', true, false, 'grass')
      expect(renderer.hasRoadLayers()).toBe(false)
      renderer.render(view)
      renderer.warmVisible()
      renderer.update(geometry(), terrain, '', false, false, 'grass')
      renderer.render(view)
      renderer.warmVisible()
      expect(createWater).toHaveBeenCalledTimes(1)
      expect(uploaded).toHaveBeenCalledTimes(1)
      expect(removed).not.toHaveBeenCalled()
      expect(renderer.hasRoadLayers()).toBe(true)

      renderer.update(geometry(), { ...terrain, cells: [] }, '', false, false, 'grass')
      expect(removed).toHaveBeenCalledTimes(1)
      expect(renderer.coverage()[5]).toBe(0)

      const createHill = vi.spyOn(bitmapLayers, 'createEditorHillBitmapTiles').mockReturnValue(water)
      try {
        const mixed: TerrainMap = { cellSize: 32, cells: [
          { column: 0, row: 0, kind: 'water' },
          { column: 1, row: 0, kind: 'hill' },
        ] }
        renderer.update(geometry(), mixed, 'near', false, false, 'grass')
        renderer.render(view)
        renderer.warmVisible()
        const before = uploaded.mock.calls.length
        const removals = removed.mock.calls.length
        renderer.update(geometry(), mixed, 'near', true, false, 'grass')
        renderer.update(geometry(), mixed, 'near', false, false, 'grass')
        renderer.render(view)
        renderer.warmVisible()
        expect(createHill).toHaveBeenCalledTimes(1)
        expect(uploaded).toHaveBeenCalledTimes(before)
        expect(removed).toHaveBeenCalledTimes(removals)

        renderer.update(geometry(), mixed, 'changed-nearby-road', false, false, 'grass')
        renderer.render(view)
        renderer.warmVisible()
        expect(createHill).toHaveBeenCalledTimes(2)
        expect(uploaded).toHaveBeenCalledTimes(before + 1)
        expect(removed).toHaveBeenCalledTimes(removals + 1)
      } finally {
        createHill.mockRestore()
      }
    } finally {
      renderer.destroy()
      createWater.mockRestore()
      createRoad.mockRestore()
    }
  })
})
