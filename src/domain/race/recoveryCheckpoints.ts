import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { isSafeRoadRecoverySample } from '@/domain/track/waterExposure'

export type RecoveryCourse = Pick<RaceState, 'path' | 'routeKind' | 'startPathIndex' | 'reversed' | 'recoveryCheckpoints'>

/** Distance travelled in route order, wrapping only on closed circuits. */
export function forwardRecoveryDistance(
  from: number, to: number, count: number, reversed: boolean, closed: boolean,
): number {
  if (count <= 0) return 0
  const distance = (reversed ? -1 : 1) * (to - from)
  return closed ? ((distance % count) + count) % count : distance
}

export function reachedRecoveryCheckpoint(
  race: RecoveryCourse,
  previous: RaceVehicle,
  vehicle: RaceVehicle,
  onRoad: boolean,
): number | null {
  const last = previous.lap === vehicle.lap ? previous.recoveryCheckpoint ?? null : null
  if (!race.recoveryCheckpoints?.length || vehicle.finishedAt !== null) return last
  const length = race.path.points.length
  const nextRequiredGate = (race.path.closed ? length : length - 1) * vehicle.nextSector / 4
  let checkpoint = last
  let furthest = -1
  for (const index of race.recoveryCheckpoints) {
    const fromStart = forwardRecoveryDistance(race.startPathIndex, index, length, race.reversed, race.path.closed)
    const distance = forwardRecoveryDistance(previous.pathIndex, index, length, race.reversed, race.path.closed)
    // A recovery cannot land on the far side of a missed timing gate.
    if (fromStart >= nextRequiredGate || distance < furthest) continue
    // At angled checkpoints the car may be just off the sampled road at one
    // endpoint even though it actually crossed the painted gate on the asphalt.
    const radius = onRoad ? ROAD_GEOMETRY.onRoadRadius : ROAD_GEOMETRY.checkpointHalfWidth
    if (crossesRoadGate(race.path, previous, vehicle, index, radius, race.reversed)) {
      checkpoint = index
      furthest = distance
    }
  }
  return checkpoint
}

/** Shared boundary: both authored markers and road contact must be safe and pre-gate. */
function safePreGateSample(course: RecoveryCourse, vehicle: RaceVehicle, index: number): boolean {
  const { path, reversed, startPathIndex } = course
  const count = path.points.length
  if (!Number.isInteger(index) || index < 0 || index >= count) return false
  const progress = path.closed
    ? forwardRecoveryDistance(startPathIndex, index, count, reversed, true)
    : index
  const nextGate = (path.closed ? count : count - 1) * vehicle.nextSector / 4
  return progress < nextGate && isSafeRoadRecoverySample(path, index)
}

/** The latest physical road support is independent of the checkpoint markers. */
export function lastRoadRecoveryTarget(course: RecoveryCourse, vehicle: RaceVehicle): number | undefined {
  if (!vehicle.player) return undefined
  const index = vehicle.lastRoadContactIndex
  return index !== undefined && safePreGateSample(course, vehicle, index) ? index : undefined
}

export function authoredRecoveryTarget(course: RecoveryCourse, vehicle: RaceVehicle): number | undefined {
  if (!vehicle.player || !course.recoveryCheckpoints?.length) return undefined
  const index = vehicle.recoveryCheckpoint ?? course.startPathIndex
  return safePreGateSample(course, vehicle, index) ? index : undefined
}

/** Search around the followed sample without jumping to a spatially close arm. */
export function safeFallbackRecoveryTarget(course: RecoveryCourse, vehicle: RaceVehicle): number | undefined {
  const { path, reversed, startPathIndex } = course
  const count = path.points.length
  if (!count) return undefined
  const direction = reversed ? -1 : 1
  const wrap = (index: number) => ((index % count) + count) % count
  const last = path.closed
    ? Math.ceil(count * vehicle.nextSector / 4) - 1
    : course.routeKind === 'point-to-point'
      ? lastSampleBeforeCheckpoint(path, vehicle.nextSector)
      : count - 1
  const fromStart = path.closed
    ? forwardRecoveryDistance(startPathIndex, vehicle.recoveryAnchorIndex ?? vehicle.pathIndex, count, reversed, true)
    : (vehicle.recoveryAnchorIndex ?? vehicle.pathIndex)
  // Cars can begin just behind Start. Keep that approach available when gate 1 is pending.
  const behindStart = path.closed && vehicle.nextSector === 1 && fromStart >= count - 12
  const first = behindStart ? fromStart - count : 0
  const anchor = behindStart ? first : Math.max(0, Math.min(last, fromStart))
  const limit = path.closed && behindStart ? Math.min(last, count + first - 1) : last
  const sample = (progress: number) => path.closed ? wrap(startPathIndex + direction * progress) : progress
  const safeAt = (progress: number): number | undefined => {
    if (progress < first || progress > limit) return undefined
    const index = sample(progress)
    return isSafeRoadRecoverySample(path, index) ? index : undefined
  }
  const maxOffset = Math.max(anchor - first, limit - anchor)
  for (let offset = 0; offset <= maxOffset; offset++) {
    // No temporary two-element arrays while searching long or malformed roads.
    const trailing = path.closed || !reversed ? anchor - offset : anchor + offset
    const found = safeAt(trailing)
    if (found !== undefined) return found
    if (offset === 0) continue
    const leading = path.closed || !reversed ? anchor + offset : anchor - offset
    const alternative = safeAt(leading)
    if (alternative !== undefined) return alternative
  }
  return undefined
}
