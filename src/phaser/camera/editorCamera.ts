import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type { EditorCamera } from '@/phaser/input/editorInput'
import type { EditorCameraAction } from '@/domain/editor/editorGeometry'

/** Keep the zoom positive and leave room to zoom out past large course overviews. */
export const EDITOR_ZOOM_LIMITS = {
  minimum: 0.001,
  maximum: 2.7,
} as const

export interface EditorViewport {
  readonly width: number
  readonly height: number
  readonly fitArea?: { readonly top: number; readonly bottom: number }
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
  const margin = Math.min(80, viewport.height / 4)
  let top = Math.max(margin, viewport.fitArea?.top ?? 0)
  let bottom = Math.min(viewport.height - margin, viewport.fitArea?.bottom ?? viewport.height)
  if (bottom <= top) {
    top = margin
    bottom = viewport.height - margin
  }
  const zoom = clamp(
    Math.min(
      viewport.width / Math.max(300, maximumX - minimumX + 180),
      (bottom - top) / Math.max(420, maximumY - minimumY + 220),
    ),
    EDITOR_ZOOM_LIMITS.minimum,
    1,
  )
  return {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2 + (viewport.height - top - bottom) / (2 * zoom),
    zoom,
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
      EDITOR_ZOOM_LIMITS.minimum,
      EDITOR_ZOOM_LIMITS.maximum,
    ),
  }
}
