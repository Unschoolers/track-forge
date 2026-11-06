import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import type {
  SurfaceId,
  Vector2,
} from '@/domain/model'
import type {
  RoadPath,
  RoadPathPoint,
} from '@/domain/track/pathBuilder'

export interface TrackCrossing {
  readonly key: string
  readonly position: Vector2
  readonly firstSegment: number
  readonly secondSegment: number
  readonly firstPathIndex: number
  readonly secondPathIndex: number
  readonly firstTangent: Vector2
  readonly secondTangent: Vector2
  readonly firstSurface: SurfaceId
  readonly secondSurface: SurfaceId
  readonly polygon: readonly [Vector2, Vector2, Vector2, Vector2]
  readonly bridgeHalfLength: number
  readonly upperSegment: number | null
  readonly firstHeight: number
  readonly secondHeight: number
  readonly upperPathIndex: number | null
}

interface Intersection {
  readonly position: Vector2
  readonly leftRatio: number
  readonly rightRatio: number
}

interface SegmentCandidate {
  readonly index: number
  readonly start: RoadPathPoint
  readonly end: RoadPathPoint
}

export class CrossingWorkLimitError extends Error {
  constructor() {
    super('Track crossing analysis exceeds the permitted work budget.')
    this.name = 'CrossingWorkLimitError'
  }
}

export function crossingKey(firstSegment: number, secondSegment: number): string {
  return firstSegment < secondSegment
    ? `${firstSegment}:${secondSegment}`
    : `${secondSegment}:${firstSegment}`
}

function cross(left: Vector2, right: Vector2): number {
  return left.x * right.y - left.y * right.x
}

function subtract(left: Vector2, right: Vector2): Vector2 {
  return { x: left.x - right.x, y: left.y - right.y }
}

function normalize(vector: Vector2): Vector2 {
  const length = Math.max(0.0001, Math.hypot(vector.x, vector.y))
  return { x: vector.x / length, y: vector.y / length }
}

function segmentIntersection(
  leftStart: Vector2,
  leftEnd: Vector2,
  rightStart: Vector2,
  rightEnd: Vector2,
): Intersection | undefined {
  const left = subtract(leftEnd, leftStart)
  const right = subtract(rightEnd, rightStart)
  const denominator = cross(left, right)
  const scale = Math.max(
    0.0001,
    Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y),
  )
  if (Math.abs(denominator) / scale < 0.25) return undefined
  const offset = subtract(rightStart, leftStart)
  const leftRatio = cross(offset, right) / denominator
  const rightRatio = cross(offset, left) / denominator
  const epsilon = 0.001
  if (
    leftRatio <= epsilon ||
    leftRatio >= 1 - epsilon ||
    rightRatio <= epsilon ||
    rightRatio >= 1 - epsilon
  ) {
    return undefined
  }
  return {
    position: {
      x: leftStart.x + left.x * leftRatio,
      y: leftStart.y + left.y * leftRatio,
    },
    leftRatio,
    rightRatio,
  }
}

function lineIntersection(
  leftPoint: Vector2,
  leftDirection: Vector2,
  rightPoint: Vector2,
  rightDirection: Vector2,
): Vector2 {
  const denominator = cross(leftDirection, rightDirection)
  const ratio =
    cross(subtract(rightPoint, leftPoint), rightDirection) / denominator
  return {
    x: leftPoint.x + leftDirection.x * ratio,
    y: leftPoint.y + leftDirection.y * ratio,
  }
}

function intersectionPolygon(
  position: Vector2,
  firstTangent: Vector2,
  secondTangent: Vector2,
): readonly [Vector2, Vector2, Vector2, Vector2] {
  const halfWidth = ROAD_GEOMETRY.surfaceWidth / 2
  const firstNormal = { x: -firstTangent.y, y: firstTangent.x }
  const secondNormal = { x: -secondTangent.y, y: secondTangent.x }
  const corners: Vector2[] = []
  for (const firstSign of [-1, 1] as const) {
    for (const secondSign of [-1, 1] as const) {
      corners.push(
        lineIntersection(
          {
            x: position.x + firstNormal.x * halfWidth * firstSign,
            y: position.y + firstNormal.y * halfWidth * firstSign,
          },
          firstTangent,
          {
            x: position.x + secondNormal.x * halfWidth * secondSign,
            y: position.y + secondNormal.y * halfWidth * secondSign,
          },
          secondTangent,
        ),
      )
    }
  }
  corners.sort(
    (left, right) =>
      Math.atan2(left.y - position.y, left.x - position.x) -
      Math.atan2(right.y - position.y, right.x - position.x),
  )
  const [first, second, third, fourth] = corners
  if (!first || !second || !third || !fourth) {
    throw new Error('Crossing polygon requires four corners')
  }
  return [first, second, third, fourth]
}

function sourceSegmentsAdjacent(
  first: number,
  second: number,
  sourceSegmentCount: number,
): boolean {
  const difference = Math.abs(first - second)
  return difference <= 1 || difference === sourceSegmentCount - 1
}

function crossingCandidates(
  path: Pick<RoadPath, 'points' | 'closed'>,
  maximumPairChecks: number,
): readonly [SegmentCandidate, SegmentCandidate][] {
  const segmentCount = path.closed ? path.points.length : path.points.length - 1
  const cellSize = ROAD_GEOMETRY.edgeWidth * 2
  const cells = new Map<string, SegmentCandidate[]>()
  const segments: SegmentCandidate[] = []
  for (let index = 0; index < segmentCount; index += 1) {
    const start = path.points[index]
    const end = path.points[(index + 1) % path.points.length]
    if (!start || !end) continue
    const segment = { index, start, end }
    segments.push(segment)
    const minX = Math.floor(Math.min(start.x, end.x) / cellSize)
    const maxX = Math.floor(Math.max(start.x, end.x) / cellSize)
    const minY = Math.floor(Math.min(start.y, end.y) / cellSize)
    const maxY = Math.floor(Math.max(start.y, end.y) / cellSize)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`
        const contents = cells.get(key)
        if (contents) contents.push(segment)
        else cells.set(key, [segment])
      }
    }
  }
  const pairs = new Map<string, [SegmentCandidate, SegmentCandidate]>()
  let pairChecks = 0
  for (const contents of cells.values()) {
    for (let left = 0; left < contents.length; left += 1) {
      for (let right = left + 1; right < contents.length; right += 1) {
        if (++pairChecks > maximumPairChecks) throw new CrossingWorkLimitError()
        const first = contents[left]
        const second = contents[right]
        if (!first || !second) continue
        const low = first.index < second.index ? first : second
        const high = first.index < second.index ? second : first
        if (high.index - low.index <= 1) continue
        if (path.closed && low.index === 0 && high.index === segmentCount - 1) {
          continue
        }
        pairs.set(`${low.index}:${high.index}`, [low, high])
      }
    }
  }
  return [...pairs.values()]
}

export function detectTrackCrossings(
  path: Pick<
    RoadPath,
    'points' | 'closed' | 'totalLength' | 'roadSurface'
  >,
  maximumPairChecks = Infinity,
): readonly TrackCrossing[] {
  if (path.points.length < 4) return []
  const sourceSegmentCount =
    Math.max(...path.points.map((point) => point.segment)) + 1
  const byKey = new Map<string, TrackCrossing>()
  for (const [left, right] of crossingCandidates(path, maximumPairChecks)) {
      const leftIndex = left.index
      const rightIndex = right.index
      const leftStart = left.start
      const leftEnd = left.end
      const rightStart = right.start
      const rightEnd = right.end
      const leftSource = leftStart.segment
      const rightSource = rightStart.segment
      if (
        leftSource === rightSource ||
        sourceSegmentsAdjacent(leftSource, rightSource, sourceSegmentCount)
      ) {
        continue
      }
      const key = crossingKey(leftSource, rightSource)
      if (byKey.has(key)) continue
      const hit = segmentIntersection(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
      )
      if (!hit) continue
      const leftTangent = normalize(subtract(leftEnd, leftStart))
      const rightTangent = normalize(subtract(rightEnd, rightStart))
      const ordered =
        leftSource < rightSource
          ? {
              firstSegment: leftSource,
              secondSegment: rightSource,
              firstPathIndex: leftIndex,
              secondPathIndex: rightIndex,
              firstTangent: leftTangent,
              secondTangent: rightTangent,
              firstSurface: leftStart.surface,
              secondSurface: rightStart.surface,
            }
          : {
              firstSegment: rightSource,
              secondSegment: leftSource,
              firstPathIndex: rightIndex,
              secondPathIndex: leftIndex,
              firstTangent: rightTangent,
              secondTangent: leftTangent,
              firstSurface: rightStart.surface,
              secondSurface: leftStart.surface,
            }
      const firstHeight = path.roadSurface.at(
        ordered.firstPathIndex,
        hit.position,
      ).height
      const secondHeight = path.roadSurface.at(
        ordered.secondPathIndex,
        hit.position,
      ).height
      const heightDifference = firstHeight - secondHeight
      const sectionUpperSegment =
        Math.abs(heightDifference) <
        WORLD_ELEVATION.levelHeight * 0.08
          ? null
          : heightDifference > 0
            ? ordered.firstSegment
            : ordered.secondSegment
      const upperSegment = sectionUpperSegment
      const upperPathIndex =
        upperSegment === ordered.firstSegment
          ? ordered.firstPathIndex
          : upperSegment === ordered.secondSegment
            ? ordered.secondPathIndex
            : null
      const sine = Math.max(
        0.25,
        Math.abs(cross(ordered.firstTangent, ordered.secondTangent)),
      )
      byKey.set(key, {
        key,
        position: hit.position,
        ...ordered,
        polygon: intersectionPolygon(
          hit.position,
          ordered.firstTangent,
          ordered.secondTangent,
        ),
        bridgeHalfLength: ROAD_GEOMETRY.surfaceWidth / (2 * sine) + 24,
        upperSegment,
        firstHeight,
        secondHeight,
        upperPathIndex,
      })
  }
  return [...byKey.values()]
}
