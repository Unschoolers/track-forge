import { describe, expect, it, vi } from 'vitest'
import { getGrassTexture } from '@/presentation/environments/grass'
import { GROUND_TILE_SIZE, groundViewportBounds, visibleGroundTiles, visibleGroundTilesForViewport } from '@/presentation/environments/groundTexture'
import { GroundTextureRenderer } from '@/phaser/rendering/environmentRenderer'
import type Phaser from 'phaser'
import { GRASS_TILE_PADDING, getGrassTileImage } from '@/presentation/environments/grassTileImage'

describe('world ground texture', () => {
  it('selects stable tiles across negative coordinates and overlapping windows', () => {
    const a = visibleGroundTiles({ left: -260, top: -10, right: 20, bottom: 10 })
    const b = visibleGroundTiles({ left: -200, top: -10, right: 40, bottom: 10 })
    expect(a.some((tile) => tile.x === -1 && tile.y === -1)).toBe(true)
    for (const tile of b) expect(a).toContainEqual(tile)
    expect(GROUND_TILE_SIZE).toBe(256)
  })

  it('returns no tiles for an oversized window', () => {
    expect(visibleGroundTiles({ left: -5000, top: -5000, right: 5000, bottom: 5000 })).toEqual([])
  })

  it('rejects coordinates beyond safe tile indices', () => {
    const coordinate = Number.MAX_SAFE_INTEGER * GROUND_TILE_SIZE * 2
    expect(visibleGroundTiles({ left: coordinate, top: 0, right: coordinate, bottom: 1 })).toEqual([])
  })

  it('covers rotated camera corners and a margin for overlapping marks', () => {
    const bounds = groundViewportBounds({ centerX: 0, centerY: 0, width: 400, height: 200, zoom: 2, rotation: Math.PI / 2 })
    expect(bounds.left).toBeLessThan(-50)
    expect(bounds.right).toBeGreaterThan(50)
    expect(bounds.top).toBeLessThan(-100)
    expect(bounds.bottom).toBeGreaterThan(100)
  })

  it('keeps overview fallback stable across camera rotation and translation near the tile budget', () => {
    const view = { centerX: 0, centerY: 0, width: 1500, height: 800, zoom: 1, rotation: 0 }
    const windows = [
      view,
      { ...view, centerX: 250, centerY: 250 },
      { ...view, rotation: Math.PI / 4 },
      { ...view, centerX: 250, centerY: 250, rotation: Math.PI / 4 },
    ]
    const selected = windows.map(visibleGroundTilesForViewport)
    expect(new Set(selected.map((tiles) => tiles.length === 0)).size).toBe(1)
    expect(selected.every((tiles) => tiles.length <= 64)).toBe(true)
    expect(visibleGroundTilesForViewport({ ...view, width: 400, height: 300 }).length).toBeGreaterThan(0)
  })

  it('provides deterministic grass marks for day and night', () => {
    const day = getGrassTexture(0, false)
    expect(day.length).toBeGreaterThan(0)
    expect(getGrassTexture(0, false)).toEqual(day)
    expect(getGrassTexture(0, true)).not.toEqual(day)
  })

  it('uses the known minimum zoom for an animated camera budget', () => {
    const view = { centerX: 0, centerY: 0, width: 590, height: 160, rotation: 0 }
    expect(visibleGroundTilesForViewport({ ...view, zoom: 0.37 }).length).toBeGreaterThan(0)
    for (const zoom of [0.35, 0.36, 0.37]) {
      expect(visibleGroundTilesForViewport({ ...view, zoom, minimumZoom: 0.35 })).toEqual([])
    }
  })

  it('caches padded canvas art by variant and lighting', () => {
    const context = { beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), set fillStyle(_value: string) {}, set globalAlpha(_value: number) {} }
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const image = getGrassTileImage(0, false)
    expect(image.width).toBe(GROUND_TILE_SIZE + 2 * GRASS_TILE_PADDING)
    expect(image.height).toBe(image.width)
    expect(getGrassTileImage(0, false)).toBe(image)
    expect(getGrassTileImage(0, true)).not.toBe(image)
    expect(context.ellipse).toHaveBeenCalled()
    getContext.mockRestore()
  })

  it('reuses tile images and textures, hides them on overview fallback', () => {
    const context = { beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), set fillStyle(_value: string) {}, set globalAlpha(_value: number) {} }
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const images: Array<{ setOrigin: ReturnType<typeof vi.fn>; setDepth: ReturnType<typeof vi.fn>; setPosition: ReturnType<typeof vi.fn>; setTexture: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn> }> = []
    const makeImage = () => {
      const image = { setOrigin: vi.fn().mockReturnThis(), setDepth: vi.fn().mockReturnThis(), setPosition: vi.fn().mockReturnThis(), setTexture: vi.fn().mockReturnThis(), setVisible: vi.fn().mockReturnThis() }
      images.push(image)
      return image
    }
    const textures = new Set<string>()
    const scene = { textures: { exists: (key: string) => textures.has(key), addCanvas: vi.fn((key: string) => { textures.add(key) }) }, add: { image: vi.fn(makeImage) } }
    const renderer = new GroundTextureRenderer(scene as unknown as Phaser.Scene)
    const view = { centerX: 40, centerY: 40, width: 100, height: 100, zoom: 1, rotation: 0 }
    renderer.render(view, false)
    expect(images.length).toBeGreaterThan(0)
    const count = images.length
    const calls = scene.textures.addCanvas.mock.calls.length
    renderer.render({ ...view, centerX: 41 }, false)
    expect(images.length).toBe(count)
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(calls)
    renderer.render(view, true)
    expect(scene.textures.addCanvas.mock.calls.length).toBeGreaterThan(calls)
    renderer.render({ ...view, width: 10000, height: 10000 }, true)
    expect(images.every((image) => image.setVisible.mock.lastCall?.[0] === false)).toBe(true)
    expect(images.length).toBeLessThanOrEqual(64)
    getContext.mockRestore()
  })
})
