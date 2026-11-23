import type { CarId } from '@/domain/model'

/**
 * Per-chassis overtaking *decisions*. Steering line/speed profiles and
 * physical tire/engine/brake properties remain independent.
 *
 * All four profiles intentionally start at the proven shared behavior.
 * Tune one car only after a controlled two-car study passes full-field QA.
 */
export interface CarPassingPolicy {
  /** Multiplicative adjustment to the personality's trigger distance. */
  readonly triggerDistanceScale: number
  /** Added speed advantage required before starting a pass (world units/s). */
  readonly passSpeedAdvantage: number
  /** Stop an unproductive pass after this much time, if rejoining is safe. */
  readonly abandonAfterSeconds: number
  /** Require this duration of uninterrupted clear base lane before rejoining. */
  readonly rejoinClearSeconds: number
}

const BASELINE_PASSING: CarPassingPolicy = {
  triggerDistanceScale: 1,
  passSpeedAdvantage: 0,
  abandonAfterSeconds: 8,
  rejoinClearSeconds: 0.25,
}

export const CAR_PASSING_POLICIES: Readonly<Record<CarId, CarPassingPolicy>> = {
  // Red previously stayed in a clearly stalled pass for eight seconds.
  // Five and a half seconds gained 1.65% in matching duels and 0.39% over
  // full multi-track trials without newly introduced recoveries.
  red: { ...BASELINE_PASSING, abandonAfterSeconds: 5.5 },
  // Hold the return lane clear a little longer: this improved clean
  // Green duels without altering its solo cornering controller.
  green: { ...BASELINE_PASSING, rejoinClearSeconds: 0.3 },
  // Blue's repeated ~8-second passes on Figure-eight point to an overly
  // long futile-pass wait. Keep the shared safety gate for rejoining.
  blue: { ...BASELINE_PASSING, abandonAfterSeconds: 6.5 },
  // Yellow's repeated failed full-field passes benefit from more time to
  // verify its base lane is clear. This does not change tire grip.
  yellow: { ...BASELINE_PASSING, rejoinClearSeconds: 0.4 },
}

export function validatePassingPolicy(policy: CarPassingPolicy): void {
  if (!Number.isFinite(policy.triggerDistanceScale) ||
      policy.triggerDistanceScale < 0.5 || policy.triggerDistanceScale > 1.5 ||
      !Number.isFinite(policy.passSpeedAdvantage) ||
      policy.passSpeedAdvantage < -3 || policy.passSpeedAdvantage > 25 ||
      !Number.isFinite(policy.abandonAfterSeconds) ||
      policy.abandonAfterSeconds < 1 || policy.abandonAfterSeconds > 15 ||
      !Number.isFinite(policy.rejoinClearSeconds) ||
      policy.rejoinClearSeconds < 0.2 || policy.rejoinClearSeconds > 1)
    throw new Error('Invalid car-specific passing policy')
}
