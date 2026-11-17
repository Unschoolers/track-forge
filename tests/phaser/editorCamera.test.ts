import { describe, expect, it } from 'vitest'
import {
  applyEditorCameraAction,
  fitEditorCamera,
} from '@/phaser/camera/editorCamera'

describe('editor camera', () => {
  it('fits track bounds inside the viewport with legacy padding', () => {
    expect(
      fitEditorCamera(
        [
          { x: -200, y: -300 },
          { x: 200, y: 300 },
        ],
        { width: 800, height: 1000 },
      ),
    ).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('applies clamped zoom and fit requests deterministically', () => {
    const camera = { x: 10, y: 20, zoom: 1 }
    expect(
      applyEditorCameraAction(camera, 'zoom-in', [], {
        width: 400,
        height: 600,
      }),
    ).toEqual({ x: 10, y: 20, zoom: 1.2 })
    expect(
      applyEditorCameraAction(
        { x: 0, y: 0, zoom: 2.65 },
        'zoom-in',
        [],
        { width: 400, height: 600 },
      ).zoom,
    ).toBe(2.7)
    expect(
      applyEditorCameraAction(camera, 'fit', [], {
        width: 400,
        height: 600,
      }),
    ).toEqual({ x: 0, y: 0, zoom: 1 })
  })
  it('fits Papou-sized landscape tracks instead of cutting off both ends', () => {
    const bounds = [
      { x: -1127.46, y: -3037.36 },
      { x: 780.22, y: 335.75 },
    ]
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      const camera = fitEditorCamera(bounds, viewport)
      expect(camera.zoom).toBeLessThan(0.16)
      for (const point of bounds) {
        const screenX = (point.x - camera.x) * camera.zoom + viewport.width / 2
        const screenY = (point.y - camera.y) * camera.zoom + viewport.height / 2
        expect(screenX).toBeGreaterThanOrEqual(0)
        expect(screenX).toBeLessThanOrEqual(viewport.width)
        expect(screenY).toBeGreaterThanOrEqual(0)
        expect(screenY).toBeLessThanOrEqual(viewport.height)
      }
    }
  })

  it('allows zoom out below 0.16 without losing position or allowing zero zoom', () => {
    const viewport = { width: 844, height: 390 }
    const large = fitEditorCamera([
      { x: -1127, y: -3037 }, { x: 781, y: 336 },
    ], viewport)
    const zoomed = applyEditorCameraAction(large, 'zoom-out', [], viewport)
    expect(zoomed.zoom).toBeLessThan(large.zoom)
    expect(zoomed.x).toBe(large.x)
    expect(zoomed.y).toBe(large.y)
    let camera = large
    for (let i = 0; i < 30; i += 1) {
      camera = applyEditorCameraAction(camera, 'zoom-out', [], viewport)
    }
    expect(camera.zoom).toBeGreaterThan(0)
  })

  it('fits a long road in the clear space on a short viewport', () => {
    const viewport = {
      width: 320,
      height: 180,
      coveredAreas: [
        { left: 0, right: 320, top: 0, bottom: 80 },
        { left: 0, right: 320, top: 120, bottom: 180 },
      ],
    }
    const road = [{ x: 0, y: -30_000 }, { x: 0, y: 30_000 }]
    const camera = fitEditorCamera(road, viewport)
    expect(camera.zoom).toBeLessThan(0.001)
    for (const point of road) {
      const screenY = viewport.height / 2 + (point.y - camera.y) * camera.zoom
      expect(screenY).toBeGreaterThan(80)
      expect(screenY).toBeLessThan(120)
    }
  })

})
