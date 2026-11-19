// Indexed by the authored road segment. Offsets are in world units and
// lookahead extends the normal pursuit target by a number of road samples.
export const EMILE_COURSE = 'v2:988cf01ca954b488'
function section(extraSamples: number, laneOffset: number, cornerPace: number) {
  return { extraSamples, laneOffset, cornerPace }
}

export const EMILE_LINE = [
  // lookahead, lateral offset, corner speed target multiplier
  section(0, 18, 0.9), section(0, 0, 1), section(0, 8, 1), section(18, 16, 1.2),
  section(-4, -26, 1.1), section(0, -16, 1), section(0, -16, 1), section(12, -26, 1.4),
  section(18, 0, 1.68), section(8, 0, 1.06), section(18, 0, 1.484), section(0, -26, 1.4),
  section(0, 0, 1),
] as const
