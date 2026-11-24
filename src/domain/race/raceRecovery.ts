import { MANUAL_RECOVERY_TICKS, manualRecoveryTicksRemaining, type RaceState, type RaceVehicle } from '@/domain/race/raceState'
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
    }, race.path, { pathIndex, reversed: race.reversed })
  }
  if (race.routeKind !== 'point-to-point') {
    return resetVehicleToTrack(vehicle, race.path, { reversed: race.reversed })
  }
  const limit = lastSampleBeforeCheckpoint(race.path, vehicle.nextSector, race.timingGates)
  const pathIndex = findNearestSafeTrackIndex(race.path, vehicle, false, limit)
  return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex })
}

export function recoverRacePlayer(state: RaceState): RaceState {
  const player = state.vehicles.find((vehicle) => vehicle.player)
  return player ? recoverRaceVehicle(state, player.id) : state
}

/** Explicit manual request, for any driver. Automatic resets use resetRaceVehicle. */
export function recoverRaceVehicle(state: RaceState, vehicleId: string): RaceState {
  if (state.phase !== 'running' || state.paused) return state
  const index = state.vehicles.findIndex((vehicle) => vehicle.id === vehicleId)
  const vehicle = state.vehicles[index]
  if (!vehicle || vehicle.finishedAt !== null || manualRecoveryTicksRemaining(vehicle, state.tick) > 0) return state
  const recovered = resetRaceVehicle(vehicle, state)
  if (recovered === vehicle) return state
  const vehicles = [...state.vehicles]
  vehicles[index] = vehicle.player && state.missedCheckpoint
    ? recovered : { ...recovered, manualRecoveryUntilTick: state.tick + MANUAL_RECOVERY_TICKS }
  return {
    ...state,
    vehicles,
    ...(vehicle.player ? {
      missedCheckpoint: undefined,
      cameraHints: buildRaceCameraHints(state.path, recovered, state.reversed),
    } : {}),
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

