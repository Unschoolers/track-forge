import { TRACK_CLOSE_DISTANCE } from '@/domain/config'
import { EDITOR_LIMITS } from '@/domain/editor/editorGeometry'
import { distance } from '@/domain/geometry/math'
import { normalizeRouteKind, type Track, type TrackPoint } from '@/domain/model'

// Sampling and crossing work grow with road length, even for a few controls.
export const MAX_ROAD_CONTROL_LENGTH = 60_000

type RoadControls = Pick<Track, 'points' | 'routeKind'>

export function roadControlLength({ points, routeKind }: RoadControls): number {
  const first = points[0]
  if (!first) return 0
  let length = 0
  let previous = first
  for (const point of points) {
    length += distance(previous, point)
    previous = point
  }
  if (points.length >= 3 && normalizeRouteKind(routeKind) === 'circuit') {
    const gap = distance(first, previous)
    if (gap < TRACK_CLOSE_DISTANCE) length += gap
  }
  return length
}

/** Locate a previously completed loop with an exact closing point. */
export function recoverableCircuitPointCount({ points, routeKind }: RoadControls): number | undefined {
  const first = points[0]
  if (!first || normalizeRouteKind(routeKind) !== 'circuit') return undefined
  let length = 0
  let previous = first
  let count: number | undefined
  for (const [index, point] of points.entries()) {
    if (index === points.length - 1) break
    length += distance(previous, point)
    previous = point
    if (length > MAX_ROAD_CONTROL_LENGTH) break
    if (
      index + 1 >= EDITOR_LIMITS.minimumPoints &&
      length >= EDITOR_LIMITS.minimumTrackLength &&
      point.x === first.x && point.y === first.y
    ) {
      count = index + 1
    }
  }
  return count
}

export function roadPointsForPreview(track: RoadControls): readonly TrackPoint[] {
  if (roadControlLength(track) <= MAX_ROAD_CONTROL_LENGTH) return track.points
  const count = recoverableCircuitPointCount(track)
  return count === undefined ? [] : track.points.slice(0, count)
}
