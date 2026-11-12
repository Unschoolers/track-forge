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
 * - `recovery`: changes how quickly one car settles yaw rotation.
 * - Surface and terrain `grip` values multiply the car and global grip.
 *
 * Keep related changes small and run:
 * `npm run test -- tests/domain/vehicleDynamics.test.ts`
 */

/**
 * Shared model constants. Tune these first when changing the overall handling
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
  readonly damage: {
    readonly maximumSpeedLoss: number
    readonly maximumAccelerationLoss: number
    readonly maximumGripLoss: number
  }
}

export interface CarPhysicsSpec {
  readonly max: number
  readonly accel: number
  readonly steer: number
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
}

export interface VerticalDynamicsTuning {
  readonly maximumDeltaSeconds: number
  readonly maximumGrade: number
  readonly gravity: number
  readonly suspensionTravel: number
  readonly suspensionResponse: number
  readonly takeoffVelocityThreshold: number
  readonly maximumLaunchVelocity: number
  readonly landingVelocityScale: number
  readonly landingDecay: number
  readonly bridgeWallHeight: number
  readonly crestDropForFullLaunch: number
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
    lateralGripScale: 2.55,
    brakeGripUsage: 0.92,
    minimumLateralBudget: 0.04,
    minimumGrip: 0.08,
    maximumBrakeUsage: 0.98,
    maximumContactLoad: 1.35,
    maximumGrade: 0.6,
  },
  steering: {
    maximumAngleScale: 0.18,
    highSpeedReduction: 0.48,
    minimumTireSpeed: 12,
    fullTireResponseSpeed: 26,
  },
  stability: {
    lateralDamping: 7.2,
    steeringRetention: 0.58,
    brakingRetention: 0.34,
    lowSpeedSettling: 5.5,
    yawSteeringInfluence: 0.62,
    yawNeutralInfluence: 0.38,
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
  damage: {
    maximumSpeedLoss: 0.07,
    maximumAccelerationLoss: 0.09,
    maximumGripLoss: 0.035,
  },
} as const satisfies VehicleDynamicsTuning

// Arcade uses the same deterministic bicycle integrator with a forgiving
// grip and steering profile; the existing profile remains Simulation mode.
export const ARCADE_DYNAMICS_TUNING: VehicleDynamicsTuning = {
  ...VEHICLE_DYNAMICS_TUNING,
  forces: {
    ...VEHICLE_DYNAMICS_TUNING.forces,
    lateralGripScale: 3.1,
  },
  steering: {
    ...VEHICLE_DYNAMICS_TUNING.steering,
    maximumAngleScale: 0.235,
    highSpeedReduction: 0.31,
  },
  stability: {
    ...VEHICLE_DYNAMICS_TUNING.stability,
    lateralDamping: 9.6,
    steeringRetention: 0.76,
    brakingRetention: 0.28,
    yawNeutralInfluence: 0.56,
  },
}

export const CAR_PHYSICS_SPECS = {
  blue: {
    max: 306,
    accel: 222,
    steer: 2.72,
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
    recovery: 1.5,
  },
  red: {
    max: 310,
    accel: 205,
    steer: 2.28,
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
    recovery: 1.25,
  },
  green: {
    max: 294,
    accel: 214,
    steer: 3,
    grip: 1.14,
    brake: 1.04,
    steerLoss: 0.044,
    mass: 1190,
    wheelbase: 24,
    centerOfMassHeight: 4.7,
    yawInertia: 175_000,
    frontWeightBias: 0.54,
    cornerStiffness: 9.5,
    brakeForce: 125_000,
    recovery: 1.8,
  },
  yellow: {
    max: 286,
    accel: 202,
    steer: 2.34,
    grip: 1.24,
    brake: 1.2,
    steerLoss: 0.061,
    mass: 1510,
    wheelbase: 29,
    centerOfMassHeight: 6,
    yawInertia: 340_000,
    frontWeightBias: 0.57,
    cornerStiffness: 8.7,
    brakeForce: 165_000,
    recovery: 1.65,
  },
} as const satisfies Record<CarId, CarPhysicsSpec>

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
    street: DEFAULT_TERRAIN,
    dirt: { max: 0.78, accel: 0.68, grip: 0.78, brake: 0.8, drag: 1.55 },
    ice: { max: 0.95, accel: 0.84, grip: 0.76, brake: 0.78, drag: 1.2 },
    grass: { max: 0.56, accel: 0.45, grip: 0.62, brake: 0.72, drag: 2.15 },
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
  gravity: 96,
  suspensionTravel: 0.85,
  suspensionResponse: 15,
  takeoffVelocityThreshold: 9.5,
  maximumLaunchVelocity: 42,
  landingVelocityScale: 0.045,
  landingDecay: 6,
  bridgeWallHeight: 3.2,
  crestDropForFullLaunch: 0.12,
  suspensionGradeScale: 12,
  suspensionContactScale: 0.35,
  landingContactScale: 0.35,
  minimumContactLoad: 0.55,
  maximumContactLoad: 1.35,
} as const satisfies VerticalDynamicsTuning
