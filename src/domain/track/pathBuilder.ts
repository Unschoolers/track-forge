import { distance } from '@/domain/geometry/math'
import { ROAD_GEOMETRY, TRACK_CLOSE_DISTANCE } from '@/domain/config'
import type {
  RoadStructure,
  SurfaceId,
  TerrainMap,
  TrackPoint,
  Vector2,
} from '@/domain/model'
import {
  compileTerrainSurface,
  type TerrainSurface,
} from '@/domain/terrain/terrainSurface'
import {
  detectTrackCrossings,
  type TrackCrossing,
} from '@/domain/track/crossings'
import {
  buildRoadSurfaceProfile,
  type RoadSurfaceProfile,
} from '@/domain/track/roadSurface'

export interface RoadPathPoint extends Vector2 {
  readonly surface: SurfaceId
  readonly distance: number
  readonly segment: number
  readonly sectionId: string
  readonly structure: RoadStructure
}

export interface RoadPath {
  readonly points: readonly RoadPathPoint[]
  readonly totalLength: number
  readonly closed: boolean
  readonly terrainSurface: TerrainSurface
  readonly roadSurface: RoadSurfaceProfile
  readonly crossings: readonly TrackCrossing[]
}

export interface NearestPathPoint {
  readonly index: number
  readonly point: RoadPathPoint
  readonly distance: number
}

interface PathControl {
  readonly point: TrackPoint
  readonly sourceIndex: number
}

/** Stable identifier shared by compiled and authored road-section workflows. */
export function trackPointSectionId(
  point: Pick<TrackPoint, 'id'>,
  index: number,
): string {
  return point.id ?? `section-${index}`
}

function resampleByDistance(
  samples: readonly RoadPathPoint[],
  totalLength: number,
  closed: boolean,
  spacing = 6,
): readonly RoadPathPoint[] {
  if (samples.length < 2 || totalLength <= spacing) return samples
  const count = closed
    ? Math.max(4, Math.ceil(totalLength / spacing))
    : Math.max(2, Math.ceil(totalLength / spacing) + 1)
  const result: RoadPathPoint[] = []
  let segmentIndex = 0
  for (let index = 0; index < count; index += 1) {
    const target = closed
      ? (index / count) * totalLength
      : (index / (count - 1)) * totalLength
    while (
      segmentIndex < samples.length - 1 &&
      (samples[segmentIndex + 1]?.distance ?? totalLength) < target
    ) {
      segmentIndex += 1
    }
    const start = samples[segmentIndex]
    const end =
      samples[segmentIndex + 1] ?? (closed ? samples[0] : samples.at(-1))
    if (!start || !end) continue
    const startDistance = start.distance
    const endDistance =
      segmentIndex + 1 < samples.length ? end.distance : totalLength
    const ratio =
      endDistance > startDistance
        ? (target - startDistance) / (endDistance - startDistance)
        : 0
    result.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      surface: start.surface,
      segment: start.segment,
      sectionId: start.sectionId,
      structure: start.structure,
      distance: target,
    })
  }
  return result
}

function normalizePathControls(
  points: readonly TrackPoint[],
  closed: boolean,
): readonly PathControl[] {
  const rawCount = closed ? points.length - 1 : points.length
  const minimumSpacing = ROAD_GEOMETRY.surfaceWidth * 0.48
  const controls: PathControl[] = []
  for (let index = 0; index < rawCount; index += 1) {
    const point = points[index]
    if (!point) continue
    const previous = controls.at(-1)
    const isEndpoint = !closed && (index === 0 || index === rawCount - 1)
    if (
      previous &&
      !isEndpoint &&
      distance(previous.point, point) < minimumSpacing
    ) {
      continue
    }
    controls.push({ point, sourceIndex: index })
  }
  return controls
}

function boundedTangent(
  before: Vector2,
  point: Vector2,
  after: Vector2,
  segmentStart: Vector2,
  segmentEnd: Vector2,
  tension: number,
): Vector2 {
  const chord = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  }
  const chordLength = Math.max(0.001, Math.hypot(chord.x, chord.y))
  let direction = {
    x: after.x - before.x,
    y: after.y - before.y,
  }
  let directionLength = Math.hypot(direction.x, direction.y)
  if (directionLength < 0.001) {
    direction = chord
    directionLength = chordLength
  }
  const previousLength = distance(before, point)
  const nextLength = distance(point, after)
  const neighborLength = Math.min(
    previousLength > 0.001 ? previousLength : chordLength,
    nextLength > 0.001 ? nextLength : chordLength,
  )
  const tensionScale = 0.35 + Math.max(0, Math.min(1, tension)) * 1.3
  const magnitude =
    Math.min(chordLength * 0.65, neighborLength * 0.65) * tensionScale
  let tangent = {
    x: (direction.x / directionLength) * magnitude,
    y: (direction.y / directionLength) * magnitude,
  }
  if (tangent.x * chord.x + tangent.y * chord.y < 0) {
    tangent = {
      x: (chord.x / chordLength) * magnitude,
      y: (chord.y / chordLength) * magnitude,
    }
  }
  return tangent
}

function cubicBezier(
  start: Vector2,
  startControl: Vector2,
  endControl: Vector2,
  end: Vector2,
  t: number,
): Vector2 {
  const inverse = 1 - t
  const inverse2 = inverse * inverse
  const t2 = t * t
  return {
    x:
      inverse2 * inverse * start.x +
      3 * inverse2 * t * startControl.x +
      3 * inverse * t2 * endControl.x +
      t2 * t * end.x,
    y:
      inverse2 * inverse * start.y +
      3 * inverse2 * t * startControl.y +
      3 * inverse * t2 * endControl.y +
      t2 * t * end.y,
  }
}

export function buildRoadPath(
  points: readonly TrackPoint[],
  terrain: TerrainMap,
): RoadPath {
  if (points.length < 2) {
    const centerPath: readonly RoadPathPoint[] = []
    const terrainSurface = compileTerrainSurface(terrain, centerPath)
    const roadSurface = buildRoadSurfaceProfile(
      { points: centerPath, totalLength: 0, closed: false },
      terrainSurface,
    )
    return {
      points: centerPath,
      totalLength: 0,
      closed: false,
      terrainSurface,
      roadSurface,
      crossings: [],
    }
  }
  const samples: RoadPathPoint[] = []
  let totalLength = 0
  const first = points[0]
  const last = points.at(-1)
  const closed =
    first !== undefined &&
    last !== undefined &&
    points.length >= 3 &&
    distance(first, last) < TRACK_CLOSE_DISTANCE
  const controls = normalizePathControls(points, closed)
  const count = controls.length
  const segmentCount = closed ? count : count - 1

  for (let index = 0; index < segmentCount; index += 1) {
    const previousIndex = closed
      ? (index - 1 + count) % count
      : Math.max(0, index - 1)
    const nextIndex = closed ? (index + 1) % count : index + 1
    const followingIndex = closed
      ? (index + 2) % count
      : Math.min(count - 1, index + 2)
    const previousControl = controls[previousIndex]
    const startControl = controls[index]
    const endControl = controls[nextIndex]
    const followingControl = controls[followingIndex]
    if (
      !previousControl ||
      !startControl ||
      !endControl ||
      !followingControl
    ) {
      continue
    }
    const p0 = previousControl.point
    const p1 = startControl.point
    const p2 = endControl.point
    const p3 = followingControl.point

    const segmentLength = distance(p1, p2)
    const divisions = Math.max(4, Math.ceil(segmentLength / 9))
    for (let step = 0; step < divisions; step += 1) {
      const t = step / divisions
      const startTangent =
        p1.curve === 'corner'
          ? { x: 0, y: 0 }
          : boundedTangent(p0, p1, p2, p1, p2, p1.tension ?? 0.5)
      const endTangent =
        p2.curve === 'corner'
          ? { x: 0, y: 0 }
          : boundedTangent(p1, p2, p3, p1, p2, p2.tension ?? 0.5)
      const position = cubicBezier(
        p1,
        {
          x: p1.x + startTangent.x / 3,
          y: p1.y + startTangent.y / 3,
        },
        {
          x: p2.x - endTangent.x / 3,
          y: p2.y - endTangent.y / 3,
        },
        p2,
        t,
      )
      const previous = samples.at(-1)
      if (previous) totalLength += distance(previous, position)
      samples.push({
        ...position,
        surface: p1.surface,
        distance: totalLength,
        segment: startControl.sourceIndex,
        sectionId: trackPointSectionId(
          startControl.point,
          startControl.sourceIndex,
        ),
        structure: startControl.point.structure ?? 'surface',
      })
    }
  }
  if (closed) {
    const firstSample = samples[0]
    const finalSample = samples.at(-1)
    if (firstSample && finalSample) {
      totalLength += distance(finalSample, firstSample)
    }
  } else {
    const finalControl = controls.at(-1)
    const final = finalControl?.point
    const incomingControl = controls.at(-2) ?? finalControl
    const previous = samples.at(-1)
    if (final) {
      if (previous) totalLength += distance(previous, final)
      samples.push({
        ...final,
        surface: incomingControl?.point.surface ?? final.surface,
        distance: totalLength,
        segment:
          incomingControl?.sourceIndex ?? Math.max(0, segmentCount - 1),
        sectionId: trackPointSectionId(
          incomingControl?.point ?? final,
          incomingControl?.sourceIndex ?? Math.max(0, segmentCount - 1),
        ),
        structure: incomingControl?.point.structure ?? 'surface',
      })
    }
  }
  const centerPath = {
    points: resampleByDistance(samples, totalLength, closed),
    totalLength,
    closed,
  }
  const terrainSurface = compileTerrainSurface(
    terrain,
    centerPath.points,
    centerPath.closed,
  )
  const roadSurface = buildRoadSurfaceProfile(centerPath, terrainSurface)
  const path = {
    ...centerPath,
    terrainSurface,
    roadSurface,
  }
  return {
    ...path,
    crossings: detectTrackCrossings(path),
  }
}

export function nearestPathPoint(
  path: RoadPath,
  target: Vector2,
  start = 0,
  range = Number.POSITIVE_INFINITY,
): NearestPathPoint | undefined {
  let nearest: NearestPathPoint | undefined
  const inspect = (index: number): void => {
    const point = path.points[index]
    if (!point) return
    const candidateDistance = distance(point, target)
    if (!nearest || candidateDistance < nearest.distance) {
      nearest = { index, point, distance: candidateDistance }
    }
  }
  if (!Number.isFinite(range)) {
    path.points.forEach((_, index) => {
      inspect(index)
    })
  } else if (path.closed) {
    const count = path.points.length
    const center = ((Math.round(start) % count) + count) % count
    const radius = Math.min(count - 1, Math.max(0, Math.ceil(range)))
    for (let offset = -radius; offset <= radius; offset += 1) {
      inspect((center + offset + count) % count)
    }
  } else {
    const from = Math.max(0, Math.floor(start - range))
    const to = Math.min(path.points.length - 1, Math.ceil(start + range))
    for (let index = from; index <= to; index += 1) inspect(index)
  }
  return nearest
}
