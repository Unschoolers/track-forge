export const TREE_SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type TreeSeason = (typeof TREE_SEASONS)[number]

export function isTreeSeason(value: unknown): value is TreeSeason {
  return typeof value === 'string' && (TREE_SEASONS as readonly string[]).includes(value)
}
