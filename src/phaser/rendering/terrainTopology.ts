import type { TerrainKind, Vector2 } from '@/domain/model'
import type { TerrainContour } from '@/domain/terrain/terrainSurface'

export type TerrainTriangle = readonly [Vector2, Vector2, Vector2]

export interface TerrainComponent {
  readonly kind: TerrainKind
  readonly outer: readonly Vector2[]
  readonly holes: readonly (readonly Vector2[])[]
}

function signedPolygonArea(points: readonly Vector2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function pointInRing(
  point: Vector2,
  ring: readonly Vector2[],
): boolean {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    if (!currentPoint || !previousPoint) continue
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    if (crosses) inside = !inside
  }
  return inside
}

export function pointInTerrainComponent(
  point: Vector2,
  component: TerrainComponent,
): boolean {
  return (
    pointInRing(point, component.outer) &&
    !component.holes.some((hole) => pointInRing(point, hole))
  )
}

/**
 * The terrain compiler traces all filled boundaries with material on the
 * right, so outer rings share one winding and hole rings use the opposite
 * winding. Containment assigns every hole to its smallest enclosing outer.
 */
export function buildTerrainComponents(
  contours: readonly TerrainContour[],
  kind: TerrainKind,
): readonly TerrainComponent[] {
  const rings = contours
    .filter((contour) => contour.kind === kind && contour.points.length >= 3)
    .map((contour) => ({
      points: contour.points,
      area: signedPolygonArea(contour.points),
    }))
    .filter(({ area }) => Math.abs(area) > 0.001)
  const largest = [...rings].sort(
    (left, right) => Math.abs(right.area) - Math.abs(left.area),
  )[0]
  if (!largest) return []
  const outerSign = Math.sign(largest.area)
  const outers = rings.filter(({ area }) => Math.sign(area) === outerSign)
  const holes = rings.filter(({ area }) => Math.sign(area) !== outerSign)

  return outers.map((outer) => ({
    kind,
    outer: outer.points,
    holes: holes
      .filter((hole) => {
        const sample = hole.points[0]
        if (!sample || !pointInRing(sample, outer.points)) return false
        return !outers.some(
          (candidate) =>
            candidate !== outer &&
            Math.abs(candidate.area) < Math.abs(outer.area) &&
            pointInRing(sample, candidate.points),
        )
      })
      .map(({ points }) => points),
  }))
}

interface ScanEdge {
  readonly top: number
  readonly bottom: number
  readonly middle: number
}

/** Both Phaser's triangle batches and the bitmap tile painter must cover
 * precisely the same polygon, including diagonal edges and island holes.
 * The midpoint determines the edge ordering, not the shape of the fill. */
function tessellateTerrainComponent(
  component: TerrainComponent,
  tileSize: number,
): readonly TerrainTriangle[] {
  const rings = [component.outer, ...component.holes]
  const yLevels = [...new Set(rings.flatMap(
    (ring) => ring.map(({ y }) => y),
  ))].sort((left, right) => left - right)
  const triangles: TerrainTriangle[] = []
  for (let levelIndex = 0; levelIndex < yLevels.length - 1; levelIndex += 1) {
    const levelTop = yLevels[levelIndex]
    const levelBottom = yLevels[levelIndex + 1]
    if (levelTop === undefined || levelBottom === undefined || levelBottom <= levelTop) continue
    const rowCount = Math.ceil((levelBottom - levelTop) / tileSize) || 1
    for (let row = 0; row < rowCount; row += 1) {
      const top = levelTop + (Number.isFinite(tileSize) ? row * tileSize : 0)
      const bottom = Math.min(levelBottom, top + tileSize)
      const sampleY = (top + bottom) / 2
      const intersections: ScanEdge[] = []
      for (const ring of rings) {
        for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex += 1) {
          const start = ring[edgeIndex]
          const end = ring[(edgeIndex + 1) % ring.length]
          if (!start || !end || start.y === end.y ||
              (start.y > sampleY) === (end.y > sampleY)) continue
          const xAt = (y: number): number =>
            start.x + ((y - start.y) * (end.x - start.x)) / (end.y - start.y)
          intersections.push({ top: xAt(top), bottom: xAt(bottom), middle: xAt(sampleY) })
        }
      }
      intersections.sort((left, right) => left.middle - right.middle)
      for (let index = 0; index < intersections.length - 1; index += 2) {
        const left = intersections[index]
        const right = intersections[index + 1]
        if (!left || !right || right.middle <= left.middle) continue
        const topWidth = right.top - left.top
        const bottomWidth = right.bottom - left.bottom
        const columnCount = Math.ceil(Math.max(topWidth, bottomWidth) / tileSize) || 1
        for (let column = 0; column < columnCount; column += 1) {
          // Preserve existing grid quad alignment and hill height sampling;
          // angled sides instead interpolate each end of the trapezoid.
          const xAt = (edge: number, width: number, i: number): number =>
            topWidth === bottomWidth && Number.isFinite(tileSize)
              ? edge + Math.min(width, i * tileSize)
              : edge + width * i / columnCount
          const topLeft = { x: xAt(left.top, topWidth, column), y: top }
          const topRight = { x: xAt(left.top, topWidth, column + 1), y: top }
          const bottomLeft = { x: xAt(left.bottom, bottomWidth, column), y: bottom }
          const bottomRight = { x: xAt(left.bottom, bottomWidth, column + 1), y: bottom }
          if (topRight.x > topLeft.x) triangles.push([topLeft, topRight, bottomRight])
          if (bottomRight.x > bottomLeft.x) triangles.push([topLeft, bottomRight, bottomLeft])
        }
      }
    }
  }
  return triangles
}

export function triangulateTerrainComponent(
  component: TerrainComponent,
): readonly TerrainTriangle[] {
  return tessellateTerrainComponent(component, Number.POSITIVE_INFINITY)
}

/** Split into bounded tiles so a large lake does not become one huge
 * bitmap-index primitive. Orthogonal hill quads remain unchanged. */
export function tileTerrainComponent(
  component: TerrainComponent,
  tileSize: number,
): readonly TerrainTriangle[] {
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error('Terrain tile size must be positive')
  }
  return tessellateTerrainComponent(component, tileSize)
}

export function mapTerrainComponent(
  component: TerrainComponent,
  transform: (point: Vector2) => Vector2,
): TerrainComponent {
  return {
    kind: component.kind,
    outer: component.outer.map(transform),
    holes: component.holes.map((hole) => hole.map(transform)),
  }
}
