import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate } from '@/domain/race/progress'
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
  if (!onRoad || !race.recoveryCheckpoints?.length || vehicle.finishedAt !== null) return last
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
    if (crossesRoadGate(race.path, previous, vehicle, index, ROAD_GEOMETRY.onRoadRadius, race.reversed)) {
      checkpoint = index
      furthest = distance
    }
  }
  return checkpoint
}

export function authoredRecoveryTarget(course: RecoveryCourse, vehicle: RaceVehicle): number | undefined {
  if (!vehicle.player || !course.recoveryCheckpoints?.length) return undefined
  const index = vehicle.recoveryCheckpoint ?? course.startPathIndex
  return isSafeRoadRecoverySample(course.path, index) ? index : undefined
}
