import type { CarId } from '@/domain/model'

interface GearboxProfile {
  readonly gears: number
  readonly growth: number
  readonly idle: number
  readonly sweep: number
  readonly topGearFloor: number
  readonly topGearCeiling: number
}

export interface GearboxTone {
  readonly gear: number
  readonly gearCount: number
  readonly revRatio: number
  readonly frequency: number
  readonly load: number
  readonly shift: 'none' | 'up' | 'down'
}

const GEARBOX_PROFILES = {
  yellow: {
    gears: 5,
    growth: 1.08,
    idle: 54,
    sweep: 104,
    topGearFloor: 0.3,
    topGearCeiling: 0.48,
  },
  blue: {
    gears: 6,
    growth: 1.065,
    idle: 58,
    sweep: 116,
    topGearFloor: 0.31,
    topGearCeiling: 0.5,
  },
  green: {
    gears: 7,
    growth: 1.05,
    idle: 62,
    sweep: 124,
    topGearFloor: 0.32,
    topGearCeiling: 0.52,
  },
  red: {
    gears: 8,
    growth: 1.04,
    idle: 68,
    sweep: 138,
    topGearFloor: 0.33,
    topGearCeiling: 0.54,
  },
} as const satisfies Record<CarId, GearboxProfile>

const UPSHIFT_HYSTERESIS = 0.012
const DOWNSHIFT_HYSTERESIS = 0.018
const LOAD_DOWNSHIFT_OFFSET = 0.12

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function gearboxBoundaries(car: CarId): readonly number[] {
  const profile = GEARBOX_PROFILES[car]
  const weights = Array.from(
    { length: profile.gears },
    (_, index) => profile.growth ** index,
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const boundaries = [0]
  let cumulative = 0
  for (const weight of weights) {
    cumulative += weight
    boundaries.push(cumulative / total)
  }
  boundaries[boundaries.length - 1] = 1
  return boundaries
}

function naturalGear(
  boundaries: readonly number[],
  speedRatio: number,
): number {
  const finalGear = boundaries.length - 2
  if (speedRatio >= 1) return finalGear
  const boundaryIndex = boundaries.findIndex(
    (boundary, index) => index > 0 && speedRatio < boundary,
  )
  return clamp(
    boundaryIndex < 0 ? finalGear : boundaryIndex - 1,
    0,
    finalGear,
  )
}

export function calculateGearboxTone(
  car: CarId,
  speedRatio: number,
  throttle: number,
  previousGear?: number,
  cornering = 0,
): GearboxTone {
  const profile = GEARBOX_PROFILES[car]
  const boundaries = gearboxBoundaries(car)
  const speed = clamp(
    Number.isFinite(speedRatio) ? speedRatio : 0,
    0,
    1,
  )
  const prior =
    previousGear === undefined || !Number.isFinite(previousGear)
      ? undefined
      : Math.round(clamp(previousGear, 0, profile.gears - 1))
  const clampedThrottle = clamp(
    Number.isFinite(throttle) ? throttle : 0,
    0,
    1,
  )
  const corneringLoad = clamp(
    Number.isFinite(cornering) ? Math.abs(cornering) : 0,
    0,
    1,
  )
  const shiftLoad = Math.max(1 - clampedThrottle, corneringLoad)
  const shiftSpeed = clamp(
    speed - shiftLoad * LOAD_DOWNSHIFT_OFFSET,
    0,
    1,
  )
  let gear = naturalGear(boundaries, shiftSpeed)
  if (prior !== undefined) {
    const lower = boundaries[prior] ?? 0
    const upper = boundaries[prior + 1] ?? 1
    if (
      shiftSpeed >= lower - DOWNSHIFT_HYSTERESIS &&
      shiftSpeed <= upper + UPSHIFT_HYSTERESIS
    ) {
      gear = prior
    }
  }

  const lower = boundaries[gear] ?? 0
  const upper = boundaries[gear + 1] ?? 1
  const revRatio = clamp((speed - lower) / Math.max(0.000_001, upper - lower), 0, 1)
  // Top gear is an overdrive: it cruises in a deliberately low RPM band while
  // the lower gears retain their full audible sweep.
  const audibleRevRatio =
    gear === profile.gears - 1
      ? profile.topGearFloor +
        revRatio * (profile.topGearCeiling - profile.topGearFloor)
      : 0.28 + revRatio * 0.72

  return {
    gear,
    gearCount: profile.gears,
    revRatio,
    frequency: profile.idle + profile.sweep * audibleRevRatio,
    load: 0.22 + clampedThrottle * 0.78,
    shift:
      prior === undefined || prior === gear
        ? 'none'
        : gear > prior
          ? 'up'
          : 'down',
  }
}
