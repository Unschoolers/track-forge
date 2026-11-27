import type { CarId, DifficultyId } from '@/domain/model'

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
  /** Extra tight paved-bend entry caution, only when sharpness justifies it. */
  readonly hardHairpinReserve?: number
  readonly hardLookAheadSamples: number
  /** Hard-only tactical line choice; never changes tire forces or the road. */
  readonly hardApexCutScale?: number
  /** Experimental blend into the continuous geometry racing line; default off. */
  readonly hardRacingLineBlend?: number
  /** Fraction of pursuit shortening applied near the outer road edge. */
  readonly hardEdgeAvoidanceScale?: number
  /** Extra planned corner speed on a controlled Hard racing line, never physics. */
  readonly hardCornerTargetBonus?: number
  readonly hardDirtCornerTargetBonus?: number
  readonly hardStreetCornerTargetBonus?: number
  readonly hardStreetSweepCornerTargetBonus?: number
  readonly hardIceApexPaceScale?: number
  /** Small Normal-only planned corner-speed allowance for this chassis. */
  readonly normalCornerTargetBonus?: number
  /** Scale the shared difficulty reserve for this chassis. */
  readonly lowerDifficultyReserveScale?: number
  /** Curvature-weighted pace and pursuit reserves across all difficulties. */
  readonly technicalCornerPaceScale?: number
  readonly technicalCornerPursuitScale?: number
  /** Optional difficulty-specific overrides; unspecified levels retain the shared scale. */
  readonly technicalCornerPaceByDifficulty?: Readonly<Partial<Record<DifficultyId, number>>>
  readonly technicalCornerPursuitByDifficulty?: Readonly<Partial<Record<DifficultyId, number>>>
  /** Local curvature at which the technical-corner reserve starts fading in. */
  readonly technicalCornerActivation?: number
}

export const CAR_DRIVING_PROFILES = {
  // Pair stronger steering with less pursuit shortening near the road edge.
  blue: {
    hardReaction: 8,
    hardSteerGain: 2.4,
    hardCornerReserve: 0,
    hardIceApexPaceScale: 0.72,
    hardLookAheadSamples: 12,
    hardApexCutScale: 1,
    hardEdgeAvoidanceScale: 0.3,
    hardCornerTargetBonus: 0.12,
    hardStreetSweepCornerTargetBonus: 0.6,
    normalCornerTargetBonus: 0.006,
    lowerDifficultyReserveScale: 0.98,
  },
  // Red's low-grip, high-speed chassis needs a settled, slower-changing
  // turn-in; it uses the existing stable late-braking logic separately.
  red: {
    hardReaction: 12,
    hardSteerGain: 2.22,
    hardCornerReserve: 0.01,
    hardIceApexPaceScale: 0.86,
    hardLookAheadSamples: 10,
    hardCornerTargetBonus: 0.06,
    hardDirtCornerTargetBonus: 0.27,
    hardStreetCornerTargetBonus: 0.19,
    normalCornerTargetBonus: 0.02,
    technicalCornerPursuitByDifficulty: { hard: 0.85 },
    // The revised brake controller already reserves more corner-entry time.
    // Scale the additional Easy/Normal reserve so it does not double-count it.
    lowerDifficultyReserveScale: 0.45,
  },
  // Green rotates easily on street/dirt. With its longer preview it can
  // stay on line with a small Hard apex speed reserve.
  green: {
    hardReaction: 12,
    hardSteerGain: 3,
    hardCornerReserve: 0.035,
    hardLookAheadSamples: 10,
    hardCornerTargetBonus: 0.35,
    // Validated on Desert sand, Kids Room, Pine Hairpins, Meadow Loop:
    // preserve forward pursuit preview near ordinary road edges without
    // overriding real tire grip, corner/braking safety, or recovery rules.
    hardEdgeAvoidanceScale: 0.25,
    lowerDifficultyReserveScale: 0.97,
    technicalCornerPaceByDifficulty: { easy: 1, normal: 1 },
    technicalCornerPursuitByDifficulty: { easy: 0.8, normal: 0.85 },
  },
  // Yellow's heavier yaw and strong loose-surface grip favor the stable
  // controller; its terrain advantages remain exclusively in physics.
  yellow: {
    hardReaction: 12,
    hardSteerGain: 3,
    hardCornerReserve: 0,
    hardLookAheadSamples: 8,
    hardCornerTargetBonus: 0.45,
    hardHairpinReserve: 0.05,
    hardEdgeAvoidanceScale: 0.4,
    technicalCornerPaceByDifficulty: { hard: 0.95, normal: 1 },
    technicalCornerPursuitByDifficulty: { normal: 0.85 },
    lowerDifficultyReserveScale: 0.9,
  },
} as const satisfies Record<CarId, CarDrivingProfile>
