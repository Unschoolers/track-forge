import { clamp } from '@/domain/geometry/math'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { TrafficState } from '@/domain/race/ai/traffic'

/**
 * Arcade has no AI↔AI physical impacts. Other AI cars are therefore only
 * close-proximity hints ("dots"), not 18–40-unit collision envelopes that
 * provoke dangerous lane changes and emergency braking. Human cars keep
 * the full traffic model and overtaking behavior.
 *
 * Simulation mode with physical collisions intentionally uses the original
 * full traffic model.
 */
const AI_NEAR_DISTANCE = 10
const AI_NEAR_LANE_GAP = 7

export function compactAiTraffic(traffic: TrafficState): TrafficState {
  return {
    // The raw "ahead" can be a nearer AI sprite masking a human farther
    // up the same lane. Search the complete traffic list for the human;
    // preserving player challenges is as important as softening AI rivals.
    ahead: traffic.nearby.find(({ vehicle, signedDistance, laneGap }) =>
      vehicle.player && signedDistance >= 0 && laneGap <= 20) ?? null,
    nearby: traffic.nearby.filter(({ vehicle, signedDistance, laneGap }) =>
      vehicle.player || (Math.abs(signedDistance) < AI_NEAR_DISTANCE &&
        laneGap < AI_NEAR_LANE_GAP)),
  }
}

/**
 * Tiny, non-blocking courtesy move for a slower AI immediately ahead on
 * a straight. Never start a full passing lane-change, brake, or steer into
 * a sharp corner just because another AI's sprite overlaps ours.
 */
export function aiCourtesyNudge(
  vehicle: RaceVehicle,
  traffic: TrafficState,
  bend: number,
  onRoad: boolean,
): number {
  // A nudge at racing speed can create more risk than a harmless sprite
  // overlap. Only offer the courtesy on a genuine, slower straight.
  if (!onRoad || bend >= 0.035 || vehicle.speed >= 145) return 0
  // A nearby human takes priority and retains real passing clearance.
  if (traffic.nearby.some(({ vehicle: other, signedDistance }) =>
    other.player && Math.abs(signedDistance) < 45)) return 0

  const ahead = traffic.nearby.find(({ vehicle: other, signedDistance, laneGap }) =>
    !other.player && signedDistance > 0 && signedDistance < 26 &&
    laneGap < 10 && vehicle.speed > other.speed + 8)
  if (!ahead) return 0
  const side = vehicle.id < ahead.vehicle.id ? -1 : 1
  return side * 2 * clamp((26 - ahead.signedDistance) / 14, 0, 1) *
    clamp((0.035 - bend) / 0.025, 0, 1)
}
