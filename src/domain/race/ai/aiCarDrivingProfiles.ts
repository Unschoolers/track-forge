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
}

export const CAR_DRIVING_PROFILES = {
  // Blue's balanced chassis needs earlier, firmer steering. Keeping the old
  // weak Hard steer response cost time through successive Kids Room corners.
  blue: {
    hardReaction: 12,
    hardSteerGain: 2.95,
    hardCornerReserve: 0,
  },
  // Red's low-grip, high-speed chassis needs a settled, slower-changing
  // turn-in; it uses the existing stable late-braking logic separately.
  red: {
    hardReaction: 8,
    hardSteerGain: 2.22,
    hardCornerReserve: 0,
  },
  // Green rotates easily on street/dirt. A small planned apex reserve reduces
  // excessive sliding, but a full 6% reserve cost measurable lap time.
  green: {
    hardReaction: 10,
    hardSteerGain: 2.42,
    hardCornerReserve: 0.035,
  },
  // Yellow's heavier yaw and strong loose-surface grip favor the stable
  // controller; its terrain advantages remain exclusively in physics.
  yellow: {
    hardReaction: 8,
    hardSteerGain: 2.22,
    hardCornerReserve: 0,
  },
} as const satisfies Record<CarId, CarDrivingProfile>
