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
})
