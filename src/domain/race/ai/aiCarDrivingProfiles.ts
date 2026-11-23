import type { CarId } from '@/domain/model'

/**
 * Car-specific Arcade AI *driving decisions*, not car physics.
 *
 * Hard is calibrated first against the same fixed track/seed; Normal/Easy
 * continue to share the existing stable steering controller and use difficulty
 * reserves. Profiles may evolve independently without altering the vehicle's
 * tire forces, engine, brake strength, checkpoints, or recovery rules.
 */
export interface CarDrivingProfile {
  readonly hardReaction: number
  readonly hardSteerGain: number
  readonly hardCornerReserve: number
  readonly hardLookAheadSamples: number
  /** Hard-only tactical line choice; never changes tire forces or the road. */
  readonly hardApexCutScale?: number
  /** Fraction of pursuit shortening applied near the outer road edge. */
  readonly hardEdgeAvoidanceScale?: number
  /** Extra planned corner speed on a controlled Hard racing line, never physics. */
  readonly hardCornerTargetBonus?: number
}

export const CAR_DRIVING_PROFILES = {
  // Blue's stronger steering is a mixed-track regression: the fast Kids Room
  // line loses more time in Pine Hairpins. Tune its preview before turn-in.
  blue: {
    hardReaction: 8,
    hardSteerGain: 2.22,
    hardCornerReserve: 0,
    hardLookAheadSamples: 10,
    hardApexCutScale: 1,
    hardEdgeAvoidanceScale: 0.4,
    hardCornerTargetBonus: 0.04,
  },
  // Red's low-grip, high-speed chassis needs a settled, slower-changing
  // turn-in; it uses the existing stable late-braking logic separately.
  red: {
    hardReaction: 12,
    hardSteerGain: 2.22,
    hardCornerReserve: 0.01,
    hardLookAheadSamples: 10,
    hardCornerTargetBonus: 0.06,
  },
  // Green rotates easily on street/dirt. With its longer preview it can
  // stay on line without a separate Hard apex speed reserve.
  green: {
    hardReaction: 10,
    hardSteerGain: 2.7,
    hardCornerReserve: 0,
    hardLookAheadSamples: 8,
    hardCornerReserve: 0.035,
    hardCornerTargetBonus: 0.3,
  },
  // Yellow's heavier yaw and strong loose-surface grip favor the stable
  // controller; its terrain advantages remain exclusively in physics.
  yellow: {
    hardReaction: 12,
    hardSteerGain: 3.2,
    hardCornerReserve: 0,
    hardLookAheadSamples: 10,
    hardCornerTargetBonus: 0.45,
  },
} as const satisfies Record<CarId, CarDrivingProfile>
