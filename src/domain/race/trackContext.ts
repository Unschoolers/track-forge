import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import { clamp, wrapAngleRadians } from '@/domain/geometry/math'
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
  return wrapAngleRadians(left - right)
}

// These two spans are used by drivers and camera hints every physics tick.
const drivingTurns = new WeakMap<RoadPath, number[]>()
const cameraTurns = new WeakMap<RoadPath, number[]>()

export function turnAmountAt(
  path: RoadPath,
  index: number,
  distance = 6,
): number {
  const count = path.points.length
  if (count === 0 || (!path.closed && (index <= 0 || index >= count - 1))) return 0
  const cache = distance === 6 ? drivingTurns : distance === 5 ? cameraTurns : undefined
  if (!cache) return calculateTurn(path, index, distance)
  const sample = path.closed ? ((index % count) + count) % count : index
  let turns = cache.get(path)
  if (!turns) {
    turns = new Array<number>(count)
    cache.set(path, turns)
  }
  const cached = turns[sample]
  if (cached !== undefined) return cached
  const turn = calculateTurn(path, sample, distance)
  turns[sample] = turn
  return turn
}

function calculateTurn(
  path: RoadPath,
  index: number,
  distance: number,
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
  playerSearchRadius = 80,
): NearestPathPoint | undefined {
  const count = path.points.length
  if (count === 0) return undefined
  const start = path.closed
    ? ((Math.round(vehicle.pathIndex) % count) + count) % count
    : Math.max(0, Math.min(count - 1, Math.round(vehicle.pathIndex)))
  // AI advances only a few samples per physics step. A broad spatial search
  // can pick a distant hairpin arm and make its pursuit target jump backwards.
  let searchRadius = vehicle.player === false ? 4 : playerSearchRadius
  let nearest = nearestPathPoint(path, vehicle, start, searchRadius)
  // Give a displaced rival a wider search only once it is well off the road.
  if (vehicle.player === false && nearest && nearest.distance > ROAD_GEOMETRY.onRoadRadius + 30) {
    searchRadius = 12
    nearest = nearestPathPoint(path, vehicle, start, searchRadius)
  }
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
  playerSearchRadius = 80,
): VehicleStepContext {
  const local = nearestContinuousPathPoint(path, vehicle, playerSearchRadius)
  let nearest = local
  let roadSurface = local && path.roadSurface.at(local.index, vehicle)
  if (local && roadSurface && local.distance > ROAD_GEOMETRY.onRoadRadius &&
      vehicle.player !== false && path.closed) {
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
    // Rivals must recover on their own route after falling off a deck. Taking
    // the lower arm here could advance their race progress without driving it.
    vehicle.player !== false && nearest && roadSurface &&
    roadAboveVehicle(roadSurface, vehicle, previousSupport)
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
    verticalVelocity: Math.min(0, vehicle.verticalVelocity),
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
  maxPathIndex?: number,
): number | undefined {
  const limit = !path.closed && maxPathIndex !== undefined
    ? Math.min(path.points.length - 1, Math.floor(maxPathIndex))
    : path.points.length - 1
  if (limit < 0) return undefined
  const nearest = Math.min(limit, getVehicleStepContext(path, vehicle).nearest.index)
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
        index > limit ||
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
  readonly maxPathIndex?: number
}

export function resetVehicleToTrack(
  vehicle: RaceVehicle,
  path: RoadPath,
  target: TrackResetTarget = {},
): RaceVehicle {
  const requestedIndex =
    target.pathIndex === undefined
      ? undefined
      : normalizedTargetIndex(path, !path.closed && target.maxPathIndex !== undefined
        ? Math.min(target.pathIndex, target.maxPathIndex)
        : target.pathIndex)
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
      : !path.closed && target.maxPathIndex !== undefined
        ? (() => {
            const index = Math.max(0, Math.min(context.nearest.index, Math.floor(target.maxPathIndex)))
            const point = path.points[index]
            return point ? { index, point, distance: Math.hypot(point.x - vehicle.x, point.y - vehicle.y) } : context.nearest
          })()
        : context.nearest
  // Resetting changes position to the selected road center, so sample support
  // there instead of retaining terrain height from a position under the deck.
  const roadSurface = path.points[nearest.index]
    ? path.roadSurface.at(nearest.index, nearest.point)
    : undefined
  const direction = target.reversed ? -1 : 1
  const ahead =
    wrapped(path, nearest.index + direction * 4) ?? nearest.point
  const behind = wrapped(path, nearest.index - direction * 4) ?? nearest.point
  const angle = ahead === nearest.point
    ? Math.atan2(nearest.point.y - behind.y, nearest.point.x - behind.x)
    : Math.atan2(ahead.y - nearest.point.y, ahead.x - nearest.point.x)
  return {
    ...vehicle,
    x: nearest.point.x,
    y: nearest.point.y,
    angle,
    vx: 0,
    vy: 0,
    speed: 0,
    slip: 0,
    braking: false,
    ...(vehicle.brakePressure === undefined ? {} : { brakePressure: 0 }),
    ...(vehicle.driftTap === undefined ? {} : { driftTap: undefined }),
    yawRate: 0,
    pathIndex: nearest.index,
    lastRoadContactIndex: nearest.index,
    bridgeFallSeconds: undefined,
    jumpLaunched: false,
    jumpFlight: false,
    recoveryAnchorIndex: undefined,
    recoveryReacquiredIndex: undefined,
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
    aiOffRoadSeconds: 0,
    missedCheckpoint: undefined,
  }
}

export function buildRaceCameraHints(
  path: RoadPath,
  player: RaceVehicle,
  reversed = false,
  previous?: RaceCameraHints,
  deltaSeconds = 0,
): RaceCameraHints {
  // The simulation already resolved this index for the current tick. A second
  // spatial search can jump to a different arm of the same tight bend.
  const playerPoint = path.points[player.pathIndex]
  const nearest = playerPoint
    ? { index: player.pathIndex, point: playerPoint }
    : getVehicleStepContext(path, player).nearest
  const sample = Math.max(5, Math.min(10, Math.round(5 + player.speed / 65)))
  const courseDirection = reversed ? -1 : 1
  const behind = wrapped(path, nearest.index - courseDirection * sample) ?? player
  const ahead = wrapped(path, nearest.index + courseDirection * sample) ?? player
  const courseAngle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x)
  const motionSpeed = Math.hypot(player.vx, player.vy)
  const moving = motionSpeed > 20
  const motionAngle = moving ? Math.atan2(player.vy, player.vx) : courseAngle
  const alignment = Math.cos(angleDifference(courseAngle, motionAngle))
  let followingOppositeTravel = previous?.followingOppositeTravel ?? false
  let directionChangeSeconds = previous?.directionChangeSeconds ?? 0
  // Require sustained motion, with separate entry/exit thresholds, so a brief
  // skid or collision cannot flip the preview between opposite directions.
  const changeDirection = moving && (followingOppositeTravel ? alignment > -0.15 : alignment < -0.65)
  directionChangeSeconds = changeDirection ? directionChangeSeconds + Math.max(0, deltaSeconds) : 0
  if (directionChangeSeconds >= 0.25) {
    followingOppositeTravel = !followingOppositeTravel
    directionChangeSeconds = 0
  }
  const direction = followingOppositeTravel ? -courseDirection : courseDirection
  let roadAngle = followingOppositeTravel ? courseAngle + Math.PI : courseAngle
  // If a tight bend or an off-road excursion puts the sampled road far away
  // from the direction of motion, avoid looking backward at the player.
  if (moving) {
    roadAngle = motionAngle + clamp(angleDifference(roadAngle, motionAngle), -Math.PI / 4, Math.PI / 4)
  }
  const curveDistances = [8, 14, 20, 28] as const
  let weightedCurve = 0
  let weightTotal = 0
  for (const [index, distance] of curveDistances.entries()) {
    const weight = 1 - index * 0.18
    weightedCurve +=
      Math.abs(turnAmountAt(path, nearest.index + direction * distance, 5)) *
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
    const index = nearest.index + direction * offset
    if (!path.closed && (index < 0 || index >= path.points.length)) break
    const point = wrapped(path, index)
    if (!point) break
    let distance = (point.distance - nearest.point.distance) * direction
    if (path.closed && distance < 0) distance += path.totalLength
    if (distance > horizon) break
    preview.push(point)
  }
  const lookAhead = Math.min(
    Math.max(14, Math.min(46, 14 + player.speed * 0.095)),
    path.closed ? Infinity : Math.max(0, direction < 0
      ? nearest.point.distance
      : path.totalLength - nearest.point.distance),
  )
  return {
    target: {
      x: player.x + Math.cos(roadAngle) * lookAhead,
      y: player.y + Math.sin(roadAngle) * lookAhead,
    },
    preview,
    roadAngle,
    followingOppositeTravel,
    directionChangeSeconds,
    upcomingCurve: weightTotal > 0 ? weightedCurve / weightTotal : 0,
    speed: player.speed,
    shake: 0,
  }
}

/** Supported ramps share the deck's draw layer even near ground level. */
export function isVehicleAboveStructures(
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'z' | 'player' | 'grounded' | 'pathIndex' | 'structureRunId'>,
  path: RoadPath,
): boolean {
  // A car can briefly be matched to the underpass at a 2D crossing even
  // while its last supported road sample is on the ramp. Trust that authored
  // support only while the car is physically near its sample and at deck height.
  const supported = path.points[vehicle.pathIndex]
  if (supported && vehicle.structureRunId !== null) {
    const support = path.roadSurface.at(vehicle.pathIndex, vehicle)
    if (
      support.structureRunId === vehicle.structureRunId &&
      support.structureHeight > 0.005 &&
      Math.hypot(vehicle.x - supported.x, vehicle.y - supported.y) <=
        ROAD_GEOMETRY.onRoadRadius &&
      vehicle.z >= support.height - 2
    ) return true
  }
  const context = getVehicleStepContext(path, vehicle)
  if (context.onRoad && context.structureRunId !== null) return true
  // Preserve elevated/airborne rendering without lifting underpass traffic
  // just because an overhead road has been authored at the same position.
  return vehicle.z - path.terrainSurface.heightAt(vehicle) >=
    WORLD_ELEVATION.levelHeight * 0.45
}

