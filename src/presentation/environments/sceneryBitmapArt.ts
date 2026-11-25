import type { SceneryPropKind } from '@/domain/track/trackEnvironment'
import atlasUrl from '@/assets/environments/scenery.webp?url&no-inline'
import { createArtCanvas } from './meadowBitmapArt'

export type ScenerySpriteKind = SceneryPropKind | 'tree'
export type SceneryBitmapResolver = (kind: ScenerySpriteKind, night: boolean) => HTMLCanvasElement | undefined

export const SCENERY_SPRITE_SIZE = 64
const COLUMNS = 4
const ROWS = 5

/** Stable IDs are independent of atlas order and the track save format. */
export const SCENERY_SPRITE_INDEX = {
  'grass-shrub': 0,
  'grass-wildflowers': 1,
  'grass-boulder': 2,
  'grass-log': 3,
  'desert-cactus': 4,
  'desert-boulder': 5,
  'desert-rock-cluster': 6,
  'desert-rock-spire': 7,
  'city-trash-bin': 8,
  'city-bus-stop': 9,
  'city-house': 10,
  'city-building': 11,
  'kids-blocks': 12,
  'kids-teddy': 13,
  'kids-crayons': 14,
  'kids-book': 15,
  'kids-dinosaur': 16,
  'kids-top': 17,
  tree: 18,
} as const satisfies Record<ScenerySpriteKind, number>

let artwork: Readonly<Record<'day' | 'night', readonly HTMLCanvasElement[]>> | undefined
let loading: Promise<void> | undefined

function loadAtlas(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load generated scenery atlas'))
    image.src = atlasUrl
  })
}

/** Decode once at boot. Crop each independent cell before any scene paints,
 * including the night variant, so neither renderer reads neighboring pixels. */
export function loadSceneryBitmapArt(): Promise<void> {
  loading ??= loadAtlas().then(image => {
    const size = SCENERY_SPRITE_SIZE
    if (image.naturalWidth !== COLUMNS * size || image.naturalHeight !== ROWS * size) {
      throw new Error('Unexpected scenery atlas dimensions')
    }
    const count = Object.keys(SCENERY_SPRITE_INDEX).length
    const build = (night: boolean): readonly HTMLCanvasElement[] =>
      Array.from({ length: count }, (_, index) => {
        const { canvas, context } = createArtCanvas(size)
        context.drawImage(image, (index % COLUMNS) * size, Math.floor(index / COLUMNS) * size, size, size, 0, 0, size, size)
        if (night) {
          context.globalCompositeOperation = 'source-atop'
          context.fillStyle = 'rgba(8,24,39,0.54)'
          context.fillRect(0, 0, size, size)
        }
        return canvas
      })
    artwork = { day: build(false), night: build(true) }
  })
  return loading
}

/** Undefined before boot (e.g. pure component tests) permits the existing
 * vector presentation. A loaded atlas missing a declared cell is an error. */
export const getSceneryBitmap: SceneryBitmapResolver = (kind, night) => {
  if (!artwork) return undefined
  const image = artwork[night ? 'night' : 'day'][SCENERY_SPRITE_INDEX[kind]]
  if (!image) throw new Error(`Missing scenery artwork for ${kind}`)
  return image
}
