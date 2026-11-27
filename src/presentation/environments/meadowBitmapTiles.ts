import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { GROUND_TILE_SIZE, groundViewportBounds, visibleGroundTiles, type GroundTile, type GroundViewport, type WorldBounds } from './groundTexture'
import { buildRoadRibbonQuads, type RoadRibbonQuad } from './roadRibbonQuads'
import { createArtCanvas, getEnvironmentBitmapArt, type EnvironmentBitmapArt } from './meadowBitmapArt'
import { buildTerrainComponents, mapTerrainComponent, tileTerrainComponent, type TerrainTriangle } from '@/phaser/rendering/terrainTopology'
import { buildTerrainPresentation, type RegionalTerrainMeshCache } from '@/phaser/rendering/terrainMesh'
import { paintHarborOilSlicks } from './harborOilSlicks'
import { roadTextureRepeat } from './roadTextureVariants'
import { buildBridgePresentation, bridgeRenderPasses, type BridgePrimitive } from '@/phaser/rendering/bridgeRenderer'
import { projectSunShadow, type TrackShadowMode } from '@/phaser/rendering/lighting'
import { roadColorsForEnvironment } from './roadMaterials'
import { environmentRoadStrokes } from './environmentRoadStrokes'
import { bridgePaintCommands, paintBridgeCanvas } from './bridgeMaterials'
import { elevationLevelForHeight, elevationMaterialForLevel, groupElevationFaces } from './elevationMaterials'
import { HILL_FIELD_PADDING, HILL_FIELD_STEP, hillMaterialWeights, smoothHillField } from './hillMaterialField'

export const BITMAP_TILE_LIMIT = 48
const TILE = GROUND_TILE_SIZE
const keyFor = (tile: Pick<GroundTile, 'x' | 'y'>) => `${tile.x}:${tile.y}`

export interface BitmapTiles {
  visible(view: GroundViewport, bounds?: WorldBounds): readonly GroundTile[]
  image(tile: GroundTile): HTMLCanvasElement
  /** Exact painter input identity, available for static terrain tile reconciliation. */
  tileContentKey?(key: string): string | undefined
}

export interface BakeableBitmapTiles extends BitmapTiles {
  all(): readonly GroundTile[]
  bake(tile: GroundTile, resolution: number): HTMLCanvasElement
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

class CachedBitmapTiles<T> implements BakeableBitmapTiles {
  private readonly cache = new Map<string, HTMLCanvasElement>()

  constructor(private readonly index: ReadonlyMap<string, readonly T[]>,
    private readonly paint: (context: CanvasRenderingContext2D, items: readonly T[], tile: GroundTile) => void,
    private readonly limit: number = BITMAP_TILE_LIMIT) {}

  tileContentKey(key: string): string | undefined {
    const items = this.index.get(key)
    return items ? JSON.stringify(items) : undefined
  }

  all(): readonly GroundTile[] {
    return Array.from(this.index.keys(), key => {
      const [x, y] = key.split(':').map(Number)
      if (x === undefined || y === undefined || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
        throw new Error('Invalid bitmap tile index')
      }
      return { x, y, variant: 0 }
    })
  }

  visible(view: GroundViewport, bounds = groundViewportBounds(view)): readonly GroundTile[] {
    // Preserve the inexpensive vector overview at extreme zooms. Texture
    // budget is independent of world size and never grows with track length.
    if (Math.min(view.zoom, view.minimumZoom ?? view.zoom) < 0.18) return []
    const tiles = visibleGroundTiles(bounds, 768).filter(tile => this.index.has(keyFor(tile)))
    return tiles.length <= this.limit ? tiles : []
  }

  image(tile: GroundTile): HTMLCanvasElement {
    const key = keyFor(tile)
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const canvas = this.bake(tile, TILE)
    this.cache.set(key, canvas)
    if (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return canvas
  }

  /** Race atlas pages are painted once at their final pixel density, without
   * retaining a second cache of high-resolution source canvases. */
  bake(tile: GroundTile, resolution: number): HTMLCanvasElement {
    const items = this.index.get(keyFor(tile))
    if (!items) throw new Error('No Meadow bitmap geometry for tile')
    if (!Number.isSafeInteger(resolution) || resolution < 1) throw new RangeError('Invalid bitmap resolution')
    const { canvas, context } = createArtCanvas(resolution)
    context.imageSmoothingQuality = 'high'
    context.scale(resolution / TILE, resolution / TILE)
    context.translate(-tile.x * TILE, -tile.y * TILE)
    this.paint(context, items, tile)
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

/** Ordinary and elevated roads deliberately use the identical bitmap
 * swatches, width, variation count and canonical longitudinal phase. */
function fillRoadPolygon(context: CanvasRenderingContext2D, [a, b, c, d]: RoadRibbonQuad['road']): void {
  context.beginPath()
  context.moveTo(a.x, a.y); context.lineTo(b.x, b.y)
  context.lineTo(c.x, c.y); context.lineTo(d.x, d.y)
  context.closePath()
  context.fill()
}

function roadPatternPainter(context: CanvasRenderingContext2D, art: EnvironmentBitmapArt, repeat: number): (quad: RoadRibbonQuad) => void {
  const patterns: Record<SurfaceId, CanvasPattern> = {
    street: repeatPattern(context, art.road.street),
    dirt: repeatPattern(context, art.road.dirt),
    ice: repeatPattern(context, art.road.ice),
  }
  return quad => {
    const source = art.road[quad.surface]
    const transform = roadBitmapTransform(quad, repeat, source.width, source.height / source.width)
    if (!transform) return
    const pattern = patterns[quad.surface]
    pattern.setTransform(transform)
    context.fillStyle = pattern
    fillRoadPolygon(context, quad.road)
  }
}

interface RacePaintTheme {
  readonly environment: TrackEnvironmentId
  readonly night: boolean
}

/** Race tiles own the shoulders and opaque base too, including pixels
 * between antialiased texture quads. Editor tiles remain overlays. */
function roadTiles(geometry: TrackGeometry, art: EnvironmentBitmapArt, theme?: RacePaintTheme): BakeableBitmapTiles {
  const quads = buildRoadRibbonQuads(geometry.path, geometry.ribbon)
  const index = indexBitmapItems(quads, quad => theme ? quad.edge : quad.road, theme ? 32 : 0)
  const repeat = roadTextureRepeat(geometry.path.totalLength, geometry.path.closed)
  return new CachedBitmapTiles(index, (context, items) => {
    if (theme) {
      for (const pass of ['edge', 'road'] as const) {
        for (const quad of items) {
          const spec = roadColorsForEnvironment(quad.surface, theme.environment)
          context.fillStyle = pass === 'edge' ? (theme.night ? spec.nightEdge : spec.edge) : (theme.night ? spec.nightRoad : spec.road)
          fillRoadPolygon(context, quad[pass])
        }
      }
      // Keep the existing material underpaint underneath the textured surface.
      const loopLength = geometry.path.closed ? geometry.path.totalLength : undefined
      for (const quad of items) {
        for (const stroke of environmentRoadStrokes(theme.environment, quad.surface, quad.from, quad.to, theme.night, loopLength)) {
          paintBridgeCanvas(context, [{ kind: 'line', ...stroke }])
        }
      }
    }
    const paint = roadPatternPainter(context, art, repeat)
    for (const quad of items) paint(quad)
  })
}

/** Only the deck surface, markings and rails need a bitmap overlay.
 * Keep approach tiles below ground-level cars; deck tiles above them.
 * The original opaque vector deck is retained at all zoom levels. */
export function bridgeBitmapPrimitives(primitives: readonly BridgePrimitive[], approach: boolean): readonly BridgePrimitive[] {
  return primitives.filter(p => Boolean(p.rampApproach) === approach &&
    (p.kind === 'surface' || p.kind === 'marking' || p.kind === 'wall'))
}

function bridgeTiles(primitives: readonly BridgePrimitive[], geometry: TrackGeometry, art: EnvironmentBitmapArt, environment: TrackEnvironmentId, night: boolean, approach: boolean, complete = false): BakeableBitmapTiles | undefined {
  const items = complete ? primitives : bridgeBitmapPrimitives(primitives, approach)
  if (items.length === 0) return undefined
  const index = indexBitmapItems(items, p => p.kind === 'surface' && p.roadQuad ? p.roadQuad.edge : 'polygon' in p ? p.polygon : [p.start, p.end], complete ? 12 : 5)
  const repeat = roadTextureRepeat(geometry.path.totalLength, geometry.path.closed)
  return new CachedBitmapTiles(index, (context, visible) => {
    const paintRoad = roadPatternPainter(context, art, repeat)
    const source = art.bridge
    const structure = source ? repeatPattern(context, source) : undefined
    // A complete race pass first paints the structural underlay, side faces,
    // edge colors and opaque surface base. The texture overlay then keeps the
    // previous deck footprint without submitting the same geometry to Phaser.
    if (complete) {
      for (const p of visible) {
        if (p.kind === 'marking') continue
        if (p.kind === 'surface') {
          const spec = roadColorsForEnvironment(p.surface, environment)
          context.fillStyle = night ? spec.nightRoad : spec.road
          fillRoadPolygon(context, p.polygon)
        } else {
          paintBridgeCanvas(context, bridgePaintCommands(p, environment, night))
        }
      }
    }
    // Preserve canonical surface, marking and wall painter order per tile.
    for (const p of visible) {
      if (complete && p.kind !== 'surface' && p.kind !== 'marking') continue
      if (p.kind === 'surface') {
        if (!p.roadQuad) throw new Error('Bridge surface is missing its road texture quad')
        const quad = p.roadQuad
        const transform = source && structure ? roadBitmapTransform(quad, repeat, source.width) : undefined
        if (structure && transform) {
          // Material is visible on the structural shoulders; the road covers
          // the center in the next pass. Keep the exact authored footprint.
          structure.setTransform(transform)
          context.fillStyle = structure
          fillRoadPolygon(context, quad.edge)
        }
        paintRoad(quad)
        if (structure && transform && quad.surface === 'street' && !p.rampApproach) {
          // A light material overlay only on standard elevated decks; mud
          // and ice remain unambiguously the authored driving surface.
          context.save()
          context.globalAlpha = 0.28
          context.fillStyle = structure
          fillRoadPolygon(context, quad.road)
          context.restore()
        }
      }
      paintBridgeCanvas(context, bridgePaintCommands(p, environment, night, true))
    }
  })
}

type BankSegment = { readonly start: Vector2; readonly end: Vector2 }
export const WATER_BANK_RADIUS = 13
export const WATER_SHALLOW_RADIUS = 32

type ElevationFace =
  | { readonly kind: 'hill-mask'; readonly triangle: TerrainTriangle; readonly level: number }
  | { readonly kind: 'slope'; readonly triangle: TerrainTriangle; readonly shade: number; readonly level: number }

type TerrainBitmapItem =
  | { readonly kind: 'bank'; readonly segment: BankSegment }
  | { readonly kind: 'hill-bank'; readonly segment: BankSegment }
  | { readonly kind: 'water'; readonly triangle: TerrainTriangle }
  | { readonly kind: 'hill-shadow'; readonly triangle: TerrainTriangle }
  | ElevationFace

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

export function terrainBitmapIndex(geometry: TrackGeometry, includeShadows = false, part: 'all' | 'water' | 'hill' = 'all', regionalCache?: RegionalTerrainMeshCache): Map<string, TerrainBitmapItem[]> {
  const surface = geometry.path.terrainSurface
  const items: TerrainBitmapItem[] = []
  const contours = surface.visualContours ?? surface.contours
  for (const contour of contours) {
    if ((contour.kind !== 'water' && contour.kind !== 'hill') || contour.points.length < 3) continue
    if (part !== 'all' && contour.kind !== part) continue
    for (let i = 0; i < contour.points.length; i++) {
      const a = contour.points[i], b = contour.points[(i + 1) % contour.points.length]
      if (!a || !b) continue
      for (const segment of splitBankSegment(a, b)) items.push({ kind: contour.kind === 'water' ? 'bank' : 'hill-bank', segment })
    }
  }
  // Tiling the water components avoids indexing a huge triangulated interior
  // as one primitive. Component holes remain empty, including land islands.
  for (const component of part === 'hill' ? [] : buildTerrainComponents(surface.contours, 'water')) {
    for (const triangle of tileTerrainComponent(component, TILE)) items.push({ kind: 'water', triangle })
  }
  // Use the same continuous, hole-aware polygon fill as water for the hill
  // silhouette. The canonical height mesh supplies only the interior lighting.
  if (part !== 'water') {
    const level = elevationLevelForHeight(WORLD_ELEVATION.levelHeight)
    for (const component of buildTerrainComponents(contours, 'hill')) {
      for (const triangle of tileTerrainComponent(component, TILE)) items.push({ kind: 'hill-mask', triangle, level })
      if (includeShadows) {
        const projected = mapTerrainComponent(component, point => projectSunShadow(point, WORLD_ELEVATION.levelHeight))
        for (const triangle of tileTerrainComponent(projected, TILE)) items.push({ kind: 'hill-shadow', triangle })
      }
    }
  }
  // Reuse canonical road-aware slope facets as a translucent lighting pass.
  for (const primitive of part === 'water' || !surface.contours.some(contour => contour.kind === 'hill') ? [] : buildTerrainPresentation(surface, 'full', regionalCache)) {
    if (primitive.kind === 'hill-slope') {
      const level = elevationLevelForHeight(primitive.height)
      for (const facet of primitive.facets) items.push({ kind: 'slope', ...facet, level })
    }
  }
  return indexBitmapItems(items, item => 'segment' in item
    ? [item.segment.start, item.segment.end] : item.triangle, Math.max(WATER_SHALLOW_RADIUS, HILL_FIELD_PADDING) + 2)
}

function appendTriangle(context: CanvasRenderingContext2D, [a, b, c]: TerrainTriangle): void {
  context.moveTo(a.x, a.y)
  context.lineTo(b.x, b.y)
  context.lineTo(c.x, c.y)
  context.closePath()
}

function bankStroke(context: CanvasRenderingContext2D, items: readonly TerrainBitmapItem[], width: number, style: string | CanvasPattern, alpha: number, kind: 'bank' | 'hill-bank' = 'bank'): void {
  context.beginPath()
  for (const item of items) {
    if (item.kind !== kind) continue
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

/** Rasterize only the padded tile's geometry at a bounded, world-aligned
 * resolution. The result is reused for the material and directional lighting
 * masks, not sampled during gameplay. */
function paintHillBitmap(
  target: CanvasRenderingContext2D,
  faces: readonly ElevationFace[],
  art: EnvironmentBitmapArt,
  tile: GroundTile,
): void {
  const resolution = target.canvas.width
  const left = tile.x * TILE
  const top = tile.y * TILE
  const fieldWorldSize = TILE + HILL_FIELD_PADDING * 2
  const fieldSize = fieldWorldSize / HILL_FIELD_STEP
  const field = createArtCanvas(fieldSize)
  const mask = createArtCanvas(fieldSize)
  const hill = createArtCanvas(resolution)
  const rock = createArtCanvas(resolution)
  const worldTransform = (context: CanvasRenderingContext2D): void => {
    context.setTransform(resolution / TILE, 0, 0, resolution / TILE,
      -left * resolution / TILE, -top * resolution / TILE)
  }
  const drawField = (context: CanvasRenderingContext2D): void => {
    context.drawImage(mask.canvas, left - HILL_FIELD_PADDING, top - HILL_FIELD_PADDING,
      fieldWorldSize, fieldWorldSize)
  }
  for (const [level, levelFaces] of groupElevationFaces(faces)) {
    if (!levelFaces.some(face => face.kind === 'hill-mask')) continue
    const material = elevationMaterialForLevel(art.elevationMaterials, level)
    const shading = material.shading
    field.context.setTransform(1, 0, 0, 1, 0, 0)
    field.context.clearRect(0, 0, fieldSize, fieldSize)
    field.context.save()
    field.context.setTransform(1 / HILL_FIELD_STEP, 0, 0, 1 / HILL_FIELD_STEP,
      (HILL_FIELD_PADDING - left) / HILL_FIELD_STEP,
      (HILL_FIELD_PADDING - top) / HILL_FIELD_STEP)
    field.context.beginPath()
    for (const face of levelFaces) {
      if (face.kind === 'hill-mask') appendTriangle(field.context, face.triangle)
    }
    field.context.fillStyle = '#000000'
    field.context.fill()
    field.context.clip()
    // Red is rock coverage, green/blue are opposing light directions.
    // The canonical mesh supplies the road-aware grades; only these masks
    // are filtered. No texture, physics or hazard data is interpolated.
    for (let bucket = 0; bucket < 9; bucket++) {
      field.context.beginPath()
      for (const face of levelFaces) {
        if (face.kind === 'slope' && Math.max(0, Math.min(8, Math.round((face.shade + 1) * 4))) === bucket) {
          appendTriangle(field.context, face.triangle)
        }
      }
      const light = Math.max(0, bucket - 4) * 63
      const shadow = Math.max(0, 4 - bucket) * 63
      field.context.fillStyle = `rgb(255,${light},${shadow})`
      field.context.fill()
    }
    field.context.restore()
    const values = smoothHillField(field.context.getImageData(0, 0, fieldSize, fieldSize).data, fieldSize, fieldSize)
    const maskPixels = mask.context.createImageData(fieldSize, fieldSize)
    const writeMask = (channel: 'coverage' | 'rock' | 'lighting'): void => {
      const lightColor = shading.slopeLight.split(',').map(Number)
      const shadowColor = shading.slopeShadow.split(',').map(Number)
      for (let offset = 0; offset < values.length; offset += 4) {
        const weights = hillMaterialWeights(values, offset)
        if (channel === 'lighting') {
          const light = weights.light * shading.slopeLightStrength * 4
          const shadow = weights.shadow * shading.slopeShadowStrength * 4
          const strength = light + shadow
          for (let c = 0; c < 3; c++) {
            maskPixels.data[offset + c] = strength > 0
              ? ((lightColor[c] ?? 0) * light + (shadowColor[c] ?? 0) * shadow) / strength
              : 0
          }
          maskPixels.data[offset + 3] = Math.min(1, strength) * 255
        } else {
          maskPixels.data[offset] = 255
          maskPixels.data[offset + 1] = 255
          maskPixels.data[offset + 2] = 255
          maskPixels.data[offset + 3] = weights[channel] * 255
        }
      }
      mask.context.putImageData(maskPixels, 0, 0)
    }
    worldTransform(hill.context)
    hill.context.clearRect(left, top, TILE, TILE)
    hill.context.fillStyle = repeatPattern(hill.context, material.plateau)
    hill.context.fillRect(left, top, TILE, TILE)
    hill.context.fillStyle = shading.plateauGlaze
    hill.context.fillRect(left, top, TILE, TILE)

    worldTransform(rock.context)
    rock.context.clearRect(left, top, TILE, TILE)
    rock.context.fillStyle = repeatPattern(rock.context, material.slope)
    rock.context.fillRect(left, top, TILE, TILE)
    writeMask('rock')
    rock.context.globalCompositeOperation = 'destination-in'
    drawField(rock.context)
    rock.context.globalCompositeOperation = 'source-over'
    hill.context.drawImage(rock.canvas, left, top, TILE, TILE)

    writeMask('lighting')
    drawField(hill.context)
    writeMask('coverage')
    hill.context.globalCompositeOperation = 'destination-in'
    drawField(hill.context)
    hill.context.globalCompositeOperation = 'source-over'

    // The continuous opacity fades inward from the rounded outline. Clip the
    // outer footprint so a neighboring water hazard never acquires hill art.
    target.save()
    target.beginPath()
    for (const face of levelFaces) {
      if (face.kind === 'hill-mask') appendTriangle(target, face.triangle)
    }
    target.clip()
    target.drawImage(hill.canvas, left, top, TILE, TILE)
    target.restore()
  }
}

/** Painter order: sand outside, deep water, translucent shallow shelves
 * clipped to water, narrow contact foam, then the textured mountain faces.
 * All patterns are world anchored across tile boundaries. */
export function paintTerrainBitmap(context: CanvasRenderingContext2D, items: readonly TerrainBitmapItem[], art: EnvironmentBitmapArt, tile: GroundTile, night = false): void {
  // Projected shadows were beneath the existing textured terrain overlay.
  // One combined path avoids double darkening on internal triangle edges.
  if (items.some(item => item.kind === 'hill-shadow')) {
    context.beginPath()
    for (const item of items) if (item.kind === 'hill-shadow') appendTriangle(context, item.triangle)
    context.fillStyle = night ? 'rgba(8,18,13,0.08)' : 'rgba(8,18,13,0.12)'
    context.fill()
  }
  const palette = art.terrainPalette
  const bankScale = palette.bankScale ?? 1
  const shallowScale = palette.shallowScale ?? 1
  // Overlapping low-opacity rounded bands disguise hard grid steps without
  // altering the authored shoreline or extending the opaque water mask.
  bankStroke(context, items, WATER_BANK_RADIUS * 2 * bankScale, palette.outerBank, 0.16)
  bankStroke(context, items, 23 * bankScale, palette.outerBank, 0.27)
  bankStroke(context, items, 18 * bankScale, repeatPattern(context, art.sand), 0.65)
  bankStroke(context, items, 13 * bankScale, repeatPattern(context, art.sand), 0.78)
  bankStroke(context, items, 8 * bankScale, palette.wetBank, 0.62)

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
  bankStroke(context, items, WATER_SHALLOW_RADIUS * 2 * shallowScale, palette.shallow[0], 0.10)
  bankStroke(context, items, 54 * shallowScale, palette.shallow[0], 0.14)
  bankStroke(context, items, 44 * shallowScale, palette.shallow[1], 0.16)
  bankStroke(context, items, 33 * shallowScale, palette.shallow[1], 0.16)
  bankStroke(context, items, 23 * shallowScale, palette.shallow[2], 0.18)
  bankStroke(context, items, 12 * shallowScale, palette.shallow[2], 0.20)
  bankStroke(context, items, 3 * shallowScale, palette.contact, 0.55)
  if (palette.waterDetail === 'oil-slicks') paintHarborOilSlicks(context, tile)
  context.restore()

  const faces = items.filter((item): item is ElevationFace => item.kind === 'slope' || item.kind === 'hill-mask')
  // A subtle contact shadow uses the same rounded bank as water; the
  // continuous field owns all interior rock and lighting transitions.
  bankStroke(context, items, 12, '#15202a', 0.055, 'hill-bank')
  if (faces.length > 0) paintHillBitmap(context, faces, art, tile)
}

function terrainTiles(geometry: TrackGeometry, art: EnvironmentBitmapArt, theme?: RacePaintTheme, part: 'all' | 'water' | 'hill' = 'all', limit: number = BITMAP_TILE_LIMIT, regionalCache?: RegionalTerrainMeshCache): BakeableBitmapTiles {
  return new CachedBitmapTiles(terrainBitmapIndex(geometry, Boolean(theme), part, regionalCache), (context, items, tile) => paintTerrainBitmap(context, items, art, tile, theme?.night), limit)
}

// Water does not depend on road grade. Editor road changes only rebuild the
// road/bridge passes and the hill pass (whose slope does depend on roads).
export function createEditorWaterBitmapTiles(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId, limit: number): BakeableBitmapTiles | undefined {
  const art = getEnvironmentBitmapArt(environment, night)
  return art ? terrainTiles(geometry, art, undefined, 'water', limit) : undefined
}

export function createEditorHillBitmapTiles(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId, limit: number, regionalCache?: RegionalTerrainMeshCache): BakeableBitmapTiles | undefined {
  const art = getEnvironmentBitmapArt(environment, night)
  return art ? terrainTiles(geometry, art, undefined, 'hill', limit, regionalCache) : undefined
}

export function createEditorRoadBitmapLayers(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId, shadowMode: TrackShadowMode): Omit<EnvironmentBitmapLayers, 'terrain'> | undefined {
  const art = getEnvironmentBitmapArt(environment, night)
  if (!art) return undefined
  const bridge = buildBridgePresentation(geometry, shadowMode)
  return {
    road: roadTiles(geometry, art),
    bridgeApproach: bridgeTiles(bridge, geometry, art, environment, night, true),
    bridgeDeck: bridgeTiles(bridge, geometry, art, environment, night, false),
  }
}

export interface EnvironmentBitmapLayers {
  readonly road: BakeableBitmapTiles
  readonly terrain: BakeableBitmapTiles
  readonly bridgeApproach: BakeableBitmapTiles | undefined
  readonly bridgeDeck: BakeableBitmapTiles | undefined
}

export function createMeadowBitmapLayers(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId, shadowMode: TrackShadowMode = 'terrain'): EnvironmentBitmapLayers | undefined {
  const art = getEnvironmentBitmapArt(environment, night)
  if (!art) return undefined
  const bridge = buildBridgePresentation(geometry, shadowMode)
  return {
    road: roadTiles(geometry, art),
    terrain: terrainTiles(geometry, art),
    bridgeApproach: bridgeTiles(bridge, geometry, art, environment, night, true),
    bridgeDeck: bridgeTiles(bridge, geometry, art, environment, night, false),
  }
}

/** Complete immutable race passes; streaming/editor/flyover keep their
 * original overlay sources and vector fallback. Walls keep their own depth. */
export interface RaceBitmapLayers extends EnvironmentBitmapLayers {
  readonly bridgeWalls: BakeableBitmapTiles | undefined
}

export function createRaceBitmapLayers(geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId): RaceBitmapLayers | undefined {
  const art = getEnvironmentBitmapArt(environment, night)
  if (!art) return undefined
  const theme = { environment, night }
  const passes = bridgeRenderPasses(buildBridgePresentation(geometry))
  return {
    road: roadTiles(geometry, art, theme),
    terrain: terrainTiles(geometry, art, theme),
    bridgeApproach: bridgeTiles([...passes.underlay, ...passes.rampApproach], geometry, art, environment, night, true, true),
    bridgeDeck: bridgeTiles(passes.deck, geometry, art, environment, night, false, true),
    bridgeWalls: bridgeTiles(passes.walls, geometry, art, environment, night, false, true),
  }
}

export function drawBitmapTiles(context: CanvasRenderingContext2D, tiles: BitmapTiles, view: GroundViewport): void {
  for (const tile of tiles.visible(view)) {
    context.drawImage(tiles.image(tile), tile.x * TILE, tile.y * TILE)
  }
}
