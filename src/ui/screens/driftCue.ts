import type { RaceVehicle, RacePhase } from '@/domain/race/raceState'

/** A cue for controlled sideways motion, never for grass spins or parking. */
export function driftCue(
  vehicle: Pick<RaceVehicle, 'speed' | 'slip' | 'braking' | 'currentSurface' | 'wrecked'> | undefined,
  phase: RacePhase,
  paused: boolean,
): 'DRIFT' | 'ICE SLIDE' | null {
  if (!vehicle || phase !== 'running' || paused ||
      vehicle.wrecked || vehicle.braking || vehicle.speed < 90 ||
      vehicle.currentSurface === 'grass') return null
  const threshold = vehicle.currentSurface === 'ice' ? 12 :
    vehicle.currentSurface === 'dirt' ? 16 : 22
  if (vehicle.slip < threshold) return null
  return vehicle.currentSurface === 'ice' ? 'ICE SLIDE' : 'DRIFT'
}
