import type { Vector2 } from '@/domain/model'
import {
  VEHICLE_DYNAMICS_TUNING,
  type VehicleDynamicsTuning,
} from '@/domain/race/vehiclePhysicsConfig'

export interface VehicleDynamicsState {
  readonly angle: number
  readonly vx: number
  readonly vy: number
  readonly yawRate: number
}

export interface VehicleDynamicsControl {
  readonly steering: number
  readonly throttle: number
  readonly braking: boolean
}

export interface VehicleDynamicsParameters {
  readonly mass: number
  readonly wheelbase: number
  readonly centerOfMassHeight: number
  readonly yawInertia: number
  readonly frontWeightBias: number
  readonly cornerStiffness: number
  readonly brakeForce: number
  readonly recovery: number
  /** Speed target for drive and drag, which can change at terrain boundaries. */
  readonly maxSpeed: number
  /** Separate numerical limit before the integration headroom is applied. */
  readonly safetySpeed?: number
  readonly engineAcceleration: number
  readonly maxSteerAngle: number
  readonly grip: number
  readonly brakeGrip: number
  readonly rollingResistance: number
  readonly aerodynamicResistance: number
}

export interface VehicleDynamicsEnvironment {
  /** Signed road angle along `roadTangent`, in radians. */
  readonly grade: number
  readonly roadTangent: Vector2
  /** Normalized tire load. Zero means the car is airborne. */
  readonly contactLoad: number
}

export interface VehicleDynamicsResult extends VehicleDynamicsState {
  readonly speed: number
  readonly lateralSpeed: number
  readonly longitudinalSpeed: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteOr(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function softLimit(value: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.tanh(value / limit) * limit
}

/**
 * Integrates a dynamic bicycle model in body-local coordinates.
 *
 * Tire forces are shared with braking through a friction-circle budget.
 * Braking load transfer therefore reduces rear cornering authority naturally
 * instead of deleting lateral velocity with an artificial damping term.
 */
export function stepVehicleDynamics(
  state: VehicleDynamicsState,
  control: VehicleDynamicsControl,
  parameters: VehicleDynamicsParameters,
  environment: VehicleDynamicsEnvironment,
  deltaSeconds: number,
  tuning: VehicleDynamicsTuning = VEHICLE_DYNAMICS_TUNING,
): VehicleDynamicsResult {
  const dt = clamp(
    finiteOr(deltaSeconds),
    0,
    Math.max(0, tuning.integration.maximumDeltaSeconds),
  )
  const angle = finiteOr(state.angle)
  const headingX = Math.cos(angle)
  const headingY = Math.sin(angle)
  const longitudinal =
    finiteOr(state.vx) * headingX + finiteOr(state.vy) * headingY
  const lateral =
    -finiteOr(state.vx) * headingY + finiteOr(state.vy) * headingX
  const yawRate = finiteOr(state.yawRate)
  const maxSpeed = Math.max(1, parameters.maxSpeed)
  const speedRatio = clamp(
    Math.abs(longitudinal) / maxSpeed,
    0,
    Math.max(1, tuning.integration.maximumSpeedFactor),
  )
  const throttle = clamp(finiteOr(control.throttle), 0, 1)
  const steeringInput = clamp(finiteOr(control.steering), -1, 1)
  const contactLoad = clamp(
    finiteOr(environment.contactLoad, 1),
    0,
    tuning.forces.maximumContactLoad,
  )
  const longitudinalGripAcceleration =
    tuning.forces.gravityAcceleration *
    Math.max(tuning.forces.minimumGrip, parameters.grip) *
    contactLoad
  const lateralGripAcceleration =
    longitudinalGripAcceleration *
    Math.max(0, tuning.forces.lateralGripScale)

  // Engine force is expressed against a common reference mass so a physically
  // heavier car carries more inertia instead of receiving free acceleration.
  const driveAcceleration =
    parameters.engineAcceleration *
    (tuning.forces.referenceMass / Math.max(1, parameters.mass)) *
    throttle *
    contactLoad *
    Math.max(0, 1 - speedRatio * speedRatio)
  const requestedBrakeAcceleration = control.braking
    ? (parameters.brakeForce / Math.max(1, parameters.mass)) *
      parameters.brakeGrip
      * contactLoad
    : 0
  const brakeAcceleration = Math.min(
    requestedBrakeAcceleration,
    longitudinalGripAcceleration * tuning.forces.brakeGripUsage,
  )
  const direction =
    longitudinal > tuning.integration.directionDeadzone
      ? 1
      : longitudinal < -tuning.integration.directionDeadzone
        ? -1
        : 0
  const rollingAcceleration =
    parameters.rollingResistance * direction * contactLoad
  const aerodynamicAcceleration =
    parameters.aerodynamicResistance *
    speedRatio *
    speedRatio *
    direction
  const tangentLength = Math.max(
    0.000_1,
    Math.hypot(environment.roadTangent.x, environment.roadTangent.y),
  )
  const gradeAlignment =
    (headingX * environment.roadTangent.x +
      headingY * environment.roadTangent.y) /
    tangentLength
  const gravityAcceleration =
    -tuning.forces.gravityAcceleration *
    Math.sin(
      clamp(
        finiteOr(environment.grade),
        -tuning.forces.maximumGrade,
        tuning.forces.maximumGrade,
      ),
    ) *
    gradeAlignment *
    contactLoad
  const longitudinalAcceleration =
    driveAcceleration -
    brakeAcceleration * direction -
    rollingAcceleration -
    aerodynamicAcceleration +
    gravityAcceleration

  const weightTransfer =
    (-longitudinalAcceleration * parameters.centerOfMassHeight) /
    (Math.max(1, parameters.wheelbase) *
      Math.max(0.001, tuning.forces.gravityAcceleration))
  const frontLoad = clamp(
    parameters.frontWeightBias + weightTransfer,
    tuning.loadTransfer.minimumFrontLoad,
    tuning.loadTransfer.maximumFrontLoad,
  )
  const rearLoad = 1 - frontLoad
  const brakeUsage = clamp(
    brakeAcceleration / Math.max(0.001, longitudinalGripAcceleration),
    0,
    tuning.forces.maximumBrakeUsage,
  )
  const lateralBudget = Math.sqrt(
    Math.max(
      tuning.forces.minimumLateralBudget,
      1 - brakeUsage * brakeUsage,
    ),
  )
  const frontCapacity =
    lateralGripAcceleration * frontLoad * lateralBudget
  const rearCapacity =
    lateralGripAcceleration * rearLoad * lateralBudget

  const speedSteeringScale =
    1 -
    clamp(speedRatio, 0, 1) *
      clamp(tuning.steering.highSpeedReduction, 0, 1)
  const steerAngle =
    steeringInput * parameters.maxSteerAngle * speedSteeringScale
  const frontAxle = parameters.wheelbase * (1 - parameters.frontWeightBias)
  const rearAxle = parameters.wheelbase * parameters.frontWeightBias
  const tireSpeed = Math.max(
    tuning.steering.minimumTireSpeed,
    Math.abs(longitudinal),
  )
  const frontSlip =
    Math.atan2(lateral + frontAxle * yawRate, tireSpeed) - steerAngle
  const rearSlip = Math.atan2(
    lateral - rearAxle * yawRate,
    tireSpeed,
  )
  const tireResponse = clamp(
    Math.abs(longitudinal) /
      Math.max(0.001, tuning.steering.fullTireResponseSpeed),
    0,
    1,
  )
  const frontLateralAcceleration =
    softLimit(
      -frontSlip *
        parameters.cornerStiffness *
        lateralGripAcceleration *
        frontLoad,
      frontCapacity,
    ) * tireResponse
  const rearLateralAcceleration =
    softLimit(
      -rearSlip *
        parameters.cornerStiffness *
        lateralGripAcceleration *
        rearLoad,
      rearCapacity,
    ) * tireResponse
  const lateralAcceleration =
    frontLateralAcceleration + rearLateralAcceleration
  const tireYawAcceleration =
    (parameters.mass *
      (frontAxle * frontLateralAcceleration * Math.cos(steerAngle) -
        rearAxle * rearLateralAcceleration)) /
    Math.max(1, parameters.yawInertia)
  const recoveryDamping =
    parameters.recovery *
    (tuning.stability.yawNeutralInfluence +
      tuning.stability.yawSteeringInfluence *
        (1 - Math.abs(steeringInput))) *
    contactLoad
  const yawAcceleration =
    tireYawAcceleration - yawRate * recoveryDamping

  const maximumYawRate = Math.max(0, tuning.integration.maximumYawRate)
  const nextYawRate = clamp(
    yawRate + yawAcceleration * dt,
    -maximumYawRate,
    maximumYawRate,
  )
  let nextLongitudinal =
    longitudinal +
    (longitudinalAcceleration + nextYawRate * lateral) * dt
  let nextLateral =
    lateral +
    (lateralAcceleration - nextYawRate * longitudinal) * dt
  if (nextLongitudinal < 0) nextLongitudinal = 0
  nextLongitudinal = Math.min(
    nextLongitudinal,
    Math.max(1, parameters.safetySpeed ?? maxSpeed) *
      Math.max(1, tuning.integration.maximumSpeedFactor),
  )

  // Below tire-operating speed, settle residual motion without affecting
  // normal cornering or erasing a high-speed slide.
  const steeringStability =
    1 -
    Math.abs(steeringInput) *
      (1 - clamp(tuning.stability.steeringRetention, 0, 1))
  const brakingStability = control.braking
    ? clamp(tuning.stability.brakingRetention, 0, 1)
    : 1
  const lateralStability =
    Math.max(0, tuning.stability.lateralDamping) *
    steeringStability *
    brakingStability *
    tireResponse *
    contactLoad
  nextLateral *= Math.exp(-lateralStability * dt)

  const lowSpeedSettling =
    (1 - tireResponse) *
    Math.max(0, tuning.stability.lowSpeedSettling) *
    contactLoad
  nextLateral *= Math.exp(-lowSpeedSettling * dt)
  const nextAngle = angle + nextYawRate * dt
  const nextHeadingX = Math.cos(nextAngle)
  const nextHeadingY = Math.sin(nextAngle)
  const vx =
    nextHeadingX * nextLongitudinal - nextHeadingY * nextLateral
  const vy =
    nextHeadingY * nextLongitudinal + nextHeadingX * nextLateral

  return {
    angle: nextAngle,
    vx,
    vy,
    yawRate: nextYawRate,
    speed: Math.hypot(vx, vy),
    lateralSpeed: nextLateral,
    longitudinalSpeed: nextLongitudinal,
  }
}
