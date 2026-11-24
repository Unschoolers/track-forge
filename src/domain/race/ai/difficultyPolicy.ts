import { DIFFICULTY_SPECS } from '@/domain/config'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import type { CarId, DifficultyId } from '@/domain/model'

type Handling = 'arcade' | 'simulation'

/**
 * Hard-first tuning contract (docs/ai-difficulty-tuning.md):
 * calibrate the physically safe Hard controller before adjusting Normal/Easy.
 * All Arcade cars, including Green, share Hard's chassis-aware steering
 * technique; Normal/Easy derive slower corner-speed targets via larger
 * reserves and lower authored-line pace, not separate car physics.
 *
 * Race pacing overrides live together, separate from authored line geometry.
 * DIFFICULTY_SPECS remains the authority for core driver characteristics.
 */
const AI_PACE_POLICY = {
  easy: { arcadeCornerMargin: 0.21, authoredLineSpeedRatio: 0.86 },
  normal: { arcadeCornerMargin: 0.12, authoredLineSpeedRatio: 0.908 },
  hard: { arcadeCornerMargin: 0, authoredLineSpeedRatio: 1 },
} as const satisfies Record<DifficultyId, {
  readonly arcadeCornerMargin: number
  readonly authoredLineSpeedRatio: number
}>

/** Arcade and authored lines retain Hard steering technique on all levels. */
export function aiSteeringDifficulty(
  difficulty: DifficultyId,
  handling: Handling,
  hasAuthoredLine: boolean,
): DifficultyId {
  return handling === 'arcade' || hasAuthoredLine ? 'hard' : difficulty
}

/**
 * Lower difficulties carry an explicit corner-speed reserve. Hard stays the
 * fastest safe controller: a highly responsive chassis needs a small apex
 * reserve to avoid losing more time to excessive slip or offroad recoveries.
 * This modifies only the AI's speed *target*, not physical grip or brakes.
 */
export function arcadeCornerMargin(difficulty: DifficultyId, car?: CarId, hardProfile?: CarDrivingProfile): number {
  if (difficulty !== 'hard' || !car) {
    return AI_PACE_POLICY[difficulty].arcadeCornerMargin
  }
  return (hardProfile ?? CAR_DRIVING_PROFILES[car]).hardCornerReserve
}

/** Émile-specific racing-line speed ratios, independent of line geometry. */
export function authoredLineSpeedRatio(difficulty: DifficultyId): number {
  return AI_PACE_POLICY[difficulty].authoredLineSpeedRatio
}

/**
 * Grid-rival pace is deliberately chosen independently of steering technique:
 * Arcade's historical baseline uses Hard's three distinct rival pace values.
 */
export function raceRivalPace(
  difficulty: DifficultyId,
  handling: Handling | undefined,
  rivalIndex: number,
): number {
  const pace = DIFFICULTY_SPECS[(handling ?? 'arcade') === 'arcade' ? 'hard' : difficulty]
  return (('aiPaces' in pace ? pace.aiPaces[rivalIndex] : undefined) ??
    (0.985 - rivalIndex * 0.008))
}
