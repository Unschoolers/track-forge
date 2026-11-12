import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
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
import type { RoadSurfaceSample } from '@/domain/track/roadSurface'
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

/**
 * Search a bounded route window so the nearest sample can move across a
 * hairpin even when distance to the previous straight has a local minimum.
 * If that search proposes the other arm of a nearby detected crossing,
 * repeat it without crossing arms unrelated to the current route segment.
 */
function nearestContinuousPathPoint(
  path: RoadPath,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'> & Partial<Pick<RaceVehicle, 'player'>>,
): NearestPathPoint | undefined {
  const count = path.points.length
  if (count === 0) return undefined
  const start = path.closed
    ? ((Math.round(vehicle.pathIndex) % count) + count) % count
    : Math.max(0, Math.min(count - 1, Math.round(vehicle.pathIndex)))
  // AI advances only a few samples per physics step. A broad spatial search
  // can pick a distant hairpin arm and make its pursuit target jump backwards.
  const searchRadius = vehicle.player === false ? 12 : 80
  const nearest = nearestPathPoint(path, vehicle, start, searchRadius)
  const current = path.points[start]
  if (!nearest || !current || nearest.point.segment === current.segment) {
    return nearest
  }

  const crossingArms = new Set<number>()
  for (const crossing of path.crossings) {
    if (
      Math.hypot(
        vehicle.x - crossing.position.x,
        vehicle.y - crossing.position.y,
      ) > crossing.bridgeHalfLength + ROAD_GEOMETRY.onRoadRadius
    ) continue
    if (current.segment === crossing.firstSegment) {
      crossingArms.add(crossing.secondSegment)
    } else if (current.segment === crossing.secondSegment) {
      crossingArms.add(crossing.firstSegment)
    }
  }
  if (!crossingArms.has(nearest.point.segment)) return nearest

  let closest: NearestPathPoint | undefined
  const radius = Math.min(searchRadius, count - 1)
  for (let offset = -radius; offset <= radius; offset += 1) {
    const rawIndex = start + offset
    if (!path.closed && (rawIndex < 0 || rawIndex >= count)) continue
    const index = ((rawIndex % count) + count) % count
    const point = path.points[index]
    if (!point || crossingArms.has(point.segment)) continue
    const distance = Math.hypot(point.x - vehicle.x, point.y - vehicle.y)
    if (!closest || distance < closest.distance) {
      closest = { index, point, distance }
    }
  }
  return closest
}

// Half a level leaves room for the height change across a normal ramp step,
// while distinguishing a full deck from the ground beneath it.
const LEVEL_COMPATIBILITY = WORLD_ELEVATION.levelHeight / 2

function heightCompatible(
  path: RoadPath,
  index: number,
  terrainHeight: number,
  z: number,
): boolean {
  return (
    !Number.isFinite(z) ||
    Math.abs(terrainHeight + path.roadSurface.at(index).structureHeight - z) <=
      LEVEL_COMPATIBILITY
  )
}

function roadAboveVehicle(
  surface: RoadSurfaceSample,
  vehicle: Pick<RaceVehicle, 'z'> & Partial<Pick<RaceVehicle, 'grounded'>>,
  previousSupport?: VehicleStepContext,
): boolean {
  // Horizontal motion is integrated before height. A ramp can rise above the
  // old chassis height during that step without becoming an overhead deck.
  // Carry only support approached from above on the same continuous run;
  // actual underpass traffic never satisfies this condition.
  if (
    previousSupport?.onRoad &&
    previousSupport.structureRunId !== null &&
    previousSupport.structureRunId === surface.structureRunId &&
    vehicle.z >= previousSupport.surfaceHeight - SUPPORT_HEIGHT_EPSILON
  ) return false
  // A grounded car can follow a ramp between frames. An airborne car must
  // approach the deck from above; a deck above its underside cannot catch it.
  const clearance = vehicle.grounded === false
    ? SUPPORT_HEIGHT_EPSILON
    : LEVEL_COMPATIBILITY
  return (
    surface.structureHeight > clearance &&
    surface.height > vehicle.z + clearance
  )
}

/** Search globally only after the previously followed road is left. */
function reacquireRoad(
  path: RoadPath,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'z'>,
  terrainHeight: number,
): NearestPathPoint | undefined {
  let nearest: NearestPathPoint | undefined
  let compatible: NearestPathPoint | undefined
  for (const [index, point] of path.points.entries()) {
    const distance = Math.hypot(point.x - vehicle.x, point.y - vehicle.y)
    if (!nearest || distance < nearest.distance) {
      nearest = { index, point, distance }
    }
    if (
      distance <= ROAD_GEOMETRY.onRoadRadius &&
      (!compatible || distance < compatible.distance) &&
      heightCompatible(path, index, terrainHeight, vehicle.z)
    ) {
      compatible = { index, point, distance }
    }
  }
  return compatible ?? nearest
}

/** Check other crossing arms only when the followed deck is above the car. */
function lowerCrossingRoad(
  path: RoadPath,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'z'>,
  current: NearestPathPoint,
  terrainHeight: number,
): NearestPathPoint | undefined {
  let nearest: NearestPathPoint | undefined
  for (const crossing of path.crossings) {
    if (
      Math.hypot(
        vehicle.x - crossing.position.x,
        vehicle.y - crossing.position.y,
      ) > crossing.bridgeHalfLength + ROAD_GEOMETRY.onRoadRadius
    ) continue
    const otherIndex =
      current.point.segment === crossing.firstSegment
        ? crossing.secondPathIndex
        : current.point.segment === crossing.secondSegment
          ? crossing.firstPathIndex
          : undefined
    if (otherIndex === undefined) continue
    const candidate = nearestContinuousPathPoint(path, {
      ...vehicle,
      pathIndex: otherIndex,
    })
    if (
      candidate &&
      candidate.distance <= ROAD_GEOMETRY.onRoadRadius &&
      (!nearest || candidate.distance < nearest.distance) &&
      heightCompatible(path, candidate.index, terrainHeight, vehicle.z)
    ) {
      nearest = candidate
    }
  }
  return nearest
}

export function getVehicleStepContext(
  path: RoadPath,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex' | 'z'> &
    Partial<Pick<RaceVehicle, 'grounded' | 'player'>>,
  previousSupport?: VehicleStepContext,
): VehicleStepContext {
  const local = nearestContinuousPathPoint(path, vehicle)
  let nearest = local
  let roadSurface = local && path.roadSurface.at(local.index, vehicle)
  if (local && roadSurface && local.distance > ROAD_GEOMETRY.onRoadRadius &&
      vehicle.player !== false) {
    const reacquired = reacquireRoad(path, vehicle, roadSurface.terrainHeight)
    if (
      reacquired &&
      (reacquired.distance <= ROAD_GEOMETRY.onRoadRadius || local.distance > 72)
    ) {
      nearest = reacquired
      roadSurface = path.roadSurface.at(nearest.index, vehicle)
    }
  }
  if (
    nearest && roadSurface && roadAboveVehicle(roadSurface, vehicle, previousSupport)
  ) {
    const lower = lowerCrossingRoad(
      path,
      vehicle,
      nearest,
      roadSurface.terrainHeight,
    )
    if (lower) {
      nearest = lower
      roadSurface = path.roadSurface.at(lower.index, vehicle)
    }
  }
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
  roadSurface ??= path.roadSurface.at(nearest.index, vehicle)
  // A vehicle below a raised deck is supported by terrain (or by a lower
  // crossing arm found above), never by the overhead road.
  const onRoad =
    nearest.distance <= ROAD_GEOMETRY.onRoadRadius &&
    !roadAboveVehicle(roadSurface, vehicle, previousSupport)
  const onCurb =
    onRoad &&
    nearest.point.surface === 'street' &&
    nearest.distance > ROAD_GEOMETRY.curbDetectInner &&
    nearest.distance < ROAD_GEOMETRY.curbDetectOuter &&
    Math.abs(turnAmountAt(path, nearest.index)) > 0.12
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
  // Resetting changes position to the selected road center, so sample support
  // there instead of retaining terrain height from a position under the deck.
  const roadSurface = path.points[nearest.index]
    ? path.roadSurface.at(nearest.index, nearest.point)
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
  reversed = false,
): RaceCameraHints {
  const context = getVehicleStepContext(path, player)
  const sample = Math.max(5, Math.min(10, Math.round(5 + player.speed / 65)))
  const direction = reversed ? -1 : 1
  const behind = wrapped(path, context.nearest.index - direction * sample) ?? player
  const ahead = wrapped(path, context.nearest.index + direction * sample) ?? player
  const roadAngle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x)
  const curveDistances = [8, 14, 20, 28] as const
  let weightedCurve = 0
  let weightTotal = 0
  for (const [index, distance] of curveDistances.entries()) {
    const weight = 1 - index * 0.18
    weightedCurve +=
      Math.abs(turnAmountAt(path, context.nearest.index + direction * distance, 5)) *
      weight
    weightTotal += weight
  }
  // Preview the road over reaction time plus braking distance. Keep the
  // horizon local on short circuits, where another arm may be very close.
  const horizon = Math.min(
    path.totalLength * 0.28,
    240,
    30 + player.speed * 0.32 + player.speed ** 2 / (2 * 330),
  )
  const preview: Vector2[] = [player]
  for (let offset = 1; offset < path.points.length; offset += 1) {
    const index = context.nearest.index + direction * offset
    if (!path.closed && (index < 0 || index >= path.points.length)) break
    const point = wrapped(path, index)
    if (!point) break
    let distance = (point.distance - context.nearest.point.distance) * direction
    if (path.closed && distance < 0) distance += path.totalLength
    if (distance > horizon) break
    preview.push(point)
  }
  const lookAhead = Math.max(14, Math.min(46, 14 + player.speed * 0.095))
  return {
    target: {
      x: player.x + Math.cos(roadAngle) * lookAhead,
      y: player.y + Math.sin(roadAngle) * lookAhead,
    },
    preview,
    roadAngle,
    upcomingCurve: weightTotal > 0 ? weightedCurve / weightTotal : 0,
    speed: player.speed,
    shake: 0,
  }
}
