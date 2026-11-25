import { MANUAL_RECOVERY_TICKS, manualRecoveryTicksRemaining, type RaceState, type RaceVehicle } from '@/domain/race/raceState'
import { authoredRecoveryTarget, lastRoadRecoveryTarget, missedGateRecoveryTarget, safeFallbackRecoveryTarget, type RecoveryCourse } from '@/domain/race/recoveryCheckpoints'
import { lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import { buildRaceCameraHints, findNearestSafeTrackIndex, resetVehicleToTrack, type VehicleStepContext } from '@/domain/race/trackContext'
import type { DriftBoostRules } from '@/domain/race/driftBoost'

function resetRaceVehicleWithoutBoostCancellation(
  vehicle: RaceVehicle,
  race: RecoveryCourse & Pick<Partial<RaceState>, 'missedCheckpoint' | 'driftBoostRules'>,
): RaceVehicle {
  const pending = vehicle.player ? race.missedCheckpoint : vehicle.missedCheckpoint
  if (pending) return resetMissedCheckpoint(vehicle, { ...race, missedCheckpoint: pending })
  if (vehicle.player) {
    const pathIndex = lastRoadRecoveryTarget(race, vehicle) ??
      authoredRecoveryTarget(race, vehicle) ?? safeFallbackRecoveryTarget(race, vehicle)
    if (pathIndex === undefined) return vehicle
    return resetVehicleToTrack({
      ...vehicle,
      waterRecoveryProtected: false,
    }, race.path, { pathIndex, reversed: race.reversed })
  }
  if (race.routeKind !== 'point-to-point') {
    if (race.timingGates?.length) {
      const pathIndex = safeFallbackRecoveryTarget(race, vehicle)
      if (pathIndex !== undefined) return resetVehicleToTrack(vehicle, race.path, { pathIndex, reversed: race.reversed })
      return resetMissedCheckpoint(vehicle, { ...race, missedCheckpoint: undefined })
    }
    return resetVehicleToTrack(vehicle, race.path, { reversed: race.reversed })
  }
  const limit = lastSampleBeforeCheckpoint(race.path, vehicle.nextSector, race.timingGates)
  const pathIndex = findNearestSafeTrackIndex(race.path, vehicle, false, limit)
  return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex })
}


function cancelActiveBoostOnRecovery(vehicle: RaceVehicle, rules: DriftBoostRules | undefined): RaceVehicle {
  if (!rules || vehicle.driftBoost?.phase !== 'active') return vehicle
  return { ...vehicle, driftBoost: { ...vehicle.driftBoost, phase: 'returning', remainingTicks: Math.ceil(rules.returnSeconds * 60) } }
}

export function resetRaceVehicle(
  vehicle: RaceVehicle,
  race: RecoveryCourse & Pick<Partial<RaceState>, 'missedCheckpoint' | 'driftBoostRules'>,
): RaceVehicle {
  return cancelActiveBoostOnRecovery(resetRaceVehicleWithoutBoostCancellation(vehicle, race), race.driftBoostRules)
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
function resetMissedCheckpointWithoutBoostCancellation(
  vehicle: RaceVehicle,
  race: RecoveryCourse & Pick<Partial<RaceState>, 'missedCheckpoint' | 'driftBoostRules'>,
): RaceVehicle {
  const target = missedGateRecoveryTarget(race, (vehicle.player ? race.missedCheckpoint : vehicle.missedCheckpoint ?? race.missedCheckpoint)?.gate ?? vehicle.nextSector)
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


export function resetMissedCheckpoint(
  vehicle: RaceVehicle,
  race: RecoveryCourse & Pick<Partial<RaceState>, 'missedCheckpoint' | 'driftBoostRules'>,
): RaceVehicle {
  return cancelActiveBoostOnRecovery(resetMissedCheckpointWithoutBoostCancellation(vehicle, race), race.driftBoostRules)
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


/** Gameplay recovery thresholds; independent from checkpoint scoring geometry. */
export const RECOVERY_TUNING = {
  aiOffRoadDistance: 100,
  aiOffRoadGraceSeconds: 2,
  playerStuckSeconds: 2,
} as const

export function advanceRivalOffRoadRecovery(
  vehicle: RaceVehicle,
  context: Pick<VehicleStepContext, 'onRoad' | 'nearest'>,
  dt: number,
): { vehicle: RaceVehicle; expired: boolean } {
  if (vehicle.player || vehicle.finishedAt !== null) return { vehicle, expired: false }
  const previous = vehicle.aiOffRoadSeconds ?? 0
  const seconds = context.onRoad ? 0 : vehicle.grounded ? previous + dt : previous
  return {
    vehicle: seconds === previous ? vehicle : { ...vehicle, aiOffRoadSeconds: seconds },
    expired: vehicle.grounded && !context.onRoad &&
      (context.nearest.distance > RECOVERY_TUNING.aiOffRoadDistance ||
        seconds >= RECOVERY_TUNING.aiOffRoadGraceSeconds - 1e-9),
  }
}
