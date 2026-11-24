import type { RacingLineSection } from '@/domain/race/ai/aiState'
import type { CarId } from '@/domain/model'

// Indexed by the authored road segment. Offsets are in world units and
// lookahead extends the normal pursuit target by a number of road samples.
export const EMILE_COURSE = 'v3:b61460bf60d391eb'
function section(extraSamples: number, laneOffset: number, cornerPace: number): RacingLineSection {
  return { extraSamples, laneOffset, cornerPace }
}

const EMILE_BLUE_LINE = [
  // lookahead, lateral offset, corner speed target multiplier
  section(0, 18, 0.9), section(0, 0, 1), section(0, 8, 1), section(18, 16, 1.2),
  section(-4, -26, 1.1), section(0, -16, 1), section(0, -16, 1), section(12, -26, 1.4),
  section(18, 0, 1.68), section(8, 0, 1.06), section(18, 0, 1.484), section(0, -26, 1.4),
  section(0, 0, 1),
] as const

const EMILE_RED_LINE = [
  section(8, 0, 1.18), section(0, -9, 1.2), section(-5, 6, 1), section(20, 18, 1),
  section(0, -27, 1.19), section(-5, 0, 1), section(5, -7, 1), section(22, 10, 1.4),
  section(28, 9, 1.68), section(3, 9, 1.06), section(23, -27, 1.484), section(6, -26, 1.58),
  section(15, -18, 1),
] as const

const EMILE_GREEN_LINE = [
  section(0, 8, 0.9), section(0, 10, 1), section(0, 8, 1), section(10, 28, 1.41),
  section(12, -8, 1.11), section(0, -26, 0.96), section(0, -16, 1), section(18, -16, 1.4),
  section(18, 0, 1.68), section(8, 10, 1.22), section(18, 0, 1.384), section(-12, -26, 1.28),
  section(0, 0, 1),
] as const

const EMILE_YELLOW_LINE = [
  section(0, 8, 0.96), section(0, 10, 1), section(0, 28, 1), section(18, 16, 1.36),
  section(-4, -26, 1.26), section(0, -16, 1), section(0, -16, 1), section(12, -16, 1.4),
  section(20, 0, 1.68), section(14, 0, 1.12), section(18, 0, 1.644), section(0, -26, 1.62),
  section(-2, 0, 1),
] as const

export const EMILE_RACING_LINES: Readonly<Record<CarId, readonly RacingLineSection[]>> = {
  blue: EMILE_BLUE_LINE,
  red: EMILE_RED_LINE,
  green: EMILE_GREEN_LINE,
  yellow: EMILE_YELLOW_LINE,
}

