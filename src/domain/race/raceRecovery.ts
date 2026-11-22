import { ROAD_GEOMETRY } from '@/domain/config'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { authoredRecoveryTarget, lastRoadRecoveryTarget, planMissedCheckpointRecovery, safeFallbackRecoveryTarget, type RecoveryCourse } from '@/domain/race/recoveryCheckpoints'
import { lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import { buildRaceCameraHints, findNearestSafeTrackIndex, resetVehicleToTrack } from '@/domain/race/trackContext'
import { isSafeRoadRecoverySample } from '@/domain/track/waterExposure'

export function resetRaceVehicle(
  vehicle: RaceVehicle,
  race: RecoveryCourse,
): RaceVehicle {
  if (vehicle.player) {
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

/**
 * A missed finish is different from a missed sector: road contact after Start
 * belongs to the next lap, even though its wrapped path index looks valid.
 * Place the car a short, driveable distance BEFORE Finish in race direction.
 */
function preFinishRecoveryTarget(race: RaceState): { index: number; safe: boolean } | undefined {
  const { path } = race
  const count = path.points.length
  if (count < 2) return undefined
  const samples = path.closed ? count : count - 1
  const spacing = path.totalLength / samples
  const buffer = Math.min(samples - 1, Math.max(1, Math.ceil(ROAD_GEOMETRY.onRoadRadius / Math.max(spacing, 1))))
  const approach = samples - buffer
  const atProgress = (progress: number): number => path.closed
    ? ((race.startPathIndex + (race.reversed ? -progress : progress)) % count + count) % count
    : progress
  for (let progress = approach; progress >= 0; progress--) {
    const index = atProgress(progress)
    if (isSafeRoadRecoverySample(path, index)) return { index, safe: true }
  }
  return { index: atProgress(approach), safe: false }
}

export function resetMissedCheckpoint(vehicle: RaceVehicle, race: RaceState): RaceVehicle {
  if (race.missedCheckpoint?.gate === 4) {
    const target = preFinishRecoveryTarget(race)
    if (target) {
      return resetVehicleToTrack(
        { ...vehicle, waterRecoveryProtected: !target.safe },
        race.path,
        { pathIndex: target.index, reversed: race.reversed },
      )
    }
  }
  const plan = planMissedCheckpointRecovery(race, vehicle)
  if (!plan) return vehicle
  // Preserve the fallback for badly authored courses that have no dry road
  // before the pending gate, without creating water-reset loops.
  return resetVehicleToTrack(
    {
      ...vehicle,
      pathIndex: plan.anchorIndex,
      recoveryAnchorIndex: plan.anchorIndex,
      waterRecoveryProtected: plan.waterRecoveryProtected,
    },
    race.path,
    { pathIndex: plan.pathIndex, reversed: race.reversed },
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

