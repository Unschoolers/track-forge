import type { SurfaceId } from '@/domain/model'
import materialsUrl from '@/assets/environments/meadow/materials.webp?url&no-inline'
import patchesUrl from '@/assets/environments/meadow/patches.webp?url&no-inline'
import { createGroundTileRandom, GROUND_TILE_SIZE } from './groundTexture'

export interface MeadowBitmapArt {
  readonly ground: HTMLCanvasElement
  readonly road: Readonly<Record<SurfaceId, HTMLCanvasElement>>
  readonly patches: readonly HTMLCanvasElement[]
  readonly tree: HTMLCanvasElement
  readonly sand: HTMLCanvasElement
  readonly foam: HTMLCanvasElement
}

let artwork: Readonly<Record<'day' | 'night', MeadowBitmapArt>> | undefined
let loading: Promise<void> | undefined

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load Meadow artwork: ${url}`))
    image.src = url
  })
}

export function createArtCanvas(width: number, height = width): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable for Meadow artwork')
  return { canvas, context }
}

function extract(image: HTMLImageElement, size: number, column: number, row: number, night: boolean): HTMLCanvasElement {
  const { canvas, context } = createArtCanvas(size)
  context.drawImage(image, column * size, row * size, size, size, 0, 0, size, size)
  if (night) {
    context.globalCompositeOperation = 'source-atop'
    context.fillStyle = 'rgba(8, 24, 39, 0.54)'
    context.fillRect(0, 0, size, size)
  }
  return canvas
}

function tint(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const { canvas, context } = createArtCanvas(source.width, source.height)
  context.drawImage(source, 0, 0)
  context.globalCompositeOperation = 'source-atop'
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/** Decode the two bundled, generated WebP atlases before creating any scenes.
 * No remote requests, per-frame image decoding or silent asset-load failures. */
export function loadMeadowBitmapArt(): Promise<void> {
  loading ??= Promise.all([loadImage(materialsUrl), loadImage(patchesUrl)]).then(([materials, patches]) => {
    if (materials.naturalWidth !== 192 || materials.naturalHeight !== 192 ||
      patches.naturalWidth !== 128 || patches.naturalHeight !== 128) {
      throw new Error('Unexpected Meadow artwork atlas dimensions')
    }
    const build = (night: boolean): MeadowBitmapArt => {
      const ground = extract(materials, 96, 0, 0, night)
      const road = {
        street: extract(materials, 96, 1, 0, night),
        dirt: extract(materials, 96, 0, 1, night),
        ice: extract(materials, 96, 1, 1, night),
      }
      return {
        ground, road,
        patches: [extract(patches, 64, 0, 0, night), extract(patches, 64, 1, 0, night), extract(patches, 64, 0, 1, night)],
        tree: extract(patches, 64, 1, 1, night),
        sand: tint(road.dirt, night ? 'rgba(107, 108, 79, 0.45)' : 'rgba(222, 198, 143, 0.48)'),
        foam: tint(road.ice, night ? 'rgba(153, 194, 205, 0.25)' : 'rgba(239, 253, 249, 0.45)'),
      }
    }
    artwork = { day: build(false), night: build(true) }
  })
  return loading
}

export function getMeadowBitmapArt(night: boolean): MeadowBitmapArt | undefined {
  return artwork?.[night ? 'night' : 'day']
}

/** Same repeat phase in every world tile; variation lives in the transparent
 * patch placements. Art stays inside the central tile, leaving its old padding
 * transparent so adjacent world tiles cannot cover one another. */
export function paintMeadowGround(context: CanvasRenderingContext2D, art: MeadowBitmapArt, variant: number, padding: number): void {
  const repeat = GROUND_TILE_SIZE / 2
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      context.drawImage(art.ground, padding + x * repeat, padding + y * repeat, repeat, repeat)
    }
  }
  const random = createGroundTileRandom(variant, 0x5c3a)
  for (const patch of art.patches) {
    const size = 55 + random() * 35
    const x = padding + size / 2 + random() * (GROUND_TILE_SIZE - size)
    const y = padding + size / 2 + random() * (GROUND_TILE_SIZE - size)
    context.save()
    context.translate(x, y)
    context.rotate(random() * Math.PI * 2)
    context.drawImage(patch, -size / 2, -size / 2, size, size)
    context.restore()
  }
}
