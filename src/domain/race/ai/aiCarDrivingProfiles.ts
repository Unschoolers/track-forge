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
}

export const CAR_DRIVING_PROFILES = {
  // Blue's stronger steering is a mixed-track regression: the fast Kids Room
  // line loses more time in Pine Hairpins. Tune its preview before turn-in.
  blue: {
    hardReaction: 8,
    hardSteerGain: 2.22,
    hardCornerReserve: 0,
    hardLookAheadSamples: 10,
  },
  // Red's low-grip, high-speed chassis needs a settled, slower-changing
  // turn-in; it uses the existing stable late-braking logic separately.
  red: {
    hardReaction: 8,
    hardSteerGain: 2.22,
    hardCornerReserve: 0,
    hardLookAheadSamples: 4,
  },
  // Green rotates easily on street/dirt. A small planned apex reserve reduces
  // excessive sliding. A small Hard-only reserve balances entry grip against speed.
  green: {
    hardReaction: 10,
    hardSteerGain: 2.42,
    hardCornerReserve: 0.02,
    hardLookAheadSamples: 8,
  },
  // Yellow's heavier yaw and strong loose-surface grip favor the stable
  // controller; its terrain advantages remain exclusively in physics.
  yellow: {
    hardReaction: 8,
    hardSteerGain: 2.7,
    hardCornerReserve: 0,
    hardLookAheadSamples: 10,
  },
} as const satisfies Record<CarId, CarDrivingProfile>
