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
  red: { ...BASELINE_PASSING },
  green: { ...BASELINE_PASSING },
  blue: { ...BASELINE_PASSING },
  yellow: { ...BASELINE_PASSING },
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
