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

export function triangulateTerrainComponent(
  component: TerrainComponent,
): readonly TerrainTriangle[] {
  const rings = [component.outer, ...component.holes]
  const yLevels = [...new Set(rings.flatMap(
    (ring) => ring.map(({ y }) => y),
  ))].sort((left, right) => left - right)
  const triangles: TerrainTriangle[] = []
  for (let index = 0; index < yLevels.length - 1; index += 1) {
    const top = yLevels[index]
    const bottom = yLevels[index + 1]
    if (top === undefined || bottom === undefined || bottom <= top) continue
    const sampleY = (top + bottom) / 2
    const intersections: number[] = []
    for (const ring of rings) {
      for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex += 1) {
        const start = ring[edgeIndex]
        const end = ring[(edgeIndex + 1) % ring.length]
        if (!start || !end || start.y === end.y) continue
        if (
          (start.y > sampleY) === (end.y > sampleY)
        ) {
          continue
        }
        intersections.push(
          start.x +
            ((sampleY - start.y) * (end.x - start.x)) /
              (end.y - start.y),
        )
      }
    }
    intersections.sort((left, right) => left - right)
    for (
      let intersectionIndex = 0;
      intersectionIndex < intersections.length - 1;
      intersectionIndex += 2
    ) {
      const left = intersections[intersectionIndex]
      const right = intersections[intersectionIndex + 1]
      if (left === undefined || right === undefined || right <= left) {
        continue
      }
      const topLeft = { x: left, y: top }
      const topRight = { x: right, y: top }
      const bottomRight = { x: right, y: bottom }
      const bottomLeft = { x: left, y: bottom }
      triangles.push(
        [topLeft, topRight, bottomRight],
        [topLeft, bottomRight, bottomLeft],
      )
    }
  }
  return triangles
}

/**
 * Tessellates grid-derived terrain into bounded quads. Splitting scanline
 * intervals directly avoids recursively dividing the short axis of very wide
 * strips, so output remains linear in authored terrain area.
 */
export function tileTerrainComponent(
  component: TerrainComponent,
  tileSize: number,
): readonly TerrainTriangle[] {
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error('Terrain tile size must be positive')
  }
  const rings = [component.outer, ...component.holes]
  const yLevels = [...new Set(rings.flatMap(
    (ring) => ring.map(({ y }) => y),
  ))].sort((left, right) => left - right)
  const triangles: TerrainTriangle[] = []

  for (let levelIndex = 0; levelIndex < yLevels.length - 1; levelIndex += 1) {
    const levelTop = yLevels[levelIndex]
    const levelBottom = yLevels[levelIndex + 1]
    if (
      levelTop === undefined ||
      levelBottom === undefined ||
      levelBottom <= levelTop
    ) {
      continue
    }
    const rowCount = Math.ceil((levelBottom - levelTop) / tileSize)
    for (let row = 0; row < rowCount; row += 1) {
      const top = levelTop + row * tileSize
      const bottom = Math.min(levelBottom, top + tileSize)
      const sampleY = (top + bottom) / 2
      const intersections: number[] = []
      for (const ring of rings) {
        for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex += 1) {
          const start = ring[edgeIndex]
          const end = ring[(edgeIndex + 1) % ring.length]
          if (!start || !end || start.y === end.y) continue
          if ((start.y > sampleY) === (end.y > sampleY)) continue
          intersections.push(
            start.x +
              ((sampleY - start.y) * (end.x - start.x)) /
                (end.y - start.y),
          )
        }
      }
      intersections.sort((left, right) => left - right)
      for (
        let intersectionIndex = 0;
        intersectionIndex < intersections.length - 1;
        intersectionIndex += 2
      ) {
        const left = intersections[intersectionIndex]
        const right = intersections[intersectionIndex + 1]
        if (left === undefined || right === undefined || right <= left) {
          continue
        }
        const columnCount = Math.ceil((right - left) / tileSize)
        for (let column = 0; column < columnCount; column += 1) {
          const tileLeft = left + column * tileSize
          const tileRight = Math.min(right, tileLeft + tileSize)
          const topLeft = { x: tileLeft, y: top }
          const topRight = { x: tileRight, y: top }
          const bottomRight = { x: tileRight, y: bottom }
          const bottomLeft = { x: tileLeft, y: bottom }
          triangles.push(
            [topLeft, topRight, bottomRight],
            [topLeft, bottomRight, bottomLeft],
          )
        }
      }
    }
  }
  return triangles
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
