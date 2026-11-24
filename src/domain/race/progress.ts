import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { roadGateGeometry, roadGateSpan } from '@/domain/track/trackGeometry'

/** Indexed progress for rivals: all gates are authored and ordered by race direction. */
export function updateProgress(
  vehicle: RaceVehicle,
  nextPathIndex: number,
  pathLength: number,
  elapsed: number,
  totalLaps: number,
  startPathIndex = 0,
  reversed = false,
  timingGates: readonly number[] = [],
  closed = true,
  physicalFinishEligible = true,
): RaceVehicle {
  if (pathLength <= 1 || vehicle.finishedAt !== null) return vehicle
  const directed = (index: number): number => closed
    ? (((reversed ? startPathIndex - index : index - startPathIndex) % pathLength) + pathLength) % pathLength
    : index
  const before = directed(vehicle.pathIndex)
  const after = directed(nextPathIndex)
  const travel = closed ? (after - before + pathLength) % pathLength : after - before
  if (travel < 0 || travel > pathLength / 2) {
    return { ...vehicle, pathIndex: nextPathIndex }
  }

  // A 60 Hz tick can cross several tightly spaced authored gates. Consume
  // every gate encountered along the same bounded forward road movement,
  // rather than stranding a rival forever with an unpassed gate behind it.
  let nextSector = vehicle.nextSector
  for (; nextSector <= timingGates.length; nextSector++) {
    const index = timingGates[nextSector - 1]
    if (index === undefined) break
    const required = directed(index)
    const distance = closed
      ? (required - before + pathLength) % pathLength
      : required - before
    if (travel <= 0 || distance < 0 || distance > travel) break
  }

  const finish = nextSector === timingGates.length + 1
  const crossedStart = closed && after < before && travel > 0
  // AI on a point-to-point stage cannot steer beyond its final physical
  // road sample; it may brake one index short of the terminal endpoint.
  // This tolerance is exclusively for AI progress (players require the
  // physical gate plane in advanceArcadeTimingGate).
  const aiAtStageFinish = !closed && finish &&
    before >= pathLength - 4 && after >= pathLength - 3
  // AI checkpoint ordering follows the authored road samples. Finish is
  // stricter: being far outside the drivable road cannot create a phantom
  // completed lap from a nearest-index jump.
  if (finish && physicalFinishEligible &&
      (crossedStart || aiAtStageFinish ||
       (!closed && before < pathLength - 1 && after >= pathLength - 1))) {
    const lap = vehicle.lap + 1
    return { ...vehicle, pathIndex: nextPathIndex, nextSector: 1, lap,
      finishedAt: lap >= totalLaps ? elapsed : null }
  }
  return { ...vehicle, pathIndex: nextPathIndex, nextSector }

}

/** Next authored gate index for an open route (finish when all are passed). */
export function lastSampleBeforeCheckpoint(
  path: RoadPath, checkpoint: number, timingGates: readonly number[] = [],
): number {
  return Math.max(0, Math.ceil(timingGates[checkpoint - 1] ?? path.points.length - 1) - 1)
}

export function passedPendingCheckpoint(
  path: RoadPath, vehicle: RaceVehicle, timingGates: readonly number[] = [],
): boolean {
  if (vehicle.finishedAt !== null) return false
  const next = timingGates[vehicle.nextSector - 1] ?? path.points.length - 1
  return vehicle.pathIndex > next + 2
}

/** Slightly forgive near-edge timing passes, not distant off-road shortcuts.
 * Author-placed recovery markers continue to use their own strict geometry.
 */
export function timingGateCrossingRadius(roadRadius: number, _bothOnRoad: boolean): number {
  // Endpoint contact classification must not change a swept crossing's width.
  return roadRadius + ROAD_GEOMETRY.checkpointGrace
}

/** Accept an open-route gate only when the driven segment crosses its road line. */
/** Retained adapter for open-route tools; no implicit split sectors. */
export function updateOpenRouteProgress(
  previous: RaceVehicle,
  vehicle: RaceVehicle,
  path: RoadPath,
  nextPathIndex: number,
  elapsed: number,
  onRoadBefore: boolean,
  onRoadAfter: boolean,
  roadRadius: number,
  timingGates: readonly number[] = [],
): RaceVehicle {
  const last = path.points.length - 1
  const result = { ...vehicle, pathIndex: Math.max(0, Math.min(last, nextPathIndex)) }
  if (last < 1 || previous.finishedAt !== null) return result
  const gate = previous.nextSector
  const finish = gate === timingGates.length + 1
  const position = timingGates[gate - 1] ?? last
  const radius = timingGateCrossingRadius(roadRadius, onRoadBefore && onRoadAfter)
  if (roadGateCrossingFraction(path, previous, result, position, radius, false, roadRadius) === undefined) return result
  return finish
    ? { ...result, lap: previous.lap + 1, nextSector: 1, finishedAt: elapsed }
    : { ...result, nextSector: gate + 1 }
}

/** A forward crossing must stay on the route near this gate, even at crossings. */
export function crossesRoadGate(
  path: RoadPath,
  previous: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'> & Partial<Pick<RaceVehicle, 'z'>>,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'> & Partial<Pick<RaceVehicle, 'z'>>,
  gatePosition: number,
  roadRadius: number,
  reversed = false,
): boolean {
  return roadGateCrossingFraction(path, previous, vehicle, gatePosition, roadRadius, reversed) !== undefined
}

/** Swept crossing time within this physics step; undefined for an invalid crossing. */
export function roadGateCrossingFraction(
  path: RoadPath,
  previous: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'> & Partial<Pick<RaceVehicle, 'z'>>,
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'pathIndex'> & Partial<Pick<RaceVehicle, 'z'>>,
  gatePosition: number,
  roadRadius: number,
  reversed = false,
  roadEnvelopeRadius?: number,
): number | undefined {
  const count = path.points.length
  const sampleDistance = (index: number): number => {
    const distance = Math.abs(index - gatePosition)
    return path.closed ? Math.min(distance, count - distance) : distance
  }
  if (sampleDistance(previous.pathIndex) > 12 || sampleDistance(vehicle.pathIndex) > 12) return undefined
  const geometry = roadGateGeometry(path, gatePosition)
  if (!geometry) return undefined
  const { lower, center: { x: gx, y: gy }, tangent } = geometry
  const direction = reversed ? -1 : 1
  const tx = direction * tangent.x
  const ty = direction * tangent.y
  const before = (previous.x - gx) * tx + (previous.y - gy) * ty
  const after = (vehicle.x - gx) * tx + (vehicle.y - gy) * ty
  if (before >= 0 || after < 0 || after <= before) return undefined
  const t = -before / (after - before)
  const x = previous.x + (vehicle.x - previous.x) * t - gx
  const y = previous.y + (vehicle.y - previous.y) * t - gy
  // The signed lateral coordinate is in authored (not travel) direction.
  // The ordinary stripe is the fast path; only an edge crossing needs the
  // actual contiguous local road span. Recovery-marker geometry stays strict.
  const lateral = (-x * ty + y * tx) * direction
  if (Math.abs(lateral) > roadRadius) {
    if (roadEnvelopeRadius === undefined) return undefined
    const span = roadGateSpan(path, gatePosition, roadEnvelopeRadius)
    const grace = Math.max(0, roadRadius - roadEnvelopeRadius)
    if (lateral < span.min - grace || lateral > span.max + grace) return undefined
  }

  // Checkpoint ribbons can lie on a bridge. A car crossing beneath that
  // ribbon must not get credit merely because its 2D projection overlaps it.
  const road = path.roadSurface.at(lower, { x: gx, y: gy })
  const previousHeight = previous.z ?? Number.NaN
  const currentHeight = vehicle.z ?? Number.NaN
  const chassisHeight = previousHeight + (currentHeight - previousHeight) * t
  const halfLevel = WORLD_ELEVATION.levelHeight / 2
  if (Number.isFinite(chassisHeight) &&
      road.structureHeight > halfLevel &&
      road.height - chassisHeight > halfLevel) return undefined
  return t
}
