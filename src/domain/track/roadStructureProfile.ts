import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { RoadStructure, Vector2 } from '@/domain/model'

interface RoadStructurePathPoint extends Vector2 {
  readonly distance: number
  readonly sectionId: string
  readonly structure: RoadStructure
}

export interface RoadStructurePath {
  readonly points: readonly RoadStructurePathPoint[]
  readonly totalLength: number
  readonly closed: boolean
}

interface RoadStructureRun {
  readonly id: string
  readonly kind: 'overpass' | 'jump'
  readonly startIndex: number
  readonly endIndex: number
  readonly startDistance: number
  readonly endDistance: number
  readonly length: number
  readonly rampLength: number
  readonly wraps: boolean
}

interface RoadStructureSample {
  readonly height: number
  readonly runId: string | null
}

interface RoadStructureProfile {
  readonly runs: readonly RoadStructureRun[]
  at(pathIndex: number, segmentRatio?: number): RoadStructureSample
}

interface IndexRange {
  readonly start: number
  readonly end: number
}

function smootherstep(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function structureRanges(
  path: RoadStructurePath,
  kind: 'overpass' | 'jump',
): readonly IndexRange[] {
  const ranges: IndexRange[] = []
  let start = -1
  for (let index = 0; index < path.points.length; index += 1) {
    const overpass = path.points[index]?.structure === kind
    if (overpass && start < 0) start = index
    if (!overpass && start >= 0) {
      ranges.push({ start, end: index - 1 })
      start = -1
    }
  }
  if (start >= 0) ranges.push({ start, end: path.points.length - 1 })
  return ranges
}

function distanceAfterRun(
  path: RoadStructurePath,
  endIndex: number,
): number {
  const next = path.points[endIndex + 1]
  if (next) return next.distance
  return path.closed ? path.totalLength : path.points[endIndex]?.distance ?? 0
}

function deriveRuns(
  path: RoadStructurePath,
  kind: 'overpass' | 'jump',
): readonly RoadStructureRun[] {
  if (path.points.length === 0 || path.totalLength <= 0) return []
  const ranges = [...structureRanges(path, kind)]
  if (
    path.closed &&
    ranges.length > 1 &&
    ranges[0]?.start === 0 &&
    ranges.at(-1)?.end === path.points.length - 1
  ) {
    const first = ranges.shift()
    const last = ranges.pop()
    if (first && last) ranges.push({ start: last.start, end: first.end })
  }
  return ranges.map((range) => {
    const coversClosedLoop =
      path.closed &&
      range.start === 0 &&
      range.end === path.points.length - 1
    const wraps = range.start > range.end
    const startDistance = path.points[range.start]?.distance ?? 0
    const endDistance = distanceAfterRun(path, range.end)
    const length = wraps
      ? path.totalLength - startDistance + endDistance
      : Math.max(0, endDistance - startDistance)
    const sectionIds: string[] = []
    const inspect = (index: number): void => {
      const id = path.points[index]?.sectionId
      if (id && sectionIds.at(-1) !== id) sectionIds.push(id)
    }
    if (wraps) {
      for (let index = range.start; index < path.points.length; index += 1) {
        inspect(index)
      }
      for (let index = 0; index <= range.end; index += 1) inspect(index)
    } else {
      for (let index = range.start; index <= range.end; index += 1) {
        inspect(index)
      }
    }
    return {
      id: `${kind === 'jump' ? 'jump' : 'bridge'}:${sectionIds.join('|')}`,
      kind,
      startIndex: range.start,
      endIndex: range.end,
      startDistance,
      endDistance,
      length,
      // With no surface transition anywhere on a closed loop, a ramp would
      // create an artificial seam and a corresponding barrier opening.
      rampLength: coversClosedLoop
        ? 0
        : Math.min(ROAD_GEOMETRY.bridgeRampLength, length / 2),
      wraps,
    }
  })
}

function sampleIndex(path: RoadStructurePath, index: number): number {
  if (path.points.length === 0) return 0
  return path.closed
    ? ((index % path.points.length) + path.points.length) % path.points.length
    : Math.max(0, Math.min(path.points.length - 1, index))
}

function contains(run: RoadStructureRun, index: number): boolean {
  return run.wraps
    ? index >= run.startIndex || index <= run.endIndex
    : index >= run.startIndex && index <= run.endIndex
}

function distanceIntoRun(
  path: RoadStructurePath,
  run: RoadStructureRun,
  pathIndex: number,
  segmentRatio: number,
): number {
  const startDistance = path.points[pathIndex]?.distance ?? run.startDistance
  let distance = startDistance - run.startDistance
  if (run.wraps && pathIndex <= run.endIndex) {
    distance += path.totalLength
  }
  if (segmentRatio > 0) {
    const endDistance = path.points[pathIndex + 1]?.distance ?? path.totalLength
    distance += (endDistance - startDistance) * segmentRatio
  }
  return clamp(distance, 0, run.length)
}

export function buildRoadStructureProfile(
  path: RoadStructurePath,
): RoadStructureProfile {
  const runs = [...deriveRuns(path, 'overpass'), ...deriveRuns(path, 'jump')]
  const sample = (
    pathIndex: number,
    segmentRatio = 0,
  ): RoadStructureSample => {
    if (path.points.length === 0) return { height: 0, runId: null }
    const index = sampleIndex(path, pathIndex)
    const run = runs.find((candidate) => contains(candidate, index))
    if (!run || run.length <= 0) return { height: 0, runId: null }
    const along = distanceIntoRun(path, run, index, segmentRatio)
    const ratio =
      run.kind === 'jump' ? along / run.length :
      run.rampLength <= 0
        ? 1
        : along < run.rampLength
          ? smootherstep(along / run.rampLength)
          : along > run.length - run.rampLength
            ? smootherstep((run.length - along) / run.rampLength)
            : 1
    return {
      height: ratio * WORLD_ELEVATION.levelHeight,
      runId: run.id,
    }
  }
  const samples = path.points.map((_, index) => sample(index))
  return {
    runs,
    at(pathIndex: number, segmentRatio = 0): RoadStructureSample {
      if (segmentRatio > 0) return sample(pathIndex, segmentRatio)
      return samples[sampleIndex(path, pathIndex)] ?? {
        height: 0,
        runId: null,
      }
    },
  }
}
