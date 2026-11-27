import type { SceneryPropKind } from '@/domain/track/trackEnvironment'
import type { TreeSeason } from '@/domain/track/treeSeason'
import grassUrl from '@/assets/environments/scenery/grass.webp?url&no-inline'
import desertUrl from '@/assets/environments/scenery/desert.webp?url&no-inline'
import cityUrl from '@/assets/environments/scenery/cityscape.webp?url&no-inline'
import kidsUrl from '@/assets/environments/scenery/kids-room.webp?url&no-inline'
import sharedUrl from '@/assets/environments/scenery/shared.webp?url&no-inline'
import { createArtCanvas } from './meadowBitmapArt'

export type TreeSpriteKind = 'tree' | 'tree-spring' | 'tree-autumn' | 'tree-winter'
export type ScenerySpriteKind = SceneryPropKind | TreeSpriteKind
export type SceneryBitmapResolver = (kind: ScenerySpriteKind, night: boolean) => HTMLCanvasElement | undefined
export const SCENERY_SPRITE_SIZE = 256

interface AtlasDefinition {
  readonly id: string
  readonly url: string
  readonly columns: number
  readonly kinds: readonly ScenerySpriteKind[]
}

/** Atlas placement is independent of the persisted prop IDs. Cells contain
 * transparent gutters so rotated or filtered sprites never sample neighbors. */
export const SCENERY_ATLASES = [
  { id: 'grass', url: grassUrl, columns: 2, kinds: ['grass-shrub', 'grass-wildflowers', 'grass-boulder', 'grass-log'] },
  { id: 'desert', url: desertUrl, columns: 2, kinds: ['desert-cactus', 'desert-boulder', 'desert-rock-cluster', 'desert-rock-spire'] },
  { id: 'cityscape', url: cityUrl, columns: 2, kinds: ['city-trash-bin', 'city-bus-stop', 'city-house', 'city-building'] },
  { id: 'kids-room', url: kidsUrl, columns: 3, kinds: ['kids-blocks', 'kids-teddy', 'kids-crayons', 'kids-book', 'kids-dinosaur', 'kids-top'] },
  { id: 'shared', url: sharedUrl, columns: 2, kinds: ['tree-spring', 'tree', 'tree-autumn', 'tree-winter'] },
] as const satisfies readonly AtlasDefinition[]

interface AtlasCell {
  readonly atlas: AtlasDefinition
  readonly x: number
  readonly y: number
}
const cells = new Map<ScenerySpriteKind, AtlasCell>()
for (const atlas of SCENERY_ATLASES) {
  atlas.kinds.forEach((kind, index) => {
    if (cells.has(kind)) throw new Error(`Duplicate scenery artwork: ${kind}`)
    cells.set(kind, { atlas, x: (index % atlas.columns) * SCENERY_SPRITE_SIZE, y: Math.floor(index / atlas.columns) * SCENERY_SPRITE_SIZE })
  })
}

export function treeSpriteKind(season: TreeSeason | undefined): TreeSpriteKind {
  return season === 'spring' ? 'tree-spring' : season === 'autumn' ? 'tree-autumn' : season === 'winter' ? 'tree-winter' : 'tree'
}

let artwork: ReadonlyMap<string, HTMLImageElement> | undefined
let loading: Promise<void> | undefined
const nightAtlases = new Map<string, HTMLCanvasElement>()
const bitmaps = new Map<string, HTMLCanvasElement>()

function loadAtlas(atlas: AtlasDefinition): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const width = atlas.columns * SCENERY_SPRITE_SIZE
      const height = Math.ceil(atlas.kinds.length / atlas.columns) * SCENERY_SPRITE_SIZE
      if (image.naturalWidth !== width || image.naturalHeight !== height) {
        reject(new Error(`Unexpected scenery atlas dimensions: ${atlas.id}`))
      } else resolve(image)
    }
    image.onerror = () => reject(new Error(`Could not load scenery atlas: ${atlas.id}`))
    image.src = atlas.url
  })
}

/** Keep the existing synchronous editor/race/flyover boot contract. Decode
 * the small compressed sheets once, but allocate tinted sheets and crops
 * only when a consumer actually uses them. */
export function loadSceneryBitmapArt(): Promise<void> {
  loading ??= Promise.all(SCENERY_ATLASES.map(async atlas => [atlas.id, await loadAtlas(atlas)] as const))
    .then(entries => { artwork = new Map(entries) })
  return loading
}

export interface SceneryAtlasSource {
  readonly id: string
  readonly source: HTMLImageElement | HTMLCanvasElement
  readonly columns: number
  readonly kinds: readonly ScenerySpriteKind[]
}

export function getSceneryAtlas(kind: ScenerySpriteKind, night: boolean): SceneryAtlasSource | undefined {
  if (!artwork) return undefined
  const cell = cells.get(kind)
  const image = cell && artwork.get(cell.atlas.id)
  if (!cell || !image) throw new Error(`Missing scenery artwork for ${kind}`)
  const { atlas } = cell
  if (!night) return { ...atlas, source: image }
  let tinted = nightAtlases.get(atlas.id)
  if (!tinted) {
    tinted = document.createElement('canvas')
    tinted.width = image.naturalWidth
    tinted.height = image.naturalHeight
    const context = tinted.getContext('2d')
    if (!context) throw new Error(`Could not tint scenery atlas ${atlas.id}`)
    context.drawImage(image, 0, 0)
    context.globalCompositeOperation = 'source-atop'
    context.fillStyle = 'rgba(8,24,39,0.54)'
    context.fillRect(0, 0, tinted.width, tinted.height)
    nightAtlases.set(atlas.id, tinted)
  }
  return { ...atlas, source: tinted }
}

/** The Canvas flyover and pre-boot test adapter use lazily cached cells.
 * Phaser registers named frames directly from the shared sheets. */
export const getSceneryBitmap: SceneryBitmapResolver = (kind, night) => {
  if (!artwork) return undefined
  const key = `${kind}:${night}`
  const existing = bitmaps.get(key)
  if (existing) return existing
  const cell = cells.get(kind)
  const atlas = getSceneryAtlas(kind, night)
  if (!cell || !atlas) throw new Error(`Missing scenery frame ${kind}`)
  const size = SCENERY_SPRITE_SIZE
  const { canvas, context } = createArtCanvas(size)
  context.drawImage(atlas.source, cell.x, cell.y, size, size, 0, 0, size, size)
  bitmaps.set(key, canvas)
  return canvas
}
