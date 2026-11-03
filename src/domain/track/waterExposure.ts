import {
  ROAD_GEOMETRY,
  WORLD_ELEVATION,
} from '@/domain/config'
import type { Vector2 } from '@/domain/model'
import type { TerrainMaterial } from '@/domain/terrain/terrainSurface'
import type {
  RoadPath,
  RoadPathPoint,
} from '@/domain/track/pathBuilder'
import type { RoadSurfaceSample } from '@/domain/track/roadSurface'

interface VehicleWaterSupport {
  readonly grounded: boolean
  readonly terrainMaterial: TerrainMaterial
  readonly safeAboveWater: boolean
}

export function hasVehicleWaterContact(
  support: VehicleWaterSupport,
): boolean {
  return (
    support.grounded &&
    support.terrainMaterial === 'water' &&
    !support.safeAboveWater
  )
}

export function hasSafeOverpassSupport(
  point: Pick<RoadPathPoint, 'structure'>,
  surface: RoadSurfaceSample,
  vehicleUndersideZ = surface.height,
): boolean {
  const minimumClearance =
    ROAD_GEOMETRY.bridgeWallClearance * WORLD_ELEVATION.levelHeight
  return (
    point.structure === 'overpass' &&
    surface.structureRunId !== null &&
    surface.structureHeight >= minimumClearance &&
    vehicleUndersideZ - surface.terrainHeight >= minimumClearance &&
    vehicleUndersideZ + ROAD_GEOMETRY.bridgeWallClearance >= surface.height
  )
}

function pathPoint(path: RoadPath, index: number): RoadPathPoint | undefined {
  const count = path.points.length
  if (count === 0) return undefined
  if (path.closed) {
    return path.points[((index % count) + count) % count]
  }
  return path.points[Math.max(0, Math.min(count - 1, index))]
}

/**
 * Returns the first canonical water sample under the drivable road footprint.
 * Lateral samples include center and both extents, with spacing no larger than
 * half one terrain cell so a 32-unit water cell cannot hide between probes.
 */
export function findRoadWaterExposure(
  path: RoadPath,
  pathIndex: number,
): Vector2 | undefined {
  const center = pathPoint(path, pathIndex)
  if (!center) return undefined
  const before = pathPoint(path, pathIndex - 1) ?? center
  const after = pathPoint(path, pathIndex + 1) ?? center
  const length = Math.max(
    0.001,
    Math.hypot(after.x - before.x, after.y - before.y),
  )
  const normal = {
    x: -(after.y - before.y) / length,
    y: (after.x - before.x) / length,
  }
  const halfWidth = ROAD_GEOMETRY.surfaceWidth / 2
  const intervals = Math.max(
    1,
    Math.ceil(halfWidth / (WORLD_ELEVATION.cellSize / 2)),
  )
  for (let step = -intervals; step <= intervals; step += 1) {
    const offset = (step / intervals) * halfWidth
    const position = {
      x: center.x + normal.x * offset,
      y: center.y + normal.y * offset,
    }
    if (path.terrainSurface.materialAt(position) === 'water') {
      return position
    }
  }
  return undefined
}

export function isSafeRoadRecoverySample(
  path: RoadPath,
  pathIndex: number,
): boolean {
  const point = path.points[pathIndex]
  if (!point) return false
  const surface = path.roadSurface.at(pathIndex, point)
  return (
    surface.material !== 'water' ||
    hasSafeOverpassSupport(point, surface)
  )
}
