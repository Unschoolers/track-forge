import { ROAD_GEOMETRY } from '@/domain/config'
import type { Track, Vector2 } from '@/domain/model'
import {
  nearestPathPoint,
  trackPointSectionId,
} from '@/domain/track/pathBuilder'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { findRoadWaterExposure } from '@/domain/track/waterExposure'

export type TrackDiagnosticSeverity = 'error' | 'warning'

export type TrackRepair =
  | { readonly type: 'smooth-point'; readonly index: number }
  | {
      readonly type: 'flatten-crossing'
      readonly firstSegment: number
      readonly secondSegment: number
    }
  | { readonly type: 'remove-tree'; readonly index: number }
  | {
      readonly type: 'raise-road-sections'
      readonly sectionIds: readonly string[]
    }
  | { readonly type: 'move-start'; readonly ratio: number }

export interface TrackDiagnostic {
  readonly id: string
  readonly severity: TrackDiagnosticSeverity
  readonly message: string
  readonly position: Vector2
  readonly repair: TrackRepair
}

function shallowIntersection(
  firstStart: Vector2,
  firstEnd: Vector2,
  secondStart: Vector2,
  secondEnd: Vector2,
): { readonly position: Vector2; readonly sine: number } | undefined {
  const first = {
    x: firstEnd.x - firstStart.x,
    y: firstEnd.y - firstStart.y,
  }
  const second = {
    x: secondEnd.x - secondStart.x,
    y: secondEnd.y - secondStart.y,
  }
  const denominator = first.x * second.y - first.y * second.x
  const lengths = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y)
  if (lengths < 0.001) return undefined
  const sine = Math.abs(denominator) / lengths
  if (sine < 0.08 || sine >= 0.35) return undefined
  const offset = {
    x: secondStart.x - firstStart.x,
    y: secondStart.y - firstStart.y,
  }
  const firstRatio =
    (offset.x * second.y - offset.y * second.x) / denominator
  const secondRatio =
    (offset.x * first.y - offset.y * first.x) / denominator
  if (
    firstRatio <= 0 ||
    firstRatio >= 1 ||
    secondRatio <= 0 ||
    secondRatio >= 1
  ) {
    return undefined
  }
  return {
    sine,
    position: {
      x: firstStart.x + first.x * firstRatio,
      y: firstStart.y + first.y * firstRatio,
    },
  }
}

function contiguousSectionGroups(
  sections: ReadonlySet<number>,
  sectionCount: number,
  closed: boolean,
): readonly (readonly number[])[] {
  const groups: number[][] = []
  for (const section of [...sections].sort((left, right) => left - right)) {
    const current = groups.at(-1)
    if (current?.at(-1) === section - 1) current.push(section)
    else groups.push([section])
  }
  const first = groups[0]
  const last = groups.at(-1)
  if (
    closed &&
    groups.length > 1 &&
    first?.[0] === 0 &&
    last?.at(-1) === sectionCount - 1
  ) {
    return [[...last, ...first], ...groups.slice(1, -1)]
  }
  return groups
}

export function analyzeTrack(
  track: Track,
  geometry: TrackGeometry,
): readonly TrackDiagnostic[] {
  const diagnostics: TrackDiagnostic[] = []
  const controlCount = track.points.length - 1
  for (let first = 0; first < controlCount; first += 1) {
    const firstStart = track.points[first]
    const firstEnd = track.points[first + 1]
    if (!firstStart || !firstEnd) continue
    for (let second = first + 2; second < controlCount; second += 1) {
      if (first === 0 && second === controlCount - 1) continue
      const secondStart = track.points[second]
      const secondEnd = track.points[second + 1]
      if (!secondStart || !secondEnd) continue
      const hit = shallowIntersection(
        firstStart,
        firstEnd,
        secondStart,
        secondEnd,
      )
      if (!hit) continue
      diagnostics.push({
        id: `shallow-crossing:${first}:${second}`,
        severity: 'warning',
        message: 'Crossing angle is too shallow for a readable junction.',
        position: hit.position,
        repair: { type: 'smooth-point', index: second },
      })
    }
  }
  for (const crossing of geometry.crossings) {
    const startDistance = Math.hypot(
      geometry.start.position.x - crossing.position.x,
      geometry.start.position.y - crossing.position.y,
    )
    if (startDistance < crossing.bridgeHalfLength + ROAD_GEOMETRY.edgeWidth) {
      diagnostics.push({
        id: `unsafe-start:${crossing.key}`,
        severity: 'error',
        message: 'Move the start grid away from this crossing.',
        position: geometry.start.position,
        repair: {
          type: 'move-start',
          ratio: (geometry.start.ratio + 0.125) % 1,
        },
      })
    }
    if (crossing.upperSegment !== null) {
      const conflict = geometry.crossings.find(
        (candidate) =>
          candidate.key !== crossing.key &&
          candidate.upperSegment === crossing.upperSegment &&
          Math.hypot(
            candidate.position.x - crossing.position.x,
            candidate.position.y - crossing.position.y,
          ) <
            crossing.bridgeHalfLength +
              candidate.bridgeHalfLength +
              ROAD_GEOMETRY.surfaceWidth * 2.7,
      )
      if (conflict && crossing.key < conflict.key) {
        diagnostics.push({
          id: `ramp-conflict:${crossing.key}:${conflict.key}`,
          severity: 'error',
          message: 'Bridge approaches overlap; flatten one crossing.',
          position: crossing.position,
          repair: {
            type: 'flatten-crossing',
            firstSegment: crossing.firstSegment,
            secondSegment: crossing.secondSegment,
          },
        })
      }
    }
  }
  const surfaceWaterPositions = new Map<number, Vector2>()
  geometry.path.points.forEach((point, index) => {
    const surface = geometry.path.roadSurface.at(index)
    const exposure = findRoadWaterExposure(geometry.path, index)
    if (
      point.structure === 'surface' &&
      surface.structureRunId === null &&
      exposure
    ) {
      if (!surfaceWaterPositions.has(point.segment)) {
        surfaceWaterPositions.set(point.segment, exposure)
      }
    }
  })
  const sectionCount =
    Math.max(-1, ...geometry.path.points.map(({ segment }) => segment)) + 1
  for (const sections of contiguousSectionGroups(
    new Set(surfaceWaterPositions.keys()),
    sectionCount,
    geometry.path.closed,
  )) {
    const sectionIds = sections.flatMap((index) => {
      const point = track.points[index]
      return point ? [trackPointSectionId(point, index)] : []
    })
    const position = sections
      .map((section) => surfaceWaterPositions.get(section))
      .find((candidate) => candidate !== undefined)
    if (!position || sectionIds.length === 0) continue
    diagnostics.push({
      id: `surface-road-in-water:${sectionIds.join('|')}`,
      severity: 'error',
      message: 'Surface road crosses water; raise these sections as an overpass.',
      position,
      repair: { type: 'raise-road-sections', sectionIds },
    })
  }
  track.trees.forEach((tree, index) => {
    if (geometry.path.terrainSurface.materialAt(tree) === 'water') {
      diagnostics.push({
        id: `tree-in-water:${index}`,
        severity: 'warning',
        message: 'Scenery stands in water.',
        position: tree,
        repair: { type: 'remove-tree', index },
      })
    }
    const nearest = nearestPathPoint(geometry.path, tree)
    if (nearest && nearest.distance < ROAD_GEOMETRY.edgeWidth / 2 + 8) {
      diagnostics.push({
        id: `tree-on-road:${index}`,
        severity: 'warning',
        message: 'Scenery overlaps the road.',
        position: tree,
        repair: { type: 'remove-tree', index },
      })
    }
  })
  return [
    ...new Map(diagnostics.map((item) => [item.id, item])).values(),
  ].sort((left, right) =>
    left.severity === right.severity
      ? left.id.localeCompare(right.id)
      : left.severity === 'error'
        ? -1
        : 1,
  )
}
