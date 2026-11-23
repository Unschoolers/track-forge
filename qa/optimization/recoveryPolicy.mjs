/**
 * Recovery tolerance is difficulty- and baseline-dependent.
 * Hard is a precision driver: no avoidable recovery is acceptable.
 * Normal can make mistakes, but a new recovery warrants manual review.
 * Easy is intentionally fallible: +1 or +2 recoveries in an otherwise
 * comparable seeded race are acceptable, +3 or more requires investigation.
 *
 * This is an acceptance policy, not gameplay physics or a mistake generator.
 */
export function recoveryRegression(difficulty, before, after) {
  if (!['hard', 'normal', 'easy'].includes(difficulty) ||
      !Number.isInteger(before) || before < 0 ||
      !Number.isInteger(after) || after < 0)
    throw new Error('Invalid difficulty or recovery counts')
  if (difficulty === 'hard')
    return after > 0 ? `Hard driver recovered ${after} time(s)` : null
  const increase = after - before
  if (difficulty === 'normal')
    return increase > 0 ? `Normal gained ${increase} recovery/recoveries: review` : null
  return increase >= 3 ? `Easy gained ${increase} recoveries: investigate` : null
}
