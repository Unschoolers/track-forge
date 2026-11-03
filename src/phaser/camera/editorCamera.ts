import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type { EditorCamera } from '@/phaser/input/editorInput'
import type { EditorCameraAction } from '@/domain/editor/editorGeometry'

export interface EditorViewport {
  readonly width: number
  readonly height: number
}

export function fitEditorCamera(
  points: readonly Vector2[],
  viewport: EditorViewport,
): EditorCamera {
  if (points.length === 0) return { x: 0, y: 0, zoom: 1 }
  const xValues = points.map((point) => point.x)
  const yValues = points.map((point) => point.y)
  const minimumX = Math.min(...xValues)
  const maximumX = Math.max(...xValues)
  const minimumY = Math.min(...yValues)
  const maximumY = Math.max(...yValues)
  return {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
    zoom: clamp(
      Math.min(
        viewport.width / Math.max(300, maximumX - minimumX + 180),
        viewport.height / Math.max(420, maximumY - minimumY + 220),
      ),
      0.18,
      1,
    ),
  }
}

export function applyEditorCameraAction(
  camera: EditorCamera,
  action: EditorCameraAction,
  points: readonly Vector2[],
  viewport: EditorViewport,
): EditorCamera {
  if (action === 'fit') return fitEditorCamera(points, viewport)
  return {
    ...camera,
    zoom: clamp(
      camera.zoom * (action === 'zoom-in' ? 1.2 : 1 / 1.2),
      0.16,
      2.7,
    ),
  }
}
