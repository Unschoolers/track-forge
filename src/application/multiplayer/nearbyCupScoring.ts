/** The room supplies already ranked finishers. Unfinished peers block scoring. */
export interface NearbyCupFinish {
  readonly slot: number
  readonly time: number | null | undefined
  readonly left: boolean
}

const CUP_POINTS_FOUR = [10, 6, 4, 2] as const
const CUP_POINTS_EIGHT = [16, 12, 10, 8, 6, 4, 2, 1] as const

/** Pure scoring step; null means at least one peer has not finished or left. */
export function awardNearbyCupRound(
  standings: readonly NearbyCupFinish[],
  accumulated: ReadonlyMap<number, number>,
): Map<number, number> | null {
  if (!standings.length || standings.some(racer => racer.time === undefined && !racer.left)) return null
  const totals = new Map(accumulated)
  // Preserve existing four-player Cups; eight-racer Cups reward every finisher.
  const points = standings.length <= 4 ? CUP_POINTS_FOUR : CUP_POINTS_EIGHT
  for (const [index, racer] of standings.entries()) {
    if (typeof racer.time !== 'number') continue
    totals.set(racer.slot, (totals.get(racer.slot) ?? 0) + (points[index] ?? 0))
  }
  return totals
}

export function nearbyCupStandings(
  slots: Iterable<number>,
  scores: ReadonlyMap<number, number>,
): { slot: number; points: number }[] {
  return [...slots].map(slot => ({ slot, points: scores.get(slot) ?? 0 }))
    .sort((a, b) => b.points - a.points || a.slot - b.slot)
}
