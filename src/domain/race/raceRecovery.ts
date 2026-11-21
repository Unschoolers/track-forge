import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { authoredRecoveryTarget, safeFallbackRecoveryTarget, type RecoveryCourse } from '@/domain/race/recoveryCheckpoints'
import { lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import { buildRaceCameraHints, findNearestSafeTrackIndex, resetVehicleToTrack } from '@/domain/race/trackContext'

export function resetRaceVehicle(
  vehicle: RaceVehicle,
  race: RecoveryCourse,
): RaceVehicle {
  const checkpoint = resetAtAuthoredCheckpoint(vehicle, race)
  if (checkpoint) return checkpoint
  if (vehicle.player) {
    const pathIndex = safeFallbackRecoveryTarget(race, vehicle)
    return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex, reversed: race.reversed })
  }
  if (race.routeKind !== 'point-to-point') {
    return resetVehicleToTrack(vehicle, race.path, { reversed: race.reversed })
  }
  const limit = lastSampleBeforeCheckpoint(race.path, vehicle.nextSector)
  const pathIndex = findNearestSafeTrackIndex(race.path, vehicle, false, limit)
  return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex })
}

export function recoverRacePlayer(state: RaceState): RaceState {
  if (state.phase !== 'running' || state.paused) return state
  const index = state.vehicles.findIndex((vehicle) => vehicle.player)
  const player = state.vehicles[index]
  if (!player) return state
  const recovered = state.missedCheckpoint ? resetMissedCheckpoint(player, state) : resetRaceVehicle(player, state)
  if (recovered === player) return state
  const vehicles = [...state.vehicles]
  vehicles[index] = recovered
  return {
    ...state,
    vehicles,
    missedCheckpoint: undefined,
    cameraHints: buildRaceCameraHints(state.path, recovered, state.reversed),
  }
}

export function resetMissedCheckpoint(vehicle: RaceVehicle, race: RaceState): RaceVehicle {
  const authored = vehicle.recoveryCheckpoint == null ? undefined : resetAtAuthoredCheckpoint(vehicle, race)
  if (authored) return authored
  const count = race.path.points.length
  const previousGate = vehicle.nextSector - 1
  const progress = Math.floor((race.path.closed ? count : count - 1) * previousGate / 4)
  const target = race.path.closed
    ? ((race.startPathIndex + (race.reversed ? -1 : 1) * progress) % count + count) % count
    : progress
  const candidate = { ...vehicle, pathIndex: target, recoveryAnchorIndex: target }
  const safe = safeFallbackRecoveryTarget(race, candidate)
  // A badly authored course can have no dry road before the pending gate.
  // Still complete the countdown: restore the pre-gate road centre and
  // suppress water-reset loops until the driver reaches dry support.
  return resetVehicleToTrack(
    { ...candidate, waterRecoveryProtected: safe === undefined },
    race.path,
    { pathIndex: safe ?? target, reversed: race.reversed },
  )
}

function resetAtAuthoredCheckpoint(vehicle: RaceVehicle, race: RecoveryCourse): RaceVehicle | undefined {
  const pathIndex = authoredRecoveryTarget(race, vehicle)
  if (pathIndex === undefined) return undefined
  return resetVehicleToTrack({
    ...vehicle,
    waterRecoveryProtected: false,
    ...(vehicle.wrecked ? { wrecked: false, damage: 0, damageCooldown: 0.55 } : {}),
  }, race.path, { pathIndex, reversed: race.reversed })
}

export function restoreFrameProgress(vehicle: RaceVehicle, previous: RaceVehicle): RaceVehicle {
  return {
    ...vehicle,
    nextSector: previous.nextSector,
    lap: previous.lap,
    finishedAt: previous.finishedAt,
    ...(vehicle.recoveryCheckpoint === undefined && previous.recoveryCheckpoint === undefined
      ? {} : { recoveryCheckpoint: previous.recoveryCheckpoint ?? null }),
  }
}

