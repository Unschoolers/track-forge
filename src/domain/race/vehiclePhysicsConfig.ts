import type { CarId, SurfaceId } from '@/domain/model'

/**
 * Quick handling guide:
 *
 * - `stability.lateralDamping`: raise for a more planted car; lower for slides.
 * - `stability.steeringRetention`: lower to let the rear rotate more while
 *   steering without making straight-line recovery loose.
 * - `stability.brakingRetention`: lower for longer braking drifts.
 * - `forces.lateralGripScale`: raises the tire-force ceiling for every car.
 * - `cornerStiffness`: changes how quickly one car builds tire force.
 * - `lateralStability`: stabilizes the car body primarily on grippy pavement.
 * - `recovery`: changes how quickly one car settles yaw rotation.
 * - Surface and terrain `grip` values multiply the car and global grip.
 *
 * Keep related changes small and run:
 * `npm run test -- tests/domain/vehicleDynamics.test.ts`
 */

/**
 * Single production Arcade physics profile, independent of race rules.
 * Tune these first when changing the overall handling
 * character; car and surface records below should express relative identity.
 */
export interface VehicleDynamicsTuning {
  readonly integration: {
    readonly maximumDeltaSeconds: number
    readonly maximumYawRate: number
    readonly maximumSpeedFactor: number
    readonly directionDeadzone: number
  }
  readonly forces: {
    readonly gravityAcceleration: number
    readonly referenceMass: number
    readonly lateralGripScale: number
    readonly brakeGripUsage: number
    /** Modest straight-line service brake traction gain without altering corner grip. */
    readonly brakingTractionScale: number
    readonly minimumLateralBudget: number
    readonly minimumGrip: number
    readonly maximumBrakeUsage: number
    readonly maximumContactLoad: number
    readonly maximumGrade: number
  }
  readonly steering: {
    readonly maximumAngleScale: number
    readonly highSpeedReduction: number
    readonly minimumTireSpeed: number
    readonly fullTireResponseSpeed: number
    /** Extra tire authority below full response speed; 0 preserves the linear curve. */
    readonly lowSpeedResponseGain: number
  }
  readonly stability: {
    /** Settles body slip after steering release without snapping the heading. */
    readonly lateralDamping: number
    /** Fraction of stability retained at full steering lock. */
    readonly steeringRetention: number
    /** Fraction of stability retained while braking to preserve trail-braking. */
    readonly brakingRetention: number
    readonly lowSpeedSettling: number
    readonly yawSteeringInfluence: number
    readonly yawNeutralInfluence: number
  }
  readonly loadTransfer: {
    readonly minimumFrontLoad: number
    readonly maximumFrontLoad: number
  }
  readonly resistance: {
    readonly roadRolling: number
    readonly offroadRolling: number
    readonly aerodynamicBase: number
    readonly steeringDragScale: number
  }
}

export interface CarPhysicsSpec {
  readonly max: number
  readonly accel: number
  /** Original steering rack scale, retained for high-speed authority and AI planning. */
  readonly steer: number
  /** Optional low-speed steering limit, in radians. */
  readonly lowSpeedSteerAngle?: number
  readonly grip: number
  readonly brake: number
  readonly steerLoss: number
  readonly mass: number
  readonly wheelbase: number
  readonly centerOfMassHeight: number
  readonly yawInertia: number
  readonly frontWeightBias: number
  readonly cornerStiffness: number
  readonly brakeForce: number
  /** Additional braking traction relative to other cars. */
  readonly brakingTractionScale: number
  /** Additional longitudinal brake force on paved roads only. */
  readonly pavementBrakeMultiplier?: number
  /** Additional longitudinal brake force on ice only. */
  readonly iceBrakeMultiplier?: number
  /** Planted lateral behavior per chassis; road grip blends it out on loose surfaces. */
  readonly lateralStability: number
  readonly recovery: number
}

export interface SurfacePhysicsSpec {
  readonly max: number
  readonly accel: number
  readonly grip: number
  readonly brake: number
}

export interface TerrainPhysicsModifier extends SurfacePhysicsSpec {
  readonly drag: number
  /** Extra grip at high speed, applied progressively from 170 to 210 units/s. */
  readonly highSpeedGrip?: number
  /** Arcade lateral reserve during very slow braking turns. */
  readonly lowSpeedBrakeCornerReserve?: number
}

export interface VerticalDynamicsTuning {
  readonly maximumDeltaSeconds: number
  readonly maximumGrade: number
  readonly gravity: number
  readonly suspensionTravel: number
  readonly suspensionResponse: number
  readonly landingVelocityScale: number
  readonly landingDecay: number
  readonly bridgeWallHeight: number
  readonly suspensionGradeScale: number
  readonly suspensionContactScale: number
  readonly landingContactScale: number
  readonly minimumContactLoad: number
  readonly maximumContactLoad: number
}

export const VEHICLE_DYNAMICS_TUNING = {
  integration: {
    maximumDeltaSeconds: 0.05,
    maximumYawRate: 2.4,
    maximumSpeedFactor: 1.2,
    directionDeadzone: 0.5,
  },
  forces: {
    gravityAcceleration: 96,
    referenceMass: 1_250,
    // TrackForge compresses real corner radii into a small top-down playfield.
    // Lateral authority therefore needs an arcade scale above physical 1g.
    lateralGripScale: 3.1,
    brakeGripUsage: 0.92,
    brakingTractionScale: 1.12,
    minimumLateralBudget: 0.04,
    minimumGrip: 0.08,
    maximumBrakeUsage: 0.98,
    maximumContactLoad: 1.35,
    maximumGrade: 0.6,
  },
  steering: {
    maximumAngleScale: 0.235,
    highSpeedReduction: 0.31,
    minimumTireSpeed: 12,
    fullTireResponseSpeed: 26,
    lowSpeedResponseGain: 1,
  },
  stability: {
    lateralDamping: 9.6,
    steeringRetention: 0.76,
    brakingRetention: 0.28,
    lowSpeedSettling: 5.5,
    yawSteeringInfluence: 0.62,
    yawNeutralInfluence: 0.56,
  },
  loadTransfer: {
    minimumFrontLoad: 0.34,
    maximumFrontLoad: 0.76,
  },
  resistance: {
    roadRolling: 1.15,
    offroadRolling: 7.5,
    aerodynamicBase: 8.5,
    steeringDragScale: 22,
  },
} as const satisfies VehicleDynamicsTuning

/** Lateral tire response multipliers at 0, 15, 45 and 100 simulation units/s.
 * The response returns to stock at 170. Applied only during simultaneous
 * braking and steering; these are arcade calibration factors, not wheel angles.
 */
export type BrakeCornerResponse = readonly [number, number, number, number]

export const BRAKE_CORNER_RESPONSE = {
  red: {
    street: [0.1, 1.125, 0.95, 1],
    dirt: [0.9, 1.025, 0.975, 1],
    ice: [1.175, 1.225, 1, 1],
  },
  blue: {
    street: [0.325, 0.9, 1, 1.025],
    dirt: [0.75, 1, 0.975, 1.025],
    ice: [1.1, 1.425, 0.875, 1.05],
  },
  green: {
    street: [0.195, 0.975, 1.075, 0.95],
    dirt: [0.485, 0.68, 1.175, 0.925],
    ice: [0.99, 1.24, 0.95, 1.025],
  },
  yellow: {
    street: [0.145, 1.2, 1.65, 1.4],
    dirt: [0.245, 0.95, 1.675, 1.525],
    ice: [0.98, 1.75, 2.9, 3.8],
  },
} as const satisfies Record<CarId, Record<SurfaceId, BrakeCornerResponse>>

const BRAKE_CORNER_RESPONSE_SPEED = {
  low: 15, medium: 45, high: 100, stock: 170,
} as const

export function brakeCornerResponseAtSpeed(response: BrakeCornerResponse, speed: number): number {
  const [crawl, low, medium, high] = response
  const limits = BRAKE_CORNER_RESPONSE_SPEED
  const blend = (from: number, to: number, fraction: number) => from + (to - from) * fraction
  const v = Math.max(0, speed)
  if (v < limits.low) return blend(crawl, low, v / limits.low)
  if (v < limits.medium) return blend(low, medium, (v - limits.low) / (limits.medium - limits.low))
  if (v < limits.high) return blend(medium, high, (v - limits.medium) / (limits.high - limits.medium))
  if (v < limits.stock) return blend(high, 1, (v - limits.high) / (limits.stock - limits.high))
  return 1
}

export const LOW_SPEED_BRAKE_CORNER = { fullReserveSpeed: 30, fadeOutSpeed: 60 } as const

export const ARCADE_BRAKE_TIMING = { pressSeconds: 0.15, releaseSeconds: 0.1 } as const

const LOW_SPEED_STEERING_ANGLE = 40 * Math.PI / 180

/** Blend low-speed lock into the unchanged original high-speed limit. */
export function steeringLimitAtSpeed(
  baseAngle: number,
  speedRatio: number,
  highSpeedReduction: number,
  lowSpeedAngle = baseAngle,
): number {
  const ratio = Math.max(0, Math.min(1, speedRatio))
  const reduction = Math.max(0, Math.min(1, highSpeedReduction))
  return baseAngle * (1 - ratio * reduction) + (lowSpeedAngle - baseAngle) * Math.max(0, 1 - ratio / 0.35)
}

export const CAR_PHYSICS_SPECS = {
  blue: {
    max: 306,
    accel: 222,
    steer: 2.72,
    lowSpeedSteerAngle: LOW_SPEED_STEERING_ANGLE,
    grip: 1,
    brake: 1,
    steerLoss: 0.057,
    mass: 1280,
    wheelbase: 26,
    centerOfMassHeight: 5,
    yawInertia: 230_000,
    frontWeightBias: 0.55,
    cornerStiffness: 8.6,
    brakeForce: 132_000,
    brakingTractionScale: 1,
    iceBrakeMultiplier: 1.7824,
    lateralStability: 1.2,
    recovery: 1.5,
  },
  red: {
    // High-speed pavement specialist: visibly quicker than Blue on a straight.
    max: 337,
    accel: 230,
    steer: 2.28,
    lowSpeedSteerAngle: LOW_SPEED_STEERING_ANGLE,
    grip: 0.79,
    brake: 0.83,
    steerLoss: 0.118,
    mass: 1240,
    wheelbase: 25,
    centerOfMassHeight: 5.4,
    yawInertia: 200_000,
    frontWeightBias: 0.53,
    cornerStiffness: 7.4,
    brakeForce: 112_000,
    // Race-grade service brakes without granting Red more cornering grip.
    brakingTractionScale: 1.38,
    pavementBrakeMultiplier: 1.5,
    // Preserve the 250-unit ice stopping target with the improved ice grip.
    iceBrakeMultiplier: 1.5268,
    lateralStability: 0.9,
    recovery: 1.25,
  },
  green: {
    max: 294,
    accel: 214,
    steer: 3.2,
    grip: 1.14,
    brake: 1.04,
    steerLoss: 0.044,
    mass: 1190,
    wheelbase: 24,
    centerOfMassHeight: 4.7,
    yawInertia: 132_000,
    frontWeightBias: 0.54,
    cornerStiffness: 9.5,
    brakeForce: 125_000,
    brakingTractionScale: 1,
    iceBrakeMultiplier: 1.5826,
    lateralStability: 3,
    recovery: 1.8,
  },
  yellow: {
    max: 286,
    accel: 202,
    steer: 2.46,
    lowSpeedSteerAngle: LOW_SPEED_STEERING_ANGLE,
    grip: 1.24,
    brake: 1.2,
    steerLoss: 0.061,
    mass: 1510,
    wheelbase: 29,
    centerOfMassHeight: 6,
    yawInertia: 270_000,
    frontWeightBias: 0.57,
    cornerStiffness: 8.7,
    brakeForce: 165_000,
    brakingTractionScale: 1,
    iceBrakeMultiplier: 2.4924,
    lateralStability: 4.5,
    recovery: 1.65,
  },
} as const satisfies Record<CarId, CarPhysicsSpec>

/** Shared traction scale for actual braking and AI stopping-distance prediction. */
export function brakingTractionForSurface(car: CarPhysicsSpec, surface: SurfaceId | 'grass'): number {
  const multiplier = surface === 'street' ? car.pavementBrakeMultiplier
    : surface === 'ice' ? car.iceBrakeMultiplier : undefined
  return car.brakingTractionScale * (multiplier ?? 1)
}

export const SURFACE_PHYSICS_SPECS = {
  street: { max: 1, accel: 1, grip: 1, brake: 1 },
  dirt: { max: 0.79, accel: 0.82, grip: 0.73, brake: 0.74 },
  ice: { max: 0.9, accel: 0.9, grip: 0.34, brake: 0.53 },
  grass: { max: 0.58, accel: 0.46, grip: 0.61, brake: 0.82 },
} as const satisfies Record<SurfaceId | 'grass', SurfacePhysicsSpec>

const DEFAULT_TERRAIN: TerrainPhysicsModifier = {
  max: 1,
  accel: 1,
  grip: 1,
  brake: 1,
  drag: 1,
}

export const VEHICLE_TERRAIN_PHYSICS_SPECS = {
  blue: {
    street: DEFAULT_TERRAIN,
    dirt: DEFAULT_TERRAIN,
    ice: DEFAULT_TERRAIN,
    grass: DEFAULT_TERRAIN,
  },
  red: {
    street: { ...DEFAULT_TERRAIN, highSpeedGrip: 1.18 },
    dirt: { max: 0.78, accel: 0.68, grip: 0.78, brake: 0.75, drag: 1.55 },
    ice: { max: 0.95, accel: 0.84, grip: 1, brake: 0.78, drag: 1.2, lowSpeedBrakeCornerReserve: 0.1 },
    // Keep the low grass speed target but let Red recover from a mistake sooner.
    grass: { max: 0.51, accel: 0.7, grip: 0.57, brake: 0.72, drag: 1.6 },
  },
  green: {
    street: DEFAULT_TERRAIN,
    dirt: { max: 1.04, accel: 1.06, grip: 1.12, brake: 1.08, drag: 0.9 },
    ice: { max: 1, accel: 1, grip: 1.18, brake: 1.15, drag: 0.95 },
    grass: { max: 1.05, accel: 1.08, grip: 1.15, brake: 1.05, drag: 0.88 },
  },
  yellow: {
    street: DEFAULT_TERRAIN,
    dirt: { max: 1.19, accel: 1.15, grip: 1.22, brake: 1.18, drag: 0.72 },
    ice: { max: 0.95, accel: 0.9, grip: 0.92, brake: 0.98, drag: 1.05 },
    grass: { max: 1.38, accel: 1.3, grip: 1.28, brake: 1.18, drag: 0.68 },
  },
} as const satisfies Record<
  CarId,
  Record<SurfaceId | 'grass', TerrainPhysicsModifier>
>

export const VERTICAL_DYNAMICS = {
  maximumDeltaSeconds: 0.05,
  maximumGrade: 0.6,
  gravity: 200,
  suspensionTravel: 0.85,
  suspensionResponse: 15,
  landingVelocityScale: 0.032,
  landingDecay: 9,
  bridgeWallHeight: 3.2,
  suspensionGradeScale: 12,
  suspensionContactScale: 0.35,
  landingContactScale: 0.35,
  minimumContactLoad: 0.55,
  maximumContactLoad: 1.35,
} as const satisfies VerticalDynamicsTuning
