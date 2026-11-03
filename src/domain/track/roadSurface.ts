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
      const relative = structure.at(index, position)
      const terrainHeight = terrainSurface.heightAt(position)
      return {
        terrainHeight,
        structureHeight: relative.height,
        height: terrainHeight + relative.height,
        grade: gradeAt(index),
        material: terrainSurface.materialAt(position),
        structureRunId: relative.runId,
      }
    },
    gradeAt,
  }
}
