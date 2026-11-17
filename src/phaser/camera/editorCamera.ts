import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type { EditorCamera } from '@/phaser/input/editorInput'
import type { EditorCameraAction } from '@/domain/editor/editorGeometry'

/** Keep the zoom positive and leave room to zoom out past large course overviews. */
export const EDITOR_ZOOM_LIMITS = {
  minimum: 0.00001,
  maximum: 2.7,
} as const

interface ViewportArea {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface EditorViewport {
  readonly width: number
  readonly height: number
  readonly coveredAreas?: readonly ViewportArea[]
}

function trackBounds(points: readonly Vector2[]) {
  let minimumX = Infinity
  let maximumX = -Infinity
  let minimumY = Infinity
  let maximumY = -Infinity
  for (const { x, y } of points) {
    minimumX = Math.min(minimumX, x)
    maximumX = Math.max(maximumX, x)
    minimumY = Math.min(minimumY, y)
    maximumY = Math.max(maximumY, y)
  }
  return {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
    width: Math.max(300, maximumX - minimumX + 180),
    height: Math.max(420, maximumY - minimumY + 220),
  }
}

function clearFitAreas(viewport: EditorViewport): readonly ViewportArea[] {
  const margin = Math.min(80, viewport.height / 4)
  const fallback = { left: 0, right: viewport.width, top: margin, bottom: viewport.height - margin }
  if (!viewport.coveredAreas?.length) return [fallback]

  const horizontalMargin = Math.min(8, viewport.width / 4)
  const rightEdge = viewport.width - horizontalMargin
  const topEdge = Math.min(8, viewport.height / 4)
  const bottomEdge = viewport.height - topEdge
  const controls = [...viewport.coveredAreas].sort((a, b) => a.left - b.left)
  const tops = new Set([topEdge])
  const bottoms = new Set([bottomEdge])
  for (const area of controls) {
    if (area.bottom > topEdge && area.bottom < bottomEdge) tops.add(area.bottom)
    if (area.top > topEdge && area.top < bottomEdge) bottoms.add(area.top)
  }

  // For each band between control edges, keep the horizontal gaps clear of controls.
  const areas: ViewportArea[] = []
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (bottom <= top) continue
      let left = horizontalMargin
      for (const control of controls) {
        if (control.bottom <= top || control.top >= bottom) continue
        const right = Math.min(control.left, rightEdge)
        if (right > left) areas.push({ left, right, top, bottom })
        left = Math.max(left, control.right)
      }
      if (rightEdge > left) areas.push({ left, right: rightEdge, top, bottom })
    }
  }
  return areas.length ? areas : [fallback]
}

function cameraForArea(center: Vector2, viewport: EditorViewport, area: ViewportArea, zoom: number): EditorCamera {
  return {
    x: center.x + (viewport.width - area.left - area.right) / (2 * zoom),
    y: center.y + (viewport.height - area.top - area.bottom) / (2 * zoom),
    zoom,
  }
}

export function fitEditorCamera(
  points: readonly Vector2[],
  viewport: EditorViewport,
): EditorCamera {
  if (points.length === 0) return { x: 0, y: 0, zoom: 1 }
  const bounds = trackBounds(points)
  let best: EditorCamera = { x: bounds.x, y: bounds.y, zoom: 1 }
  let bestScale = 0
  for (const area of clearFitAreas(viewport)) {
    const scale = Math.min((area.right - area.left) / bounds.width, (area.bottom - area.top) / bounds.height)
    if (scale > bestScale) {
      best = cameraForArea(bounds, viewport, area, clamp(scale, EDITOR_ZOOM_LIMITS.minimum, 1))
      bestScale = scale
    }
  }
  return best
}

export function applyEditorCameraAction(
  camera: EditorCamera,
  action: EditorCameraAction,
  points: readonly Vector2[],
  viewport: EditorViewport,
): EditorCamera {
  if (action === 'fit') return fitEditorCamera(points, viewport)
  const zoom = clamp(
    camera.zoom * (action === 'zoom-in' ? 1.2 : 1 / 1.2),
    EDITOR_ZOOM_LIMITS.minimum,
    EDITOR_ZOOM_LIMITS.maximum,
  )
  let nearest = { ...camera, zoom }
  if (action === 'zoom-in' || points.length === 0 || zoom > 1) return nearest

  const bounds = trackBounds(points)
  let nearestDistance = Infinity
  for (const area of clearFitAreas(viewport)) {
    const xRoom = ((area.right - area.left) / zoom - bounds.width) / 2
    const yRoom = ((area.bottom - area.top) / zoom - bounds.height) / 2
    if (xRoom < 0 || yRoom < 0) continue
    const center = cameraForArea(bounds, viewport, area, zoom)
    const x = clamp(camera.x, center.x - xRoom, center.x + xRoom)
    const y = clamp(camera.y, center.y - yRoom, center.y + yRoom)
    const distance = (camera.x - x) ** 2 + (camera.y - y) ** 2
    if (distance < nearestDistance) {
      nearest = { x, y, zoom }
      nearestDistance = distance
    }
    if (distance === 0) break
  }
  return nearest
}
