import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type {
  TerrainKind,
  TerrainMap,
  Vector2,
} from '@/domain/model'
import { terrainCellKey } from '@/domain/terrain/terrainField'

export type TerrainMaterial = 'grass' | 'water'
type TerrainSlopeKind = 'natural' | 'road'

export interface TerrainContour {
  readonly kind: TerrainKind
  readonly points: readonly Vector2[]
}

export interface TerrainHeightSample {
  readonly height: number
  readonly gradient: Vector2
}

export interface TerrainSurface {
  readonly contours: readonly TerrainContour[]
  readonly authoredCellCount?: number
  heightSampleAt(position: Vector2): TerrainHeightSample
  heightAt(position: Vector2): number
  materialAt(position: Vector2): TerrainMaterial
  gradeAt(position: Vector2, slope: TerrainSlopeKind): number
}

interface BoundaryEdge {
  readonly start: Vector2
  readonly end: Vector2
  readonly component: number
}

interface RoadSegment {
  readonly start: Vector2
  readonly end: Vector2
}

interface RoadDistanceLookup {
  sampleAt(position: Vector2): DistanceSample
}

interface BoundaryDistanceLookup {
  sampleAt(position: Vector2, maximumDistance: number): DistanceSample
}

interface DistanceSample {
  readonly distance: number
  readonly gradient: Vector2
}

const openTerrainSurfaceCache = new WeakMap<
  TerrainMap,
  WeakMap<object, TerrainSurface>
>()
const closedTerrainSurfaceCache = new WeakMap<
  TerrainMap,
  WeakMap<object, TerrainSurface>
>()

function pointKey(point: Vector2): string {
  return `${point.x}:${point.y}`
}

function cellAt(position: Vector2, cellSize: number): {
  readonly column: number
  readonly row: number
} {
  return {
    column: Math.floor(position.x / cellSize),
    row: Math.floor(position.y / cellSize),
  }
}

function kindLookup(terrain: TerrainMap): ReadonlyMap<string, TerrainKind> {
  return new Map(
    terrain.cells.map((cell) => [terrainCellKey(cell), cell.kind]),
  )
}

function maskFor(
  lookup: ReadonlyMap<string, TerrainKind>,
  kind: TerrainKind,
): ReadonlySet<string> {
  return new Set(
    [...lookup.entries()]
      .filter(([, candidate]) => candidate === kind)
      .map(([key]) => key),
  )
}

function componentLookup(mask: ReadonlySet<string>): ReadonlyMap<string, number> {
  const components = new Map<string, number>()
  const offsets = [
    { column: 0, row: -1 },
    { column: 1, row: 0 },
    { column: 0, row: 1 },
    { column: -1, row: 0 },
  ] as const
  let component = 0
  for (const start of [...mask].sort()) {
    if (components.has(start)) continue
    const pending = [start]
    components.set(start, component)
    while (pending.length > 0) {
      const key = pending.pop()
      if (!key) continue
      const [columnText, rowText] = key.split(':')
      const column = Number(columnText)
      const row = Number(rowText)
      for (const offset of offsets) {
        const neighbor = `${column + offset.column}:${row + offset.row}`
        if (!mask.has(neighbor) || components.has(neighbor)) continue
        components.set(neighbor, component)
        pending.push(neighbor)
      }
    }
    component += 1
  }
  return components
}

function boundaryEdges(
  terrain: TerrainMap,
  mask: ReadonlySet<string>,
): readonly BoundaryEdge[] {
  const edges: BoundaryEdge[] = []
  const components = componentLookup(mask)
  const { cellSize } = terrain
  for (const cell of terrain.cells) {
    const key = terrainCellKey(cell)
    if (!mask.has(key)) continue
    const component = components.get(key)
    if (component === undefined) continue
    const left = cell.column * cellSize
    const right = left + cellSize
    const top = cell.row * cellSize
    const bottom = top + cellSize
    if (!mask.has(`${cell.column}:${cell.row - 1}`)) {
      edges.push({
        start: { x: left, y: top },
        end: { x: right, y: top },
        component,
      })
    }
    if (!mask.has(`${cell.column + 1}:${cell.row}`)) {
      edges.push({
        start: { x: right, y: top },
        end: { x: right, y: bottom },
        component,
      })
    }
    if (!mask.has(`${cell.column}:${cell.row + 1}`)) {
      edges.push({
        start: { x: right, y: bottom },
        end: { x: left, y: bottom },
        component,
      })
    }
    if (!mask.has(`${cell.column - 1}:${cell.row}`)) {
      edges.push({
        start: { x: left, y: bottom },
        end: { x: left, y: top },
        component,
      })
    }
  }
  return edges
}

function edgeDirection(edge: BoundaryEdge): number {
  if (edge.end.x > edge.start.x) return 0
  if (edge.end.y > edge.start.y) return 1
  if (edge.end.x < edge.start.x) return 2
  return 3
}

function turnPriority(
  incoming: BoundaryEdge,
  outgoing: BoundaryEdge,
): number {
  const turn =
    (edgeDirection(outgoing) - edgeDirection(incoming) + 4) % 4
  // Screen coordinates increase downward. With filled cells consistently on
  // the right, prefer right, straight, left, then the impossible U-turn.
  return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3
}

/**
 * Traces exposed directed half-edges with the filled component on the right.
 * Component-qualified vertices prevent diagonal islands from being stitched
 * together when they happen to share one geometric corner.
 */
function traceContours(
  kind: TerrainKind,
  edges: readonly BoundaryEdge[],
): readonly TerrainContour[] {
  const outgoing = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const key = `${edge.component}|${pointKey(edge.start)}`
    const candidates = outgoing.get(key)
    if (candidates) candidates.push(index)
    else outgoing.set(key, [index])
  })
  const visited = new Set<number>()
  const contours: TerrainContour[] = []
  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (visited.has(startIndex)) continue
    const first = edges[startIndex]
    if (!first) continue
    const points: Vector2[] = [first.start]
    let currentIndex = startIndex
    while (!visited.has(currentIndex)) {
      visited.add(currentIndex)
      const current = edges[currentIndex]
      if (!current) break
      points.push(current.end)
      if (pointKey(current.end) === pointKey(first.start)) break
      const next = (
        outgoing.get(`${current.component}|${pointKey(current.end)}`) ?? []
      )
        .filter((candidate) => !visited.has(candidate))
        .sort((leftIndex, rightIndex) => {
          const left = edges[leftIndex]
          const right = edges[rightIndex]
          if (!left || !right) return leftIndex - rightIndex
          return (
            turnPriority(current, left) - turnPriority(current, right) ||
            leftIndex - rightIndex
          )
        })[0]
      if (next === undefined) break
      currentIndex = next
    }
    if (points.length >= 4) {
      const last = points.at(-1)
      const closed =
        last?.x === first.start.x && last.y === first.start.y
      contours.push({
        kind,
        points: closed ? points.slice(0, -1) : points,
      })
    }
  }
  return contours
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function smoothstepDerivative(value: number): number {
  if (value <= 0 || value >= 1) return 0
  return 6 * value * (1 - value)
}

function compileBoundaryDistance(
  edges: readonly BoundaryEdge[],
  mask: ReadonlySet<string>,
  cellSize: number,
): BoundaryDistanceLookup {
  const buckets = new Map<string, BoundaryEdge[]>()
  for (const edge of edges) {
    const minimumColumn = Math.floor(
      Math.min(edge.start.x, edge.end.x) / cellSize,
    )
    const maximumX = Math.max(edge.start.x, edge.end.x)
    const maximumColumn =
      edge.start.x === edge.end.x
        ? Math.floor(maximumX / cellSize)
        : Math.ceil(maximumX / cellSize) - 1
    const minimumRow = Math.floor(
      Math.min(edge.start.y, edge.end.y) / cellSize,
    )
    const maximumY = Math.max(edge.start.y, edge.end.y)
    const maximumRow =
      edge.start.y === edge.end.y
        ? Math.floor(maximumY / cellSize)
        : Math.ceil(maximumY / cellSize) - 1
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      for (let row = minimumRow; row <= maximumRow; row += 1) {
        const key = `${column}:${row}`
        const contents = buckets.get(key)
        if (contents) contents.push(edge)
        else buckets.set(key, [edge])
      }
    }
  }
  return {
    sampleAt(position: Vector2, maximumDistance: number): DistanceSample {
      const coordinate = cellAt(position, cellSize)
      const inside = mask.has(terrainCellKey(coordinate))
      let nearestSquared = Number.POSITIVE_INFINITY
      let nearestOffsetX = 0
      let nearestOffsetY = 0
      const bucketRadius = Math.ceil(maximumDistance / cellSize)
      for (
        let column = coordinate.column - bucketRadius;
        column <= coordinate.column + bucketRadius;
        column += 1
      ) {
        for (
          let row = coordinate.row - bucketRadius;
          row <= coordinate.row + bucketRadius;
          row += 1
        ) {
          for (const edge of buckets.get(`${column}:${row}`) ?? []) {
            const segmentX = edge.end.x - edge.start.x
            const segmentY = edge.end.y - edge.start.y
            const lengthSquared =
              segmentX * segmentX + segmentY * segmentY
            const ratio =
              lengthSquared <= 0.000_001
                ? 0
                : clamp(
                    ((position.x - edge.start.x) * segmentX +
                      (position.y - edge.start.y) * segmentY) /
                      lengthSquared,
                    0,
                    1,
                  )
            const offsetX =
              position.x - (edge.start.x + segmentX * ratio)
            const offsetY =
              position.y - (edge.start.y + segmentY * ratio)
            const distanceSquared =
              offsetX * offsetX + offsetY * offsetY
            if (distanceSquared >= nearestSquared) continue
            nearestSquared = distanceSquared
            nearestOffsetX = offsetX
            nearestOffsetY = offsetY
          }
        }
      }
      const distance = Math.sqrt(nearestSquared)
      const direction =
        Number.isFinite(distance) && distance > 0.000_001
          ? {
              x: nearestOffsetX / distance,
              y: nearestOffsetY / distance,
            }
          : { x: 0, y: 0 }
      if (inside) {
        return { distance, gradient: direction }
      }
      return {
        distance: -distance,
        gradient: { x: -direction.x, y: -direction.y },
      }
    },
  }
}

function compileRoadDistance(
  centerPath: readonly Vector2[],
  closed: boolean,
): RoadDistanceLookup {
  const bucketSize = ROAD_GEOMETRY.edgeWidth
  const bucketRadius = Math.ceil(
    (ROAD_GEOMETRY.edgeWidth + WORLD_ELEVATION.cellSize) /
      bucketSize,
  )
  const buckets = new Map<string, RoadSegment[]>()
  const add = (column: number, row: number, segment: RoadSegment): void => {
    const key = `${column}:${row}`
    const contents = buckets.get(key)
    if (contents) contents.push(segment)
    else buckets.set(key, [segment])
  }
  const segments: RoadSegment[] = []
  for (let index = 0; index < centerPath.length - 1; index += 1) {
    const start = centerPath[index]
    const end = centerPath[index + 1]
    if (start && end) segments.push({ start, end })
  }
  if (closed && centerPath.length > 2) {
    const start = centerPath.at(-1)
    const end = centerPath[0]
    if (start && end) segments.push({ start, end })
  }
  if (centerPath.length === 1 && centerPath[0]) {
    segments.push({ start: centerPath[0], end: centerPath[0] })
  }
  for (const segment of segments) {
    const minimumColumn = Math.floor(
      Math.min(segment.start.x, segment.end.x) / bucketSize,
    )
    const maximumColumn = Math.floor(
      Math.max(segment.start.x, segment.end.x) / bucketSize,
    )
    const minimumRow = Math.floor(
      Math.min(segment.start.y, segment.end.y) / bucketSize,
    )
    const maximumRow = Math.floor(
      Math.max(segment.start.y, segment.end.y) / bucketSize,
    )
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      for (let row = minimumRow; row <= maximumRow; row += 1) {
        add(column, row, segment)
      }
    }
  }
  return {
    sampleAt(position: Vector2): DistanceSample {
      if (segments.length === 0) {
        return {
          distance: Number.POSITIVE_INFINITY,
          gradient: { x: 0, y: 0 },
        }
      }
      const centerColumn = Math.floor(position.x / bucketSize)
      const centerRow = Math.floor(position.y / bucketSize)
      let nearestSquared = Number.POSITIVE_INFINITY
      let nearestOffsetX = 0
      let nearestOffsetY = 0
      for (
        let column = centerColumn - bucketRadius;
        column <= centerColumn + bucketRadius;
        column += 1
      ) {
        for (
          let row = centerRow - bucketRadius;
          row <= centerRow + bucketRadius;
          row += 1
        ) {
          for (const segment of buckets.get(`${column}:${row}`) ?? []) {
            const segmentX = segment.end.x - segment.start.x
            const segmentY = segment.end.y - segment.start.y
            const lengthSquared =
              segmentX * segmentX + segmentY * segmentY
            const ratio =
              lengthSquared <= 0.000_001
                ? 0
                : clamp(
                    ((position.x - segment.start.x) * segmentX +
                      (position.y - segment.start.y) * segmentY) /
                      lengthSquared,
                    0,
                    1,
                  )
            const offsetX =
              position.x - (segment.start.x + segmentX * ratio)
            const offsetY =
              position.y - (segment.start.y + segmentY * ratio)
            const distanceSquared =
              offsetX * offsetX + offsetY * offsetY
            if (distanceSquared >= nearestSquared) continue
            nearestSquared = distanceSquared
            nearestOffsetX = offsetX
            nearestOffsetY = offsetY
          }
        }
      }
      const distance = Math.sqrt(nearestSquared)
      return {
        distance,
        gradient:
          Number.isFinite(distance) && distance > 0.000_001
            ? {
                x: nearestOffsetX / distance,
                y: nearestOffsetY / distance,
              }
            : { x: 0, y: 0 },
      }
    },
  }
}

export function compileTerrainSurface(
  terrain: TerrainMap,
  centerPath: readonly Vector2[],
  closed = false,
): TerrainSurface {
  const cacheKey = centerPath as object
  const cache = closed
    ? closedTerrainSurfaceCache
    : openTerrainSurfaceCache
  let surfacesByPath = cache.get(terrain)
  if (!surfacesByPath) {
    surfacesByPath = new WeakMap<object, TerrainSurface>()
    cache.set(terrain, surfacesByPath)
  }
  const cached = surfacesByPath.get(cacheKey)
  if (cached) return cached

  const lookup = kindLookup(terrain)
  const hillMask = maskFor(lookup, 'hill')
  const waterMask = maskFor(lookup, 'water')
  const hillEdges = boundaryEdges(terrain, hillMask)
  const hillDistance = compileBoundaryDistance(
    hillEdges,
    hillMask,
    terrain.cellSize,
  )
  const roadDistance = compileRoadDistance(centerPath, closed)
  const contours = [
    ...traceContours('water', boundaryEdges(terrain, waterMask)),
    ...traceContours('hill', hillEdges),
  ]
  const materialAt = (position: Vector2): TerrainMaterial => {
    const coordinate = cellAt(position, terrain.cellSize)
    return lookup.get(terrainCellKey(coordinate)) === 'water'
      ? 'water'
      : 'grass'
  }
  const heightSampleAt = (position: Vector2): TerrainHeightSample => {
    if (materialAt(position) === 'water') {
      return {
        height: WORLD_ELEVATION.baseHeight,
        gradient: { x: 0, y: 0 },
      }
    }
    const road = roadDistance.sampleAt(position)
    const blendRatio =
      (road.distance - ROAD_GEOMETRY.edgeWidth) /
      WORLD_ELEVATION.cellSize
    const roadBlend = 1 - smoothstep(blendRatio)
    const maximumBoundaryDistance =
      roadBlend > 0
        ? WORLD_ELEVATION.roadSlopeRun
        : WORLD_ELEVATION.naturalSlopeRun
    const boundary = hillDistance.sampleAt(
      position,
      maximumBoundaryDistance,
    )
    const inside = Math.max(0, boundary.distance)
    if (inside <= 0) {
      return {
        height: WORLD_ELEVATION.baseHeight,
        gradient: { x: 0, y: 0 },
      }
    }
    const naturalRatio = clamp(
      inside / WORLD_ELEVATION.naturalSlopeRun,
      0,
      1,
    )
    const roadRatio = clamp(
      inside / WORLD_ELEVATION.roadSlopeRun,
      0,
      1,
    )
    const naturalHeight =
      naturalRatio * WORLD_ELEVATION.levelHeight
    const roadHeight = roadRatio * WORLD_ELEVATION.levelHeight
    const naturalDerivative =
      inside < WORLD_ELEVATION.naturalSlopeRun
        ? WORLD_ELEVATION.levelHeight /
          WORLD_ELEVATION.naturalSlopeRun
        : 0
    const roadDerivative =
      inside < WORLD_ELEVATION.roadSlopeRun
        ? WORLD_ELEVATION.levelHeight /
          WORLD_ELEVATION.roadSlopeRun
        : 0
    const boundaryDerivative =
      naturalDerivative +
      (roadDerivative - naturalDerivative) * roadBlend
    const blendDerivative =
      -smoothstepDerivative(blendRatio) /
      WORLD_ELEVATION.cellSize
    const roadDerivativeScale =
      (roadHeight - naturalHeight) * blendDerivative
    return {
      height:
        naturalHeight + (roadHeight - naturalHeight) * roadBlend,
      gradient: {
        x:
          boundary.gradient.x * boundaryDerivative +
          road.gradient.x * roadDerivativeScale,
        y:
          boundary.gradient.y * boundaryDerivative +
          road.gradient.y * roadDerivativeScale,
      },
    }
  }
  const surface: TerrainSurface = {
    contours,
    authoredCellCount: terrain.cells.length,
    materialAt,
    heightSampleAt,
    heightAt(position: Vector2): number {
      return heightSampleAt(position).height
    },
    gradeAt(position: Vector2, slope: TerrainSlopeKind): number {
      if (materialAt(position) === 'water') return 0
      const coordinate = cellAt(position, terrain.cellSize)
      if (!hillMask.has(terrainCellKey(coordinate))) return 0
      const slopeRun =
        slope === 'road'
          ? WORLD_ELEVATION.roadSlopeRun
          : WORLD_ELEVATION.naturalSlopeRun
      const inside = Math.max(
        0,
        hillDistance.sampleAt(position, slopeRun).distance,
      )
      return inside >= 0 && inside < slopeRun
        ? WORLD_ELEVATION.levelHeight / slopeRun
        : 0
    },
  }
  surfacesByPath.set(cacheKey, surface)
  return surface
}
