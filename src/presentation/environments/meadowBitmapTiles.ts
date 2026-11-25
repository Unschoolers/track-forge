import { ROAD_GEOMETRY } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { GROUND_TILE_SIZE, groundViewportBounds, visibleGroundTiles, type GroundTile, type GroundViewport, type WorldBounds } from './groundTexture'
import { buildRoadRibbonQuads, type RoadRibbonQuad } from './roadRibbonQuads'
import { createArtCanvas, getEnvironmentBitmapArt, type EnvironmentBitmapArt } from './meadowBitmapArt'
import { buildTerrainComponents, tileTerrainComponent, type TerrainTriangle } from '@/phaser/rendering/terrainTopology'
import { buildTerrainPresentation } from '@/phaser/rendering/terrainMesh'
import { paintHarborOilSlicks } from './harborOilSlicks'
import { roadTextureRepeat } from './roadTextureVariants'

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
    private readonly paint: (context: CanvasRenderingContext2D, items: readonly T[], tile: GroundTile) => void) {}

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
    this.paint(context, items, tile)
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
export function roadBitmapTransform(quad: RoadRibbonQuad, repeat: number, size: number, variants = 1): DOMMatrix2DInit | undefined {
  const dx = quad.to.x - quad.from.x
  const dy = quad.to.y - quad.from.y
  const length = Math.hypot(dx, dy)
  if (!(length > 0.001)) return undefined
  const tx = dx / length, ty = dy / length
  const nx = -ty, ny = tx
  const width = ROAD_GEOMETRY.surfaceWidth
  const stripLength = repeat * variants
  const phase = ((quad.from.distance % stripLength) + stripLength) % stripLength
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

function roadTiles(geometry: TrackGeometry, art: EnvironmentBitmapArt): BitmapTiles {
  const quads = buildRoadRibbonQuads(geometry.path, geometry.ribbon)
  const index = indexBitmapItems(quads, quad => quad.road)
  const length = geometry.path.totalLength
  const repeat = roadTextureRepeat(length, geometry.path.closed)
  return new CachedBitmapTiles(index, (context, items) => {
    const patterns: Record<SurfaceId, CanvasPattern> = {
      street: repeatPattern(context, art.road.street),
      dirt: repeatPattern(context, art.road.dirt),
      ice: repeatPattern(context, art.road.ice),
    }
    for (const quad of items) {
      const source = art.road[quad.surface]
      const transform = roadBitmapTransform(quad, repeat, source.width, source.height / source.width)
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

type BankSegment = { readonly start: Vector2; readonly end: Vector2 }
export const WATER_BANK_RADIUS = 13
export const WATER_SHALLOW_RADIUS = 32

type TerrainBitmapItem =
  | { readonly kind: 'bank'; readonly segment: BankSegment }
  | { readonly kind: 'water' | 'plateau'; readonly triangle: TerrainTriangle }
  | { readonly kind: 'slope'; readonly triangle: TerrainTriangle; readonly shade: number }

/** Subdivide long compacted contour edges before spatial indexing. The
 * exact original boundary is preserved, including the shores of islands. */
export function splitBankSegment(start: Vector2, end: Vector2): readonly BankSegment[] {
  const count = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / TILE))
  const at = (t: number): Vector2 => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  })
  return Array.from({ length: count }, (_, i) => ({ start: at(i / count), end: at((i + 1) / count) }))
}

function terrainBitmapIndex(geometry: TrackGeometry): Map<string, TerrainBitmapItem[]> {
  const surface = geometry.path.terrainSurface
  const items: TerrainBitmapItem[] = []
  for (const contour of surface.contours) {
    if (contour.kind !== 'water' || contour.points.length < 3) continue
    for (let i = 0; i < contour.points.length; i++) {
      const a = contour.points[i], b = contour.points[(i + 1) % contour.points.length]
      if (!a || !b) continue
      for (const segment of splitBankSegment(a, b)) items.push({ kind: 'bank', segment })
    }
  }
  // Tiling the water components avoids indexing a huge triangulated interior
  // as one primitive. Component holes remain empty, including land islands.
  for (const component of buildTerrainComponents(surface.contours, 'water')) {
    for (const triangle of tileTerrainComponent(component, TILE)) items.push({ kind: 'water', triangle })
  }
  // Reuse the canonical full-detail facets and their directional lighting.
  // Full-detail plateau triangles are small and bounded, unlike overview runs.
  for (const primitive of buildTerrainPresentation(surface, 'full')) {
    if (primitive.kind === 'hill-slope') {
      for (const facet of primitive.facets) items.push({ kind: 'slope', ...facet })
    } else if (primitive.kind === 'hill-plateau') {
      for (const triangle of primitive.triangles) items.push({ kind: 'plateau', triangle })
    }
  }
  return indexBitmapItems(items, item => item.kind === 'bank'
    ? [item.segment.start, item.segment.end] : item.triangle, WATER_SHALLOW_RADIUS + 2)
}

function appendTriangle(context: CanvasRenderingContext2D, [a, b, c]: TerrainTriangle): void {
  context.moveTo(a.x, a.y)
  context.lineTo(b.x, b.y)
  context.lineTo(c.x, c.y)
  context.closePath()
}

function bankStroke(context: CanvasRenderingContext2D, items: readonly TerrainBitmapItem[], width: number, style: string | CanvasPattern, alpha: number): void {
  context.beginPath()
  for (const item of items) {
    if (item.kind !== 'bank') continue
    context.moveTo(item.segment.start.x, item.segment.start.y)
    context.lineTo(item.segment.end.x, item.segment.end.y)
  }
  context.strokeStyle = style
  context.lineWidth = width
  context.lineCap = 'round'
  context.globalAlpha = alpha
  context.stroke()
  context.globalAlpha = 1
}

/** Painter order: sand outside, deep water, translucent shallow shelves
 * clipped to water, narrow contact foam, then the textured mountain faces.
 * All patterns are world anchored across tile boundaries. */
export function paintTerrainBitmap(context: CanvasRenderingContext2D, items: readonly TerrainBitmapItem[], art: EnvironmentBitmapArt, tile?: GroundTile): void {
  const palette = art.terrainPalette
  const bankScale = palette.bankScale ?? 1
  const shallowScale = palette.shallowScale ?? 1
  bankStroke(context, items, WATER_BANK_RADIUS * 2 * bankScale, palette.outerBank, 0.6)
  bankStroke(context, items, 20 * bankScale, repeatPattern(context, art.sand), 1)
  bankStroke(context, items, 9 * bankScale, palette.wetBank, 0.95)

  context.save()
  context.beginPath()
  for (const item of items) {
    if (item.kind === 'water') appendTriangle(context, item.triangle)
  }
  context.fillStyle = repeatPattern(context, art.water)
  context.fill()
  context.clip()
  // Transparent navy glaze deepens the center without hiding the painted
  // caustics. The two inner bands gradually restore the shallows.
  // fillRect covers the current tile in world coordinates via its clip.
  context.fillStyle = palette.deepGlaze
  context.fill()
  bankStroke(context, items, WATER_SHALLOW_RADIUS * 2 * shallowScale, palette.shallow[0], 0.28)
  bankStroke(context, items, 42 * shallowScale, palette.shallow[1], 0.35)
  bankStroke(context, items, 22 * shallowScale, palette.shallow[2], 0.47)
  bankStroke(context, items, 4 * shallowScale, palette.contact, 0.72)
  if (palette.waterDetail === 'oil-slicks' && tile) paintHarborOilSlicks(context, tile)
  context.restore()

  // Batch slope facets by the existing nine directional shades. Adjacent
  // triangles are drawn as a single path to avoid visible triangle seams.
  const slope = repeatPattern(context, art.slope)
  for (let bucket = 0; bucket < 9; bucket++) {
    context.beginPath()
    for (const item of items) {
      if (item.kind === 'slope' && Math.max(0, Math.min(8, Math.round((item.shade + 1) * 4))) === bucket) {
        appendTriangle(context, item.triangle)
      }
    }
    context.fillStyle = slope
    context.fill()
    context.fillStyle = bucket < 4
      ? `rgba(${palette.slopeShadow},${(4 - bucket) * palette.slopeShadowStrength})`
      : `rgba(${palette.slopeLight},${(bucket - 4) * palette.slopeLightStrength})`
    context.fill()
  }
  context.beginPath()
  for (const item of items) {
    if (item.kind === 'plateau') appendTriangle(context, item.triangle)
  }
  context.fillStyle = repeatPattern(context, art.plateau)
  context.fill()
  context.fillStyle = palette.plateauGlaze
  context.fill()
}

function terrainTiles(geometry: TrackGeometry, art: EnvironmentBitmapArt): BitmapTiles {
  return new CachedBitmapTiles(terrainBitmapIndex(geometry), (context, items, tile) => paintTerrainBitmap(context, items, art, tile))
}

export function createMeadowBitmapLayers(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId): { road: BitmapTiles; terrain: BitmapTiles } | undefined {
  const art = getEnvironmentBitmapArt(environment, night)
  return art ? { road: roadTiles(geometry, art), terrain: terrainTiles(geometry, art) } : undefined
}

export function drawBitmapTiles(context: CanvasRenderingContext2D, tiles: BitmapTiles, view: GroundViewport): void {
  for (const tile of tiles.visible(view)) {
    context.drawImage(tiles.image(tile), tile.x * TILE, tile.y * TILE)
  }
}
