import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { authoredRecoveryTarget, lastRoadRecoveryTarget, missedGateRecoveryTarget, safeFallbackRecoveryTarget, type RecoveryCourse } from '@/domain/race/recoveryCheckpoints'
import { lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import { buildRaceCameraHints, findNearestSafeTrackIndex, resetVehicleToTrack } from '@/domain/race/trackContext'

export function resetRaceVehicle(
  vehicle: RaceVehicle,
  race: RecoveryCourse & Pick<Partial<RaceState>, 'missedCheckpoint'>,
): RaceVehicle {
  if (vehicle.player) {
    if (race.missedCheckpoint) return resetMissedCheckpoint(vehicle, race)
    const pathIndex = lastRoadRecoveryTarget(race, vehicle) ??
      authoredRecoveryTarget(race, vehicle) ?? safeFallbackRecoveryTarget(race, vehicle)
    if (pathIndex === undefined) return vehicle
    return resetVehicleToTrack({
      ...vehicle,
      waterRecoveryProtected: false,
      ...(vehicle.wrecked ? { wrecked: false, damage: 0, damageCooldown: 0.55 } : {}),
    }, race.path, { pathIndex, reversed: race.reversed })
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
  const recovered = resetRaceVehicle(player, state)
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

/** Respawn on the approach side of the pending timing stripe, never past it. */
export function resetMissedCheckpoint(
  vehicle: RaceVehicle,
  race: RecoveryCourse & Pick<Partial<RaceState>, 'missedCheckpoint'>,
): RaceVehicle {
  const target = missedGateRecoveryTarget(race, race.missedCheckpoint?.gate ?? vehicle.nextSector)
  if (!target) return vehicle
  return resetVehicleToTrack(
    {
      ...vehicle,
      waterRecoveryProtected: !target.safe,
      ...(vehicle.wrecked ? { wrecked: false, damage: 0, damageCooldown: 0.55 } : {}),
    },
    race.path,
    { pathIndex: target.index, reversed: race.reversed },
  )
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

