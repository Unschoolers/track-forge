import { TERRAIN_LIMITS, WORLD_ELEVATION } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type { RoadInfluenceRegion, TerrainHeightSample, TerrainSurface } from '@/domain/terrain/terrainSurface'
import {
  projectSunShadow,
  WORLD_LIGHTING,
} from '@/phaser/rendering/lighting'
import { WeightedIdentityCache } from '@/phaser/rendering/terrainPresentationCache'
import {
  buildTerrainComponents,
  mapTerrainComponent,
  tileTerrainComponent,
  triangulateTerrainComponent,
  type TerrainComponent,
  type TerrainTriangle,
} from '@/phaser/rendering/terrainTopology'

type TerrainPrimitiveKind =
  | 'water'
  | 'shoreline'
  | 'hill-shadow'
  | 'hill-slope'
  | 'hill-plateau'

interface TerrainTextureLine {
  readonly start: Vector2
  readonly end: Vector2
}

interface TerrainPrimitiveBase {
  readonly kind: TerrainPrimitiveKind
  readonly height: number
}

interface WaterTerrainPrimitive extends TerrainPrimitiveBase {
  readonly kind: 'water'
  readonly triangles: readonly TerrainTriangle[]
  readonly texture: readonly TerrainTextureLine[]
}

interface ShorelineTerrainPrimitive extends TerrainPrimitiveBase {
  readonly kind: 'shoreline'
  readonly rings: readonly (readonly Vector2[])[]
}

interface HillShadowTerrainPrimitive extends TerrainPrimitiveBase {
  readonly kind: 'hill-shadow'
  readonly triangles: readonly TerrainTriangle[]
  readonly projectedDistance: number
}

interface HillSlopeFacet {
  readonly triangle: TerrainTriangle
  readonly shade: number
}

interface HillSlopeTerrainPrimitive extends TerrainPrimitiveBase {
  readonly kind: 'hill-slope'
  readonly triangles: readonly TerrainTriangle[]
  readonly facets: readonly HillSlopeFacet[]
}

interface HillPlateauTerrainPrimitive extends TerrainPrimitiveBase {
  readonly kind: 'hill-plateau'
  readonly triangles: readonly TerrainTriangle[]
}

export type TerrainPrimitive =
  | WaterTerrainPrimitive
  | ShorelineTerrainPrimitive
  | HillShadowTerrainPrimitive
  | HillSlopeTerrainPrimitive
  | HillPlateauTerrainPrimitive

const maximumTriangles =
  TERRAIN_LIMITS.maximumCells * 10
const maximumContourPoints =
  TERRAIN_LIMITS.maximumCells * 4
const maximumTextureLines =
  TERRAIN_LIMITS.maximumCells * 3
const maximumFacets =
  TERRAIN_LIMITS.maximumCells * 8
// A 4K batch leaves enough headroom below the 100-chunk ceiling for separate
// water, shoreline, shadow, slope, and plateau presentation passes.
const presentationChunkWeight = 4_096

export const TERRAIN_PRESENTATION_LIMITS = {
  trianglesPerCell: 10,
  maximumTriangles,
  maximumChunks: 100,
  maximumContourPoints,
  maximumTextureLines,
  trianglesPerChunk: presentationChunkWeight,
  maximumWeight:
    maximumTriangles +
    maximumFacets +
    maximumContourPoints +
    maximumTextureLines * 2,
} as const

export interface TerrainPresentationStats {
  readonly triangleCount: number
  readonly facetCount: number
  readonly chunkCount: number
  readonly contourPointCount: number
  readonly textureLineCount: number
  readonly weight: number
}

/**
 * Rendering-only LOD. Terrain physics and authored cells never change.
 * The overview mesh tiles each 32-unit cell once instead of four times.
 */
export type TerrainPresentationDetail = 'full' | 'overview'

export interface TerrainPresentation {
  readonly primitives: readonly TerrainPrimitive[]
  readonly stats: TerrainPresentationStats
}

export class TerrainPresentationBudgetError extends Error {
  constructor(
    readonly stats: TerrainPresentationStats,
    readonly sourceCellCount: number | undefined,
    detail: string,
  ) {
    super(`Terrain presentation budget exceeded: ${detail}`)
    this.name = 'TerrainPresentationBudgetError'
  }
}

const terrainPresentationCaches = {
  full: new WeightedIdentityCache<TerrainSurface, TerrainPresentation>(
    TERRAIN_PRESENTATION_LIMITS.maximumWeight * 2,
  ),
  overview: new WeightedIdentityCache<TerrainSurface, TerrainPresentation>(
    TERRAIN_PRESENTATION_LIMITS.maximumWeight,
  ),
} as const

function componentBounds(component: TerrainComponent): {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
} {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const point of component.outer) {
    left = Math.min(left, point.x)
    right = Math.max(right, point.x)
    top = Math.min(top, point.y)
    bottom = Math.max(bottom, point.y)
  }
  return { left, right, top, bottom }
}

/**
 * Generates a stable water material pattern from one compound component. Hole
 * containment is checked at both endpoints so texture never crosses an island.
 */
function waterTexture(
  component: TerrainComponent,
): readonly TerrainTextureLine[] {
  const { left, right, top, bottom } = componentBounds(component)
  const lines: TerrainTextureLine[] = []
  const spacing = 22
  const lineLength = 10

  for (let y = top + spacing / 2; y < bottom; y += spacing) {
    const row = Math.round((y - top) / spacing)
    const offset = row % 2 === 0 ? 0 : spacing / 2
    // The point-in-ring ray test only depends on intersections at this y.
    // Compute them once per ripple row, rather than scanning every coastline
    // edge twice for each 10-unit stroke (especially costly on large lakes).
    const intersections: number[] = []
    for (const ring of [component.outer, ...component.holes]) {
      for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index]
        const end = ring[(index + 1) % ring.length]
        if (!start || !end || (start.y > y) === (end.y > y)) continue
        intersections.push(start.x + ((y - start.y) * (end.x - start.x)) / (end.y - start.y))
      }
    }
    intersections.sort((a, b) => a - b)
    const inside = (x: number): boolean => {
      // Match the strict x < intersection parity used by pointInRing.
      let low = 0
      let high = intersections.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (x < (intersections[middle] ?? Number.NEGATIVE_INFINITY)) high = middle
        else low = middle + 1
      }
      return (intersections.length - low) % 2 === 1
    }
    for (let x = left + spacing / 2 + offset; x < right; x += spacing) {
      const start = { x: x - lineLength / 2, y }
      const end = { x: x + lineLength / 2, y }
      if (inside(start.x) && inside(end.x)) lines.push({ start, end })
    }
  }
  return lines
}

function hillTriangles(component: TerrainComponent, detail: TerrainPresentationDetail): readonly TerrainTriangle[] {
  return tileTerrainComponent(component, detail === 'overview'
    ? WORLD_ELEVATION.cellSize
    : WORLD_ELEVATION.cellSize / 2)
}

interface StaticTerrainGeometry {
  readonly waterTriangles: readonly TerrainTriangle[]
  readonly waterTextureLines: readonly TerrainTextureLine[]
  readonly shorelineRings: readonly (readonly Vector2[])[]
  readonly shadowTriangles: readonly TerrainTriangle[]
  readonly hills: readonly TerrainComponent[]
}

function buildStaticTerrainGeometry(surface: TerrainSurface): StaticTerrainGeometry {
  const waterTriangles: TerrainTriangle[] = []
  const waterTextureLines: TerrainTextureLine[] = []
  const shorelineRings: (readonly Vector2[])[] = []
  for (const component of buildTerrainComponents(surface.contours, 'water')) {
    for (const triangle of triangulateTerrainComponent(component)) waterTriangles.push(triangle)
    for (const line of waterTexture(component)) waterTextureLines.push(line)
    shorelineRings.push(component.outer, ...component.holes)
  }
  const shadowTriangles: TerrainTriangle[] = []
  const hills = buildTerrainComponents(surface.contours, 'hill')
  for (const component of hills) {
    const projected = mapTerrainComponent(component, point =>
      projectSunShadow(point, WORLD_ELEVATION.levelHeight))
    for (const triangle of triangulateTerrainComponent(projected)) shadowTriangles.push(triangle)
  }
  return { waterTriangles, waterTextureLines, shorelineRings, shadowTriangles, hills }
}

interface CachedHeightRegion {
  influence: RoadInfluenceRegion
  readonly samples: Map<string, TerrainHeightSample>
}

/** One editor's current terrain only. Retain static topology and at most the
 * full/overview quad centers, not every historical path or edit. Reuse samples
 * only when the canonical road lookup sees identical ordered candidates. */
export class RegionalTerrainMeshCache {
  private contours: TerrainSurface['contours'] | undefined
  private geometry: StaticTerrainGeometry | undefined
  private readonly triangles = {
    full: new Map<TerrainComponent, readonly TerrainTriangle[]>(),
    overview: new Map<TerrainComponent, readonly TerrainTriangle[]>(),
  }
  private readonly regions = new Map<string, CachedHeightRegion>()

  clear(): void {
    this.contours = undefined
    this.geometry = undefined
    this.triangles.full.clear()
    this.triangles.overview.clear()
    this.regions.clear()
  }

  staticGeometryFor(surface: TerrainSurface): StaticTerrainGeometry {
    if (this.contours !== surface.contours) {
      this.clear()
      this.contours = surface.contours
    }
    this.geometry ??= buildStaticTerrainGeometry(surface)
    return this.geometry
  }

  trianglesFor(component: TerrainComponent, detail: TerrainPresentationDetail): readonly TerrainTriangle[] {
    const cache = this.triangles[detail]
    const cached = cache.get(component)
    if (cached) return cached
    const triangles = hillTriangles(component, detail)
    cache.set(component, triangles)
    return triangles
  }

  sampleAt(surface: TerrainSurface, position: Vector2): TerrainHeightSample {
    const influence = surface.roadInfluenceRegionAt?.(position)
    if (!influence) return surface.heightSampleAt(position)
    let region = this.regions.get(influence.key)
    if (!region || region.influence.signature !== influence.signature) {
      region = { influence, samples: new Map() }
      this.regions.set(influence.key, region)
    } else {
      region.influence = influence
    }
    const key = `${position.x}:${position.y}`
    const cached = region.samples.get(key)
    if (cached) return cached
    const sample = surface.heightSampleAt(position)
    region.samples.set(key, sample)
    return sample
  }
}

function terrainHeightMesh(
  component: TerrainComponent,
  surface: TerrainSurface,
  detail: TerrainPresentationDetail,
  regionalCache?: RegionalTerrainMeshCache,
): {
  readonly slopes: readonly HillSlopeFacet[]
  readonly plateau: readonly TerrainTriangle[]
} {
  const triangles = regionalCache?.trianglesFor(component, detail) ?? hillTriangles(component, detail)
  const slopes: HillSlopeFacet[] = []
  const plateau: TerrainTriangle[] = []
  // Interior plateau tiles share an identical material. In overview mode,
  // fuse adjacent horizontal quads into one pair of triangles, leaving the
  // height/gradient samples and finely shaded boundary slopes untouched.
  let plateauRun: { left: number; right: number; top: number; bottom: number } | undefined
  const flushPlateau = (): void => {
    if (!plateauRun) return
    const { left, right, top, bottom } = plateauRun
    const topLeft = { x: left, y: top }
    const topRight = { x: right, y: top }
    const bottomRight = { x: right, y: bottom }
    const bottomLeft = { x: left, y: bottom }
    plateau.push([topLeft, topRight, bottomRight], [topLeft, bottomRight, bottomLeft])
    plateauRun = undefined
  }

  // tileTerrainComponent emits each quad as two consecutive triangles. Both
  // share one authoritative height/gradient sample and therefore one shade.
  for (let index = 0; index < triangles.length; index += 2) {
    const first = triangles[index]
    const second = triangles[index + 1]
    if (!first || !second) continue
    const center = {
      x: (first[0].x + first[2].x) / 2,
      y: (first[0].y + first[2].y) / 2,
    }
    const sample = regionalCache?.sampleAt(surface, center) ?? surface.heightSampleAt(center)
    if (sample.height >= WORLD_ELEVATION.levelHeight - 0.001) {
      if (detail === 'overview') {
        const top = first[0].y
        const bottom = first[2].y
        const left = first[0].x
        const right = first[1].x
        if (plateauRun && plateauRun.top === top && plateauRun.bottom === bottom &&
            plateauRun.right === left) {
          plateauRun.right = right
        } else {
          flushPlateau()
          plateauRun = { left, right, top, bottom }
        }
      } else {
        plateau.push(first, second)
      }
      continue
    }
    flushPlateau()
    const shade = clamp(
      -(
        sample.gradient.x * WORLD_LIGHTING.sunShadowDirection.x +
        sample.gradient.y * WORLD_LIGHTING.sunShadowDirection.y
      ),
      -1,
      1,
    )
    slopes.push(
      { triangle: first, shade },
      { triangle: second, shade },
    )
  }
  flushPlateau()
  return { slopes, plateau }
}

function chunks<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function weightedChunks<T>(
  values: readonly T[],
  weightOf: (value: T) => number,
  maximumWeight: number,
): readonly (readonly T[])[] {
  const result: T[][] = []
  let current: T[] = []
  let weight = 0
  for (const value of values) {
    const valueWeight = weightOf(value)
    if (current.length > 0 && weight + valueWeight > maximumWeight) {
      result.push(current)
      current = []
      weight = 0
    }
    current.push(value)
    weight += valueWeight
  }
  if (current.length > 0) result.push(current)
  return result
}

function buildUncachedPresentation(
  surface: TerrainSurface,
  detail: TerrainPresentationDetail,
  regionalCache?: RegionalTerrainMeshCache,
): TerrainPresentation {
  const { waterTriangles, waterTextureLines, shorelineRings, shadowTriangles, hills } =
    regionalCache?.staticGeometryFor(surface) ?? buildStaticTerrainGeometry(surface)
  const slopeFacets: HillSlopeFacet[] = []
  const plateauTriangles: TerrainTriangle[] = []
  for (const component of hills) {
    const mesh = terrainHeightMesh(component, surface, detail, regionalCache)
    for (const facet of mesh.slopes) slopeFacets.push(facet)
    for (const triangle of mesh.plateau) plateauTriangles.push(triangle)
  }

  const primitives: TerrainPrimitive[] = []
  const waterTriangleChunks = chunks(
    waterTriangles,
    TERRAIN_PRESENTATION_LIMITS.trianglesPerChunk,
  )
  const waterTextureChunks = chunks(
    waterTextureLines,
    TERRAIN_PRESENTATION_LIMITS.trianglesPerChunk,
  )
  for (
    let index = 0;
    index < Math.max(waterTriangleChunks.length, waterTextureChunks.length);
    index += 1
  ) {
    primitives.push({
      kind: 'water',
      triangles: waterTriangleChunks[index] ?? [],
      texture: waterTextureChunks[index] ?? [],
      height: WORLD_ELEVATION.baseHeight,
    })
  }
  for (const rings of weightedChunks(
    shorelineRings,
    (ring) => ring.length,
    TERRAIN_PRESENTATION_LIMITS.trianglesPerChunk,
  )) {
    primitives.push({
      kind: 'shoreline',
      rings,
      height: WORLD_ELEVATION.baseHeight,
    })
  }
  for (const triangles of chunks(
    shadowTriangles,
    TERRAIN_PRESENTATION_LIMITS.trianglesPerChunk,
  )) {
    primitives.push({
      kind: 'hill-shadow',
      triangles,
      height: WORLD_ELEVATION.baseHeight,
      projectedDistance:
        WORLD_ELEVATION.levelHeight *
        WORLD_LIGHTING.shadowLengthPerHeight,
    })
  }
  for (const facets of chunks(
    slopeFacets,
    TERRAIN_PRESENTATION_LIMITS.trianglesPerChunk,
  )) {
    primitives.push({
      kind: 'hill-slope',
      triangles: facets.map(({ triangle }) => triangle),
      facets,
      height: WORLD_ELEVATION.levelHeight,
    })
  }
  for (const triangles of chunks(
    plateauTriangles,
    TERRAIN_PRESENTATION_LIMITS.trianglesPerChunk,
  )) {
    primitives.push({
      kind: 'hill-plateau',
      triangles,
      height: WORLD_ELEVATION.levelHeight,
    })
  }

  const triangleCount =
    waterTriangles.length +
    shadowTriangles.length +
    slopeFacets.length +
    plateauTriangles.length
  const contourPointCount = surface.contours.reduce(
    (total, contour) => total + contour.points.length,
    0,
  )
  const stats: TerrainPresentationStats = {
    triangleCount,
    facetCount: slopeFacets.length,
    chunkCount: primitives.length,
    contourPointCount,
    textureLineCount: waterTextureLines.length,
    weight:
      triangleCount +
      slopeFacets.length +
      contourPointCount +
      waterTextureLines.length * 2,
  }
  const cellCount = surface.authoredCellCount
  const allowedTriangles = Math.min(
    TERRAIN_PRESENTATION_LIMITS.maximumTriangles,
    (cellCount ?? TERRAIN_LIMITS.maximumCells) *
      TERRAIN_PRESENTATION_LIMITS.trianglesPerCell,
  )
  const allowedContourPoints = Math.min(
    TERRAIN_PRESENTATION_LIMITS.maximumContourPoints,
    (cellCount ?? TERRAIN_LIMITS.maximumCells) * 4,
  )
  const allowedTextureLines = Math.min(
    TERRAIN_PRESENTATION_LIMITS.maximumTextureLines,
    (cellCount ?? TERRAIN_LIMITS.maximumCells) * 3,
  )
  const violations = [
    stats.triangleCount > allowedTriangles
      ? `${stats.triangleCount} triangles > ${allowedTriangles}`
      : undefined,
    stats.chunkCount > TERRAIN_PRESENTATION_LIMITS.maximumChunks
      ? `${stats.chunkCount} chunks > ${TERRAIN_PRESENTATION_LIMITS.maximumChunks}`
      : undefined,
    stats.contourPointCount > allowedContourPoints
      ? `${stats.contourPointCount} contour points > ${allowedContourPoints}`
      : undefined,
    stats.textureLineCount > allowedTextureLines
      ? `${stats.textureLineCount} texture lines > ${allowedTextureLines}`
      : undefined,
    stats.weight > TERRAIN_PRESENTATION_LIMITS.maximumWeight
      ? `${stats.weight} weight > ${TERRAIN_PRESENTATION_LIMITS.maximumWeight}`
      : undefined,
  ].filter((violation) => violation !== undefined)
  if (violations.length > 0) {
    throw new TerrainPresentationBudgetError(
      stats,
      cellCount,
      violations.join(', '),
    )
  }
  return { primitives, stats }
}

export function compileTerrainPresentation(
  surface: TerrainSurface,
  detail: TerrainPresentationDetail = 'full',
  regionalCache?: RegionalTerrainMeshCache,
): TerrainPresentation {
  const cache = terrainPresentationCaches[detail]
  const cached = cache.get(surface)
  if (cached) return cached
  const presentation = buildUncachedPresentation(surface, detail, regionalCache)
  cache.set(
    surface,
    presentation,
    Math.max(1, presentation.stats.weight),
  )
  return presentation
}

export function buildTerrainPresentation(
  surface: TerrainSurface,
  detail: TerrainPresentationDetail = 'full',
  regionalCache?: RegionalTerrainMeshCache,
): readonly TerrainPrimitive[] {
  return compileTerrainPresentation(surface, detail, regionalCache).primitives
}
