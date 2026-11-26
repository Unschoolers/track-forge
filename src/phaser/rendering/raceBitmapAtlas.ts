import type Phaser from 'phaser'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { createRaceBitmapLayers, type BakeableBitmapTiles } from '@/presentation/environments/meadowBitmapTiles'
import { GROUND_TILE_SIZE, groundViewportBounds, visibleGroundTiles, type GroundTile, type GroundViewport, type WorldBounds } from '@/presentation/environments/groundTexture'
import { BRIDGE_APPROACH_BITMAP_DEPTH, BRIDGE_DECK_BITMAP_DEPTH, ROAD_BITMAP_DEPTH, type MeadowBitmapRenderer } from './meadowBitmapRenderer'
import { WORLD_RENDER_DEPTH } from './renderLayers'

export const RACE_ATLAS_BUDGET = 128 * 1024 * 1024
const PAGE_SIZE = 1024
const GUTTER = 1
let nextAtlas = 0

interface AtlasPage {
  readonly count: number
  readonly columns: number
  readonly width: number
  readonly height: number
}

export interface RaceAtlasPlan {
  readonly resolution: number
  readonly stride: number
  readonly pages: readonly AtlasPage[]
  readonly bytes: number
}

/** Bound actual RGBA page allocation, including edge gutters and the last row.
 * Small tracks retain native tile resolution; large tracks use the highest
 * uniform resolution that fits. No on-race texture allocation or eviction. */
export function planRaceAtlas(count: number, budget = RACE_ATLAS_BUDGET): RaceAtlasPlan {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(budget) || budget < 36) {
    throw new RangeError('Invalid race atlas budget or tile count')
  }
  const start = Math.min(GROUND_TILE_SIZE, Math.floor(Math.sqrt(budget / (4 * Math.max(1, count)))) - 2 * GUTTER)
  for (let resolution = start; resolution >= 1; resolution--) {
    const stride = resolution + 2 * GUTTER
    const columns = Math.floor(PAGE_SIZE / stride)
    const capacity = columns * columns
    const pages: AtlasPage[] = []
    let bytes = 0
    for (let remaining = count; remaining > 0; remaining -= capacity) {
      const entries = Math.min(remaining, capacity)
      const width = Math.min(columns, entries) * stride
      const height = Math.ceil(entries / columns) * stride
      bytes += width * height * 4
      pages.push({ count: entries, columns, width, height })
    }
    if (bytes <= budget) return { resolution, stride, pages, bytes }
  }
  throw new Error('Race artwork exceeds the atlas memory budget')
}

const tileKey = ({ x, y }: Pick<GroundTile, 'x' | 'y'>) => `${x}:${y}`
interface AtlasEntry {
  readonly tile: GroundTile
  readonly source: BakeableBitmapTiles
  readonly layer: number
}
interface AtlasFrame {
  readonly tile: GroundTile
  readonly texture: string
  readonly frame: string
}

/** Duplicate edge texels so linear sampling cannot bleed adjacent atlas frames. */
function drawTile(context: CanvasRenderingContext2D, source: HTMLCanvasElement, x: number, y: number, size: number): void {
  const w = source.width, h = source.height
  context.drawImage(source, x, y, size, size)
  context.drawImage(source, 0, 0, w, 1, x, y - 1, size, 1)
  context.drawImage(source, 0, h - 1, w, 1, x, y + size, size, 1)
  context.drawImage(source, 0, 0, 1, h, x - 1, y, 1, size)
  context.drawImage(source, w - 1, 0, 1, h, x + size, y, 1, size)
  context.drawImage(source, 0, 0, 1, 1, x - 1, y - 1, 1, 1)
  context.drawImage(source, w - 1, 0, 1, 1, x + size, y - 1, 1, 1)
  context.drawImage(source, 0, h - 1, 1, 1, x - 1, y + size, 1, 1)
  context.drawImage(source, w - 1, h - 1, 1, 1, x + size, y + size, 1, 1)
}

export const RACE_ATLAS_DEPTHS = [ROAD_BITMAP_DEPTH, WORLD_RENDER_DEPTH.terrain + 0.2, BRIDGE_APPROACH_BITMAP_DEPTH, BRIDGE_DECK_BITMAP_DEPTH, WORLD_RENDER_DEPTH.structureWall] as const

class AtlasLayer {
  readonly frames = new Map<string, AtlasFrame>()
  private readonly images: Phaser.GameObjects.Image[] = []
  private visible = 0
  private signature = ''

  constructor(private readonly scene: Phaser.Scene, private readonly depth: number) {}

  render(bounds: WorldBounds): void {
    const grid = [bounds.left, bounds.top, bounds.right, bounds.bottom].map(v => Math.floor(v / GROUND_TILE_SIZE))
    const signature = grid.join(':')
    if (this.signature === signature) return
    const tiles = visibleGroundTiles(bounds, 768)
    const frames = tiles.length ? tiles.flatMap(tile => {
      const frame = this.frames.get(tileKey(tile))
      return frame ? [frame] : []
    }) : Array.from(this.frames.values()).filter(({ tile }) =>
      tile.x >= grid[0]! && tile.x <= grid[2]! && tile.y >= grid[1]! && tile.y <= grid[3]!)
    frames.forEach(({ tile, texture, frame }, i) => {
      let image = this.images[i]
      if (!image) {
        image = this.scene.add.image(0, 0, texture, frame).setOrigin(0).setDepth(this.depth)
        this.images.push(image)
      } else {
        image.setTexture(texture, frame)
      }
      image.setPosition(tile.x * GROUND_TILE_SIZE, tile.y * GROUND_TILE_SIZE)
        .setDisplaySize(GROUND_TILE_SIZE, GROUND_TILE_SIZE).setVisible(true)
    })
    for (let i = frames.length; i < this.images.length; i++) this.images[i]?.setVisible(false)
    this.visible = frames.length
    this.signature = signature
  }

  coverage(): readonly number[] { return [this.visible, this.visible, this.frames.size] }
  destroy(): void {
    for (const image of this.images) image.destroy()
    this.images.length = 0
    this.frames.clear()
  }
}

/** Race geometry is immutable. Bake all sparse material tiles into shared
 * pages before driving starts. Only sprite selection changes during driving.
 * The editor keeps its dynamic, bounded streaming renderer. */
export function createRaceBitmapAtlas(scene: Phaser.Scene, geometry: TrackGeometry, night: boolean,
  environment: TrackEnvironmentId): MeadowBitmapRenderer | undefined {
  const sources = createRaceBitmapLayers(geometry, night, environment)
  if (!sources) return undefined
  const entries: AtlasEntry[] = []
  const layers = RACE_ATLAS_DEPTHS.map(depth => new AtlasLayer(scene, depth))
  const ordered = [sources.road, sources.terrain, sources.bridgeApproach, sources.bridgeDeck, sources.bridgeWalls]
  ordered.forEach((source, layer) => {
    if (source) for (const tile of source.all()) entries.push({ tile, source, layer })
  })
  const plan = planRaceAtlas(entries.length)
  const prefix = `race-atlas-${++nextAtlas}`
  const textures: string[] = []
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    scene.events.off('shutdown', destroy)
    for (const layer of layers) layer.destroy()
    for (const texture of textures) scene.textures.remove(texture)
  }
  try {
    let offset = 0
    for (const [pageIndex, page] of plan.pages.entries()) {
      const canvas = document.createElement('canvas')
      canvas.width = page.width
      canvas.height = page.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create race atlas canvas')
      context.imageSmoothingQuality = 'high'
      const pageEntries = entries.slice(offset, offset + page.count)
      const slots = pageEntries.map((entry, i) => {
        const x = (i % page.columns) * plan.stride + GUTTER
        const y = Math.floor(i / page.columns) * plan.stride + GUTTER
        drawTile(context, entry.source.image(entry.tile), x, y, plan.resolution)
        return { entry, x, y, frame: String(i) }
      })
      const key = `${prefix}:${pageIndex}`
      const texture = scene.textures.addCanvas(key, canvas)
      if (!texture) throw new Error('Could not register race atlas')
      textures.push(key)
      for (const { entry, x, y, frame } of slots) {
        if (!texture.add(frame, 0, x, y, plan.resolution, plan.resolution)) throw new Error('Could not register race atlas frame')
        layers[entry.layer]!.frames.set(tileKey(entry.tile), { tile: entry.tile, texture: key, frame })
      }
      offset += page.count
    }
  } catch (error) {
    destroy()
    throw error
  }
  scene.events.once('shutdown', destroy)
  return {
    render(view: GroundViewport, bounds = groundViewportBounds(view)) {
      if (!destroyed) for (const layer of layers) layer.render(bounds)
    },
    warmVisible() { /* All texture pages are already resident. */ },
    // Preserve the diagnostic's four material groups; bridge walls belong
    // to the deck group even though their rendering depth is independent.
    coverage: () => {
      const counts = layers.slice(0, 4).flatMap(layer => layer.coverage())
      layers[4]!.coverage().forEach((value, i) => { counts[9 + i] = (counts[9 + i] ?? 0) + value })
      return counts
    },
    destroy,
  }
}
