import type { RaceVehicle } from '@/domain/race/raceState'
import { SUPPORT_HEIGHT_EPSILON } from '@/domain/race/vehicleVerticalDynamics'

export const BRIDGE_FALL_RESPAWN_SECONDS = 0.25

export function hasBridgeFallExpired(seconds: number | undefined): boolean {
  // Fixed-step accumulation can land just below the exact deadline.
  return seconds !== undefined && seconds >= BRIDGE_FALL_RESPAWN_SECONDS - 1e-9
}

/** Track a fall from elevated road support without mistaking normal ramp exits for a fall. */
export function trackBridgeFall(
  previous: RaceVehicle,
  current: RaceVehicle,
  onRoad: boolean,
  structureRunId: string | null,
  surfaceHeight: number,
  dt: number,
): RaceVehicle {
  if (!current.player) return current
  // Reaching supported elevated road cancels an unfinished fall timer.
  if (onRoad && current.grounded && structureRunId !== null) {
    return previous.bridgeFallSeconds === undefined
      ? current : { ...current, bridgeFallSeconds: undefined }
  }
  const leftRaisedSupport = previous.structureRunId !== null &&
    previous.grounded && (!onRoad || structureRunId !== previous.structureRunId) &&
    (!current.grounded || current.z > surfaceHeight + SUPPORT_HEIGHT_EPSILON)
  if (!leftRaisedSupport && previous.bridgeFallSeconds === undefined) return current
  return {
    ...current,
    bridgeFallSeconds: (previous.bridgeFallSeconds ?? 0) + dt,
  }
}
