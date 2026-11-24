import { DIFFICULTY_SPECS } from '@/domain/config'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import type { CarId, DifficultyId } from '@/domain/model'

/**
 * Hard-first tuning contract (docs/ai-difficulty-tuning.md):
 * calibrate the physically safe Hard controller before adjusting Normal/Easy.
 * All Arcade cars, including Green, share Hard's chassis-aware steering
 * technique; Normal/Easy derive slower corner-speed targets via larger
 * reserves, not separate car physics.
 *
 * Race pacing overrides live together, independent of track identity.
 * DIFFICULTY_SPECS remains the authority for core driver characteristics.
 */
const AI_PACE_POLICY = {
  easy: { arcadeCornerMargin: 0.16 },
  normal: { arcadeCornerMargin: 0.08 },
  hard: { arcadeCornerMargin: 0 },
} as const satisfies Record<DifficultyId, {
  readonly arcadeCornerMargin: number
}>

/**
 * Lower difficulties carry an explicit corner-speed reserve. Hard stays the
 * fastest safe controller: a highly responsive chassis needs a small apex
 * reserve to avoid losing more time to excessive slip or offroad recoveries.
 * This modifies only the AI's speed *target*, not physical grip or brakes.
 */
export function arcadeCornerMargin(difficulty: DifficultyId, car?: CarId, hardProfile?: CarDrivingProfile): number {
  const profile: CarDrivingProfile | undefined = car ? hardProfile ?? CAR_DRIVING_PROFILES[car] : undefined
  if (difficulty !== 'hard' || !profile) {
    return AI_PACE_POLICY[difficulty].arcadeCornerMargin * (profile?.lowerDifficultyReserveScale ?? 1)
  }
  return profile.hardCornerReserve
}

/**
 * Grid-rival pace is deliberately chosen independently of steering technique:
 * Arcade's historical baseline uses Hard's three distinct rival pace values.
 */
export function raceRivalPace(rivalIndex: number): number {
  return DIFFICULTY_SPECS.hard.aiPaces[rivalIndex] ?? (0.985 - rivalIndex * 0.008)
}
