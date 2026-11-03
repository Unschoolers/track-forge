import { ROAD_GEOMETRY } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type {
  RaceCameraHints,
  RaceVehicle,
} from '@/domain/race/raceState'
import {
  nearestPathPoint,
  type NearestPathPoint,
  type RoadPath,
} from '@/domain/track/pathBuilder'
import type { TerrainMaterial } from '@/domain/terrain/terrainSurface'
import {
  hasSafeOverpassSupport,
  isSafeRoadRecoverySample,
} from '@/domain/track/waterExposure'
import { SUPPORT_HEIGHT_EPSILON } from '@/domain/race/vehicleVerticalDynamics'

export interface VehicleStepContext {
  readonly nearest: NearestPathPoint
  readonly onRoad: boolean
  readonly onCurb: boolean
  readonly surface: SurfaceId | 'grass'
  readonly tangent: Vector2
  readonly normal: Vector2
  readonly surfaceHeight: number
  readonly grade: number
  readonly structureRunId: string | null
  readonly terrainMaterial: TerrainMaterial
  readonly safeAboveWater: boolean
}

/**
 * Road profiles remain canonical in authored forward order. Consumers that
 * reason about motion along the route adapt the sign at their boundary.
 */
export function gradeForTravel(grade: number, reversed: boolean): number {
  return reversed ? -grade : grade
}

function wrapped(path: RoadPath, index: number) {
  const count = path.points.length
  if (count === 0) return undefined
  if (path.closed) return path.points[((index % count) + count) % count]
  return path.points[Math.max(0, Math.min(count - 1, index))]
}

function angleDifference(left: number, right: number): number {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right))
}

export function turnAmountAt(
  path: RoadPath,
  index: number,
  distance = 6,
): number {
  const previous = wrapped(path, index - distance)
  const current = wrapped(path, index)
  const next = wrapped(path, index + distance)
  if (!previous || !current || !next) return 0
  return angleDifference(
    Math.atan2(next.y - current.y, next.x - current.x),
    Math.atan2(current.y - previous.y, current.x - previous.x),
  )
}

export function getVehicleStepContext(
  path: RoadPath,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex' | 'z'>,
): VehicleStepContext {
  const local = nearestPathPoint(path, vehicle, vehicle.pathIndex, 80)
  const nearest =
    local && local.distance <= 72
      ? local
      : nearestPathPoint(path, vehicle)
  if (!nearest) {
    const terrainMaterial = path.terrainSurface.materialAt(vehicle)
    const fallback = {
      index: 0,
      point: {
        x: vehicle.x,
        y: vehicle.y,
        surface: 'street' as const,
        distance: 0,
        segment: 0,
        sectionId: 'fallback',
        structure: 'surface' as const,
      },
      distance: Number.POSITIVE_INFINITY,
    }
    return {
      nearest: fallback,
      onRoad: false,
      onCurb: false,
      surface: 'grass',
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      surfaceHeight: path.terrainSurface.heightAt(vehicle),
      grade: 0,
      structureRunId: null,
      terrainMaterial,
      safeAboveWater: false,
    }
  }
  const previous = wrapped(path, nearest.index - 3) ?? nearest.point
  const next = wrapped(path, nearest.index + 3) ?? nearest.point
  const length = Math.max(0.001, Math.hypot(next.x - previous.x, next.y - previous.y))
  const tangent = {
    x: (next.x - previous.x) / length,
    y: (next.y - previous.y) / length,
  }
  const onRoad = nearest.distance <= ROAD_GEOMETRY.onRoadRadius
  const onCurb =
    onRoad &&
    nearest.point.surface === 'street' &&
    nearest.distance > ROAD_GEOMETRY.curbDetectInner &&
    nearest.distance < ROAD_GEOMETRY.curbDetectOuter &&
    Math.abs(turnAmountAt(path, nearest.index)) > 0.12
  const roadSurface = path.roadSurface.at(nearest.index, vehicle)
  const safeAboveWater =
    onRoad &&
    hasSafeOverpassSupport(nearest.point, roadSurface, vehicle.z)
  return {
    nearest,
    onRoad,
    onCurb,
    surface: onRoad ? nearest.point.surface : 'grass',
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    surfaceHeight: onRoad ? roadSurface.height : roadSurface.terrainHeight,
    grade: onRoad ? roadSurface.grade : 0,
    structureRunId: onRoad ? roadSurface.structureRunId : null,
    terrainMaterial: roadSurface.material,
    safeAboveWater,
  }
}

/**
 * Vehicle collisions resolve after vertical dynamics and may move a grounded
 * chassis beyond its old support. Reconcile against the canonical surface at
 * the resolved position without snapping the chassis down or up: an elevated
 * vehicle starts falling, while terrain-level and under-deck vehicles retain
 * their genuine ground support.
 */
export function reconcileSupportAfterCollision(
  vehicle: RaceVehicle,
  context: VehicleStepContext,
): RaceVehicle {
  if (
    !vehicle.grounded ||
    vehicle.z <= context.surfaceHeight + SUPPORT_HEIGHT_EPSILON
  ) {
    return vehicle
  }
  return {
    ...vehicle,
    grounded: false,
    suspensionCompression: 0,
    contactLoad: 0,
  }
}

function normalizedTargetIndex(
  path: RoadPath,
  index: number,
): number | undefined {
  if (path.points.length === 0) return undefined
  if (path.closed) {
    return ((index % path.points.length) + path.points.length) %
      path.points.length
  }
  return index >= 0 && index < path.points.length ? index : undefined
}

/**
 * Finds the closest safe sample by path distance. Equal-distance ties prefer
 * the trailing side of the active travel direction so recovery never grants
 * progress and remains deterministic for closed and reversed races.
 */
export function findNearestSafeTrackIndex(
  path: RoadPath,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex' | 'z'>,
  reversed = false,
): number | undefined {
  const nearest = getVehicleStepContext(path, vehicle).nearest.index
  const travelDirection = reversed ? -1 : 1
  const inspected = new Set<number>()
  for (let distance = 0; distance < path.points.length; distance += 1) {
    const candidates = distance === 0
      ? [nearest]
      : [
          nearest - travelDirection * distance,
          nearest + travelDirection * distance,
        ]
    for (const candidate of candidates) {
      const index = normalizedTargetIndex(path, candidate)
      if (
        index === undefined ||
        inspected.has(index)
      ) {
        continue
      }
      inspected.add(index)
      if (isSafeRoadRecoverySample(path, index)) return index
    }
  }
  return undefined
}

export interface TrackResetTarget {
  readonly pathIndex?: number
  readonly reversed?: boolean
}

export function resetVehicleToTrack(
  vehicle: RaceVehicle,
  path: RoadPath,
  target: TrackResetTarget = {},
): RaceVehicle {
  const requestedIndex =
    target.pathIndex === undefined
      ? undefined
      : normalizedTargetIndex(path, target.pathIndex)
  const requestedPoint =
    requestedIndex === undefined ? undefined : path.points[requestedIndex]
  const context = getVehicleStepContext(path, vehicle)
  const nearest =
    requestedIndex !== undefined && requestedPoint
      ? {
          index: requestedIndex,
          point: requestedPoint,
          distance: Math.hypot(
            requestedPoint.x - vehicle.x,
            requestedPoint.y - vehicle.y,
          ),
        }
      : context.nearest
  const roadSurface =
    requestedIndex !== undefined && requestedPoint
      ? path.roadSurface.at(requestedIndex, requestedPoint)
      : undefined
  const direction = target.reversed ? -1 : 1
  const ahead =
    wrapped(path, nearest.index + direction * 4) ?? nearest.point
  const angle = Math.atan2(
    ahead.y - nearest.point.y,
    ahead.x - nearest.point.x,
  )
  return {
    ...vehicle,
    x: nearest.point.x,
    y: nearest.point.y,
    angle,
    vx: 0,
    vy: 0,
    speed: 0,
    slip: 0,
    yawRate: 0,
    pathIndex: nearest.index,
    pathDistance: nearest.point.distance,
    z: roadSurface?.height ?? context.surfaceHeight,
    verticalVelocity: 0,
    grounded: true,
    suspensionCompression: 0,
    landingIntensity: 0,
    contactLoad: 1,
    structureRunId: roadSurface?.structureRunId ?? context.structureRunId,
    currentSurface: nearest.point.surface,
    onCurb: false,
    stuckDuration: 0,
  }
}

export function buildRaceCameraHints(
  path: RoadPath,
  player: RaceVehicle,
): RaceCameraHints {
  const context = getVehicleStepContext(path, player)
  const sample = Math.max(5, Math.min(10, Math.round(5 + player.speed / 65)))
  const behind = wrapped(path, context.nearest.index - sample) ?? player
  const ahead = wrapped(path, context.nearest.index + sample) ?? player
  const roadAngle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x)
  const curveDistances = [8, 14, 20, 28] as const
  let weightedCurve = 0
  let weightTotal = 0
  for (const [index, distance] of curveDistances.entries()) {
    const weight = 1 - index * 0.18
    weightedCurve +=
      Math.abs(turnAmountAt(path, context.nearest.index + distance, 5)) *
      weight
    weightTotal += weight
  }
  const lookAhead = Math.max(10, Math.min(26, 10 + player.speed * 0.055))
  return {
    target: {
      x: player.x + Math.cos(roadAngle) * lookAhead,
      y: player.y + Math.sin(roadAngle) * lookAhead,
    },
    roadAngle,
    upcomingCurve: weightTotal > 0 ? weightedCurve / weightTotal : 0,
    speed: player.speed,
    shake: 0,
  }
}
