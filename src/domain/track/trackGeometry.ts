import { ROAD_GEOMETRY } from '@/domain/config'
import { normalizeRouteKind, type SurfaceId, type Track, type Vector2 } from '@/domain/model'
import {
  buildRoadPath,
  type RoadPath,
  type RoadPathPoint,
} from '@/domain/track/pathBuilder'
import type { TrackCrossing } from '@/domain/track/crossings'
import { roadPointsForPreview } from '@/domain/track/roadLength'

export interface RoadRibbonSample {
  readonly center: RoadPathPoint
  readonly tangent: Vector2
  readonly normal: Vector2
  readonly left: Vector2
  readonly right: Vector2
  readonly edgeLeft: Vector2
  readonly edgeRight: Vector2
  readonly surface: SurfaceId
}

export interface ResolvedTrackStart {
  readonly distance: number
  readonly ratio: number
  readonly reversed: boolean
  readonly pathIndex: number
  readonly position: Vector2
  readonly tangent: Vector2
}

export interface TrackGeometry {
  readonly path: RoadPath
  readonly ribbon: readonly RoadRibbonSample[]
  readonly crossings: readonly TrackCrossing[]
  readonly start: ResolvedTrackStart
  readonly finish?: ResolvedTrackStart
}

function normalize(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y)
  return length > 0.000_1
    ? { x: vector.x / length, y: vector.y / length }
    : { x: 1, y: 0 }
}

function tangentAt(path: RoadPath, index: number): Vector2 {
  const count = path.points.length
  const current = path.points[index]
  const before = path.points[path.closed ? (index - 1 + count) % count : Math.max(0, index - 1)]
  const after = path.points[path.closed ? (index + 1) % count : Math.min(count - 1, index + 1)]
  if (!current || !before || !after) return { x: 1, y: 0 }
  return normalize({ x: after.x - before.x, y: after.y - before.y })
}

function offset(point: Vector2, normal: Vector2, amount: number): Vector2 {
  return {
    x: point.x + normal.x * amount,
    y: point.y + normal.y * amount,
  }
}

function nearestDistanceIndex(path: RoadPath, target: number): number {
  let low = 0
  let high = path.points.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const point = path.points[middle]
    if (point && point.distance < target) low = middle + 1
    else high = middle
  }
  return low
}

export function buildTrackGeometry(
  track: Pick<Track, 'points' | 'start' | 'terrain' | 'routeKind'>,
): TrackGeometry {
  const routeKind = normalizeRouteKind(track.routeKind)
  const pointToPoint = routeKind === 'point-to-point'
  const path = buildRoadPath(roadPointsForPreview(track), track.terrain, undefined, routeKind)
  const ribbon = buildRoadRibbon(path)
  const ratio = pointToPoint ? 0 : Math.max(0, Math.min(0.999_999, track.start?.ratio ?? 0))
  const distance = path.totalLength * ratio
  const pathIndex = nearestDistanceIndex(path, distance)
  const startSample = ribbon[pathIndex] ?? {
    center: { x: 0, y: 0, surface: 'street', distance: 0, segment: 0 },
    tangent: { x: 1, y: 0 },
  }
  return {
    path,
    ribbon,
    crossings: path.crossings,
    start: {
      distance,
      ratio,
      reversed: pointToPoint ? false : (track.start?.reversed ?? false),
      pathIndex,
      position: { x: startSample.center.x, y: startSample.center.y },
      tangent: startSample.tangent,
    },
    ...(pointToPoint && ribbon.length > 0 ? { finish: {
      distance: path.totalLength, ratio: 1, reversed: false,
      pathIndex: ribbon.length - 1,
      position: { x: ribbon[ribbon.length - 1]!.center.x, y: ribbon[ribbon.length - 1]!.center.y },
      tangent: ribbon[ribbon.length - 1]!.tangent,
    } } : {}),
  }
}

export function buildRoadRibbon(path: RoadPath): readonly RoadRibbonSample[] {
  const surfaceHalfWidth = ROAD_GEOMETRY.surfaceWidth / 2
  const edgeHalfWidth = ROAD_GEOMETRY.edgeWidth / 2
  return path.points.map((center, index): RoadRibbonSample => {
    const tangent = tangentAt(path, index)
    const normal = { x: -tangent.y, y: tangent.x }
    return {
      center,
      tangent,
      normal,
      left: offset(center, normal, surfaceHalfWidth),
      right: offset(center, normal, -surfaceHalfWidth),
      edgeLeft: offset(center, normal, edgeHalfWidth),
      edgeRight: offset(center, normal, -edgeHalfWidth),
      surface: center.surface,
    }
  })
}
