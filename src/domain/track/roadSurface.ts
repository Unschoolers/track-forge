import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type {
  TerrainMaterial,
  TerrainSurface,
} from '@/domain/terrain/terrainSurface'
import {
  buildRoadStructureProfile,
  type RoadStructurePath,
} from '@/domain/track/roadStructureProfile'

export interface RoadSurfaceSample {
  readonly terrainHeight: number
  readonly structureHeight: number
  readonly height: number
  readonly grade: number
  readonly material: TerrainMaterial
  readonly structureRunId: string | null
}

export interface RoadSurfaceProfile {
  at(pathIndex: number, position?: Vector2): RoadSurfaceSample
  gradeAt(pathIndex: number): number
}

function sampleIndex(path: RoadStructurePath, index: number): number {
  if (path.points.length === 0) return 0
  return path.closed
    ? ((index % path.points.length) + path.points.length) % path.points.length
    : Math.max(0, Math.min(path.points.length - 1, index))
}

function projectOntoSegment(position: Vector2, start: Vector2, end: Vector2) {
  const x = end.x - start.x
  const y = end.y - start.y
  const lengthSquared = x * x + y * y
  const dx = position.x - start.x
  const dy = position.y - start.y
  const ratio = lengthSquared > 0
    ? clamp((dx * x + dy * y) / lengthSquared, 0, 1)
    : 0
  return {
    ratio,
    distanceSquared: (dx - x * ratio) ** 2 + (dy - y * ratio) ** 2,
  }
}

function nearestRoadSegment(path: RoadStructurePath, index: number, position: Vector2) {
  const point = path.points[index]
  if (!point) return { index, ratio: 0 }
  const beforeIndex = sampleIndex(path, index - 1)
  const afterIndex = sampleIndex(path, index + 1)
  const before = projectOntoSegment(position, path.points[beforeIndex] ?? point, point)
  const after = projectOntoSegment(position, point, path.points[afterIndex] ?? point)
  // A nearest vertex can be on either end of the segment under the car.
  // Use the same segment from both ends so the ramp has no steps at midpoints.
  if (before.distanceSquared < after.distanceSquared && before.ratio < 1) {
    return { index: beforeIndex, ratio: before.ratio }
  }
  return after.ratio === 1
    ? { index: afterIndex, ratio: 0 }
    : { index, ratio: after.ratio }
}

export function buildRoadSurfaceProfile(
  path: RoadStructurePath,
  terrainSurface: TerrainSurface,
): RoadSurfaceProfile {
  const structure = buildRoadStructureProfile(path)
  const composed = path.points.map((point, index) => {
    const terrainHeight = terrainSurface.heightAt(point)
    const relative = structure.at(index)
    return {
      terrainHeight,
      structureHeight: relative.height,
      height: terrainHeight + relative.height,
      material: terrainSurface.materialAt(point),
      structureRunId: relative.runId,
    }
  })
  const gradeAt = (pathIndex: number): number => {
    if (path.points.length < 2) return 0
    const index = sampleIndex(path, pathIndex)
    const beforeIndex = sampleIndex(path, index - 3)
    const afterIndex = sampleIndex(path, index + 3)
    const beforePoint = path.points[beforeIndex]
    const afterPoint = path.points[afterIndex]
    const before = composed[beforeIndex]
    const after = composed[afterIndex]
    if (!beforePoint || !afterPoint || !before || !after) return 0
    const horizontalDistance = Math.hypot(
      afterPoint.x - beforePoint.x,
      afterPoint.y - beforePoint.y,
    )
    return horizontalDistance <= 0.000_1
      ? 0
      : Math.atan2(after.height - before.height, horizontalDistance)
  }
  const samples: readonly RoadSurfaceSample[] = composed.map(
    (sample, index) => ({ ...sample, grade: gradeAt(index) }),
  )
  return {
    at(pathIndex: number, position?: Vector2): RoadSurfaceSample {
      if (!position) {
        return samples[sampleIndex(path, pathIndex)] ?? {
          terrainHeight: 0,
          structureHeight: 0,
          height: 0,
          grade: 0,
          material: 'grass',
          structureRunId: null,
        }
      }
      const index = sampleIndex(path, pathIndex)
      const segment = structure.runs.length > 0
        ? nearestRoadSegment(path, index, position)
        : { index, ratio: 0 }
      const relative = structure.at(segment.index, segment.ratio)
      const terrainHeight = terrainSurface.heightAt(position)
      const startGrade = samples[segment.index]?.grade ?? 0
      const endGrade = samples[sampleIndex(path, segment.index + 1)]?.grade ?? startGrade
      return {
        terrainHeight,
        structureHeight: relative.height,
        height: terrainHeight + relative.height,
        grade: startGrade + (endGrade - startGrade) * segment.ratio,
        material: terrainSurface.materialAt(position),
        structureRunId: relative.runId,
      }
    },
    gradeAt,
  }
}
