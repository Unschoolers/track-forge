import { ROAD_GEOMETRY } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { GROUND_TILE_SIZE, groundViewportBounds, visibleGroundTiles, type GroundTile, type GroundViewport, type WorldBounds } from './groundTexture'
import { buildRoadRibbonQuads, type RoadRibbonQuad } from './roadRibbonQuads'
import { createArtCanvas, getMeadowBitmapArt, type MeadowBitmapArt } from './meadowBitmapArt'

export const BITMAP_TILE_LIMIT = 48
const TILE = GROUND_TILE_SIZE
const keyFor = (tile: Pick<GroundTile, 'x' | 'y'>) => `${tile.x}:${tile.y}`

export interface BitmapTiles {
  visible(view: GroundViewport, bounds?: WorldBounds): readonly GroundTile[]
  image(tile: GroundTile): HTMLCanvasElement
}

/** Index static geometry into world tiles; each short quad or bank segment
 * belongs only to the tiles it intersects. Preserve original paint order. */
export function indexBitmapItems<T>(items: readonly T[], points: (item: T) => readonly Vector2[], padding = 0): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const item of items) {
    const vertices = points(item)
    if (!vertices.length) continue
    const left = Math.floor((Math.min(...vertices.map(p => p.x)) - padding) / TILE)
    const right = Math.floor((Math.max(...vertices.map(p => p.x)) + padding) / TILE)
    const top = Math.floor((Math.min(...vertices.map(p => p.y)) - padding) / TILE)
    const bottom = Math.floor((Math.max(...vertices.map(p => p.y)) + padding) / TILE)
    if (![left, right, top, bottom].every(Number.isSafeInteger) ||
      (right - left + 1) * (bottom - top + 1) > 64) {
      throw new Error('Invalid or oversized Meadow material primitive')
    }
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const key = keyFor({ x, y })
        const entries = index.get(key)
        if (entries) entries.push(item)
        else index.set(key, [item])
      }
    }
  }
  return index
}

class CachedBitmapTiles<T> implements BitmapTiles {
  private readonly cache = new Map<string, HTMLCanvasElement>()

  constructor(private readonly index: ReadonlyMap<string, readonly T[]>,
    private readonly paint: (context: CanvasRenderingContext2D, items: readonly T[]) => void) {}

  visible(view: GroundViewport, bounds = groundViewportBounds(view)): readonly GroundTile[] {
    // Preserve the inexpensive vector overview at extreme zooms. Texture
    // budget is independent of world size and never grows with track length.
    if (Math.min(view.zoom, view.minimumZoom ?? view.zoom) < 0.18) return []
    const tiles = visibleGroundTiles(bounds, 768).filter(tile => this.index.has(keyFor(tile)))
    return tiles.length <= BITMAP_TILE_LIMIT ? tiles : []
  }

  image(tile: GroundTile): HTMLCanvasElement {
    const key = keyFor(tile)
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const items = this.index.get(key)
    if (!items) throw new Error('No Meadow bitmap geometry for tile')
    const { canvas, context } = createArtCanvas(TILE)
    context.translate(-tile.x * TILE, -tile.y * TILE)
    this.paint(context, items)
    this.cache.set(key, canvas)
    if (this.cache.size > BITMAP_TILE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return canvas
  }
}

/** Tile x is across the road; tile y follows the local tangent. Longitudinal
 * phase depends on canonical path distance, not a world chunk or camera. */
export function roadBitmapTransform(quad: RoadRibbonQuad, repeat: number, size: number): DOMMatrix2DInit | undefined {
  const dx = quad.to.x - quad.from.x
  const dy = quad.to.y - quad.from.y
  const length = Math.hypot(dx, dy)
  if (!(length > 0.001)) return undefined
  const tx = dx / length, ty = dy / length
  const nx = -ty, ny = tx
  const width = ROAD_GEOMETRY.surfaceWidth
  const phase = ((quad.from.distance % repeat) + repeat) % repeat
  return {
    a: nx * width / size, b: ny * width / size,
    c: tx * repeat / size, d: ty * repeat / size,
    e: quad.from.x - nx * width / 2 - tx * phase,
    f: quad.from.y - ny * width / 2 - ty * phase,
  }
}

function repeatPattern(context: CanvasRenderingContext2D, source: HTMLCanvasElement): CanvasPattern {
  const pattern = context.createPattern(source, 'repeat')
  if (!pattern) throw new Error('Could not create a repeating Meadow material')
  return pattern
}

function roadTiles(geometry: TrackGeometry, art: MeadowBitmapArt): BitmapTiles {
  const quads = buildRoadRibbonQuads(geometry.path, geometry.ribbon)
  const index = indexBitmapItems(quads, quad => quad.road)
  const length = geometry.path.totalLength
  const repeat = geometry.path.closed && length > 0 ? length / Math.max(1, Math.round(length / 96)) : 96
  return new CachedBitmapTiles(index, (context, items) => {
    const patterns: Record<SurfaceId, CanvasPattern> = {
      street: repeatPattern(context, art.road.street),
      dirt: repeatPattern(context, art.road.dirt),
      ice: repeatPattern(context, art.road.ice),
    }
    for (const quad of items) {
      const transform = roadBitmapTransform(quad, repeat, art.road[quad.surface].width)
      if (!transform) continue
      const pattern = patterns[quad.surface]
      pattern.setTransform(transform)
      context.fillStyle = pattern
      const [a, b, c, d] = quad.road
      context.beginPath()
      context.moveTo(a.x, a.y); context.lineTo(b.x, b.y)
      context.lineTo(c.x, c.y); context.lineTo(d.x, d.y)
      context.closePath()
      context.fill()
    }
  })
}

interface BankSegment { readonly start: Vector2; readonly end: Vector2 }

function shorelineTiles(geometry: TrackGeometry, art: MeadowBitmapArt): BitmapTiles {
  const segments: BankSegment[] = []
  for (const contour of geometry.path.terrainSurface.contours) {
    if (contour.kind !== 'water' || contour.points.length < 3) continue
    for (let i = 0; i < contour.points.length; i++) {
      const a = contour.points[i], b = contour.points[(i + 1) % contour.points.length]
      if (!a || !b) continue
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / TILE))
      const at = (t: number): Vector2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      for (let j = 0; j < count; j++) segments.push({ start: at(j / count), end: at((j + 1) / count) })
    }
  }
  return new CachedBitmapTiles(indexBitmapItems(segments, segment => [segment.start, segment.end], 9), (context, items) => {
    context.lineCap = 'round'
    for (const [source, width, alpha] of [[art.sand, 10, 0.72], [art.foam, 2.4, 0.85]] as const) {
      context.strokeStyle = repeatPattern(context, source)
      context.lineWidth = width
      context.globalAlpha = alpha
      context.beginPath()
      for (const segment of items) {
        context.moveTo(segment.start.x, segment.start.y)
        context.lineTo(segment.end.x, segment.end.y)
      }
      context.stroke()
    }
    context.globalAlpha = 1
  })
}

export function createMeadowBitmapLayers(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId): { road: BitmapTiles; shoreline: BitmapTiles } | undefined {
  const art = environment === 'grass' ? getMeadowBitmapArt(night) : undefined
  return art ? { road: roadTiles(geometry, art), shoreline: shorelineTiles(geometry, art) } : undefined
}

export function drawBitmapTiles(context: CanvasRenderingContext2D, tiles: BitmapTiles, view: GroundViewport): void {
  for (const tile of tiles.visible(view)) {
    context.drawImage(tiles.image(tile), tile.x * TILE, tile.y * TILE)
  }
}
