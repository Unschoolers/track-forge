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

export function tangentAt(path: RoadPath, index: number): Vector2 {
  const count = path.points.length
  const current = path.points[index]
  const before = path.points[path.closed ? (index - 1 + count) % count : Math.max(0, index - 1)]
  const after = path.points[path.closed ? (index + 1) % count : Math.min(count - 1, index + 1)]
  if (!current || !before || !after) return { x: 1, y: 0 }
  return normalize({ x: after.x - before.x, y: after.y - before.y })
}

/** Gate stripes and swept timing use the road ribbon's local tangent at samples. */
export function roadGateGeometry(path: RoadPath, position: number) {
  const count = path.points.length
  if (count < 2 || !Number.isFinite(position) || position < 0 || position > count - (path.closed ? 0 : 1)) return undefined
  const lower = Math.min(path.closed ? count - 1 : count - 2, Math.floor(position))
  const a = path.points[lower]
  const b = path.points[(lower + 1) % count]
  if (!a || !b) return undefined
  const fraction = position - lower
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.hypot(dx, dy) < 0.001) return undefined
  const tangent = Number.isInteger(position)
    ? tangentAt(path, position % count)
    : normalize({ x: dx, y: dy })
  return { lower, center: { x: a.x + dx * fraction, y: a.y + dy * fraction }, tangent }
}

/**
 * The cross-section of the contiguous local road at the gate. In a sharp
 * corner the inner verge is farther along the stripe than the nominal road
 * radius. Intersect the same sampled road-support discs used by physics with
 * the gate plane, stopping at the first gap in either route direction.
 * Nearby but disconnected road arms cannot enlarge the gate.
 */
export function roadGateSpan(path: RoadPath, position: number, radius: number): { min: number; max: number } {
  const geometry = roadGateGeometry(path, position)
  let min = -radius
  let max = radius
  if (!geometry || !Number.isFinite(radius) || radius <= 0) return { min, max }
  const { center, tangent } = geometry
  const count = path.points.length
  const lower = Math.floor(position)
  for (const direction of [-1, 1]) {
    const start = direction < 0 ? lower : Math.ceil(position)
    for (let step = 0; step <= Math.min(12, count - 1); step++) {
      const raw = start + direction * step
      if (!path.closed && (raw < 0 || raw >= count)) break
      const sample = path.points[((raw % count) + count) % count]
      if (!sample) break
      const dx = sample.x - center.x
      const dy = sample.y - center.y
      const along = dx * tangent.x + dy * tangent.y
      if (Math.abs(along) > radius) break
      const across = -dx * tangent.y + dy * tangent.x
      const half = Math.sqrt(Math.max(0, radius * radius - along * along))
      const left = across - half
      const right = across + half
      if (left > max || right < min) break
      min = Math.min(min, left)
      max = Math.max(max, right)
    }
  }
  return { min, max }
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
