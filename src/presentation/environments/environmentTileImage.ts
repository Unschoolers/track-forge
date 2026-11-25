import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { GROUND_TILE_SIZE, GROUND_TILE_VARIANTS } from './groundTexture'
import { GRASS_TILE_PADDING, getGrassTileImage } from './grassTileImage'
import { getTrackEnvironment } from './index'
import { getEnvironmentBitmapArt, paintBitmapGround } from './meadowBitmapArt'

export const GROUND_TILE_PADDING = GRASS_TILE_PADDING
const images = new Map<string, HTMLCanvasElement>()

export function getEnvironmentTileImage(environmentId: TrackEnvironmentId, variant: number, night: boolean): HTMLCanvasElement {
  const boundedVariant = ((Math.trunc(variant) % GROUND_TILE_VARIANTS) + GROUND_TILE_VARIANTS) % GROUND_TILE_VARIANTS || 0
  if (environmentId === 'grass') return getGrassTileImage(boundedVariant, night)
  const bitmap = getEnvironmentBitmapArt(environmentId, night)
  const key = `${environmentId}:${boundedVariant}:${night}:${bitmap ? 'bitmap' : 'vector'}`
  const cached = images.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = GROUND_TILE_SIZE + 2 * GROUND_TILE_PADDING
  canvas.height = canvas.width
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable for ground tile rendering')
  if (bitmap) {
    paintBitmapGround(context, bitmap, boundedVariant, GROUND_TILE_PADDING)
    images.set(key, canvas)
    return canvas
  }
  for (const shape of getTrackEnvironment(environmentId).groundArt(boundedVariant, night)) {
    context.fillStyle = `#${shape.color.toString(16).padStart(6, '0')}`
    context.globalAlpha = shape.alpha ?? 1
    context.beginPath()
    if (shape.kind === 'ellipse') context.ellipse(shape.x + GROUND_TILE_PADDING, shape.y + GROUND_TILE_PADDING, shape.radiusX, shape.radiusY, 0, 0, Math.PI * 2)
    else {
      shape.points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x + GROUND_TILE_PADDING, point.y + GROUND_TILE_PADDING)
        else context.lineTo(point.x + GROUND_TILE_PADDING, point.y + GROUND_TILE_PADDING)
      })
      context.closePath()
    }
    context.fill()
  }
  images.set(key, canvas)
  return canvas
}
