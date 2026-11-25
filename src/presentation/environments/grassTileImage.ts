import { getGrassTexture } from '@/presentation/environments/grass'
import { getMeadowBitmapArt, paintMeadowGround } from './meadowBitmapArt'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'

/** Room for patches whose centers lie near a tile edge. */
export const GRASS_TILE_PADDING = 64
const images = new Map<string, HTMLCanvasElement>()

/** Bake transparent, antialiased tile art once for Canvas and Phaser. */
export function getGrassTileImage(variant: number, night: boolean): HTMLCanvasElement {
  const art = getMeadowBitmapArt(night)
  const key = `${variant}:${night}:${art ? "bitmap" : "vector"}`
  const cached = images.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = GROUND_TILE_SIZE + 2 * GRASS_TILE_PADDING
  canvas.height = canvas.width
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable for grass tile rendering')
  if (art) {
    paintMeadowGround(context, art, variant, GRASS_TILE_PADDING)
    images.set(key, canvas)
    return canvas
  }
  for (const mark of getGrassTexture(variant, night)) {
    context.fillStyle = `#${mark.color.toString(16).padStart(6, '0')}`
    context.globalAlpha = mark.alpha
    context.beginPath()
    context.ellipse(mark.x + GRASS_TILE_PADDING, mark.y + GRASS_TILE_PADDING, mark.radiusX, mark.radiusY, 0, 0, Math.PI * 2)
    context.fill()
  }
  images.set(key, canvas)
  return canvas
}
