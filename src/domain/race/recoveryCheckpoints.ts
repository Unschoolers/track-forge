import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { isSafeRoadRecoverySample } from '@/domain/track/waterExposure'

export type RecoveryCourse = Pick<RaceState, 'path' | 'routeKind' | 'startPathIndex' | 'reversed' | 'recoveryCheckpoints'>

export function reachedRecoveryCheckpoint(
  race: RecoveryCourse,
  previous: RaceVehicle,
  vehicle: RaceVehicle,
  onRoad: boolean,
): number | null {
  const last = previous.lap === vehicle.lap ? previous.recoveryCheckpoint ?? null : null
  if (!race.recoveryCheckpoints?.length || vehicle.finishedAt !== null) return last
  const length = race.path.points.length
  const direction = race.reversed ? -1 : 1
  const forwardDistance = (from: number, to: number): number => {
    const distance = direction * (to - from)
    return race.path.closed ? (distance + length) % length : distance
  }
  const nextRequiredGate = (race.path.closed ? length : length - 1) * vehicle.nextSector / 4
  let checkpoint = last
  let furthest = -1
  for (const index of race.recoveryCheckpoints) {
    const fromStart = forwardDistance(race.startPathIndex, index)
    const distance = forwardDistance(previous.pathIndex, index)
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

export function authoredRecoveryTarget(course: RecoveryCourse, vehicle: RaceVehicle): number | undefined {
  if (!vehicle.player || !course.recoveryCheckpoints?.length) return undefined
  const index = vehicle.recoveryCheckpoint ?? course.startPathIndex
  const count = course.path.points.length
  const progress = course.path.closed
    ? (((course.reversed ? -1 : 1) * (index - course.startPathIndex)) % count + count) % count
    : index
  const gate = (course.path.closed ? count : count - 1) * vehicle.nextSector / 4
  return progress < gate && isSafeRoadRecoverySample(course.path, index) ? index : undefined
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
  const fromStart = path.closed ? wrap(direction * ((vehicle.recoveryAnchorIndex ?? vehicle.pathIndex) - startPathIndex)) : (vehicle.recoveryAnchorIndex ?? vehicle.pathIndex)
  // Cars can begin just behind Start. Keep that approach available when gate 1 is pending.
  const behindStart = path.closed && vehicle.nextSector === 1 && fromStart >= count - 12
  const first = behindStart ? fromStart - count : 0
  const anchor = behindStart ? first : Math.max(0, Math.min(last, fromStart))
  const limit = path.closed && behindStart ? Math.min(last, count + first - 1) : last
  const sample = (progress: number) => path.closed ? wrap(startPathIndex + direction * progress) : progress
  for (let offset = 0; offset <= Math.max(anchor - first, limit - anchor); offset++) {
    const trailing = path.closed || !reversed ? anchor - offset : anchor + offset
    const leading = path.closed || !reversed ? anchor + offset : anchor - offset
    for (const progress of offset === 0 ? [anchor] : [trailing, leading]) {
      if (progress < first || progress > limit) continue
      const index = sample(progress)
      if (isSafeRoadRecoverySample(path, index)) return index
    }
  }
  return undefined
}
