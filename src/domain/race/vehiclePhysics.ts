import {
  CAR_SPECS,
  OFFROAD_SURFACE,
  SURFACE_SPECS,
  VEHICLE_TERRAIN_SPECS,
} from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { SurfaceId } from '@/domain/model'
import type { VehicleStepContext } from '@/domain/race/trackContext'
import type { DriverInput, RaceVehicle } from '@/domain/race/raceState'
import { stepVehicleDynamics } from '@/domain/race/vehicleDynamics'
import type { DriftBoostRules } from '@/domain/race/driftBoost'
import {
  ARCADE_BRAKE_TIMING,
  BRAKE_CORNER_RESPONSE,
  type CarPhysicsSpec,
  type TerrainPhysicsModifier,
  brakingTractionForSurface,
  VEHICLE_DYNAMICS_TUNING,
} from '@/domain/race/vehiclePhysicsConfig'

// An exponential response reaches about 95% of the new grip in 0.15 s.
const SURFACE_GRIP_TIME_CONSTANT = 0.05

/** Initial arcade practice tuning; ordinary race handling stays unchanged. */
export const BRAKE_TAP_DRIFT_TUNING = {
  maximumTapSeconds: 0.22,
  minimumForwardSpeed: 110,
  minimumSteering: 0.35,
  assistSeconds: 0.8,
  rearGripScale: 0.2,
  lateralStabilityScale: 0.03,
  yawRate: 2.1,
  targetSlipRadians: 25 * Math.PI / 180,
} as const

export interface SpeedAssist {
  readonly multiplier: number
  readonly ceiling: number
}

function getSurfaceSpec(surface: SurfaceId | 'grass') {
  return surface === 'grass' ? OFFROAD_SURFACE : SURFACE_SPECS[surface]
}

export function stepVehicle(
  vehicle: RaceVehicle,
  input: DriverInput,
  context: VehicleStepContext,
  deltaSeconds: number,
  speedLimit = Number.POSITIVE_INFINITY,
  speedAssist?: SpeedAssist,
  boost?: { readonly rules: DriftBoostRules; readonly activated: boolean; readonly active: boolean; readonly speedCeilingMultiplier: number },
): RaceVehicle {
  if (vehicle.finishedAt !== null) {
    return {
      ...vehicle,
      vx: 0,
      vy: 0,
      speed: 0,
      yawRate: 0,
      braking: false,
    }
  }
  const dt = clamp(
    deltaSeconds,
    0,
    VEHICLE_DYNAMICS_TUNING.integration.maximumDeltaSeconds,
  )
  const humanDriver = vehicle.player
  const driverPressure = humanDriver
    ? clamp(
        (vehicle.brakePressure ?? 0) + (input.braking
          ? dt / ARCADE_BRAKE_TIMING.pressSeconds
          : -dt / ARCADE_BRAKE_TIMING.releaseSeconds),
        0,
        1,
      )
    : clamp(input.brakePressure ?? Number(input.braking), 0, 1)
  const aiSpeedBrake = !vehicle.player && vehicle.speed > speedLimit
  const brakePressure = Math.max(driverPressure, Number(aiSpeedBrake))
  const car: CarPhysicsSpec = CAR_SPECS[vehicle.car]
  const surface = getSurfaceSpec(context.surface)
  const terrain: TerrainPhysicsModifier = VEHICLE_TERRAIN_SPECS[vehicle.car][context.surface]
  const physicsSpeedLimit = vehicle.player ? Number.POSITIVE_INFINITY : speedLimit
  const stockMaxSpeed = car.max * surface.max * terrain.max
  const boostCeiling = boost ? stockMaxSpeed * boost.speedCeilingMultiplier : stockMaxSpeed
  const assistedSpeed = speedAssist
    ? Math.max(stockMaxSpeed, Math.min(stockMaxSpeed * speedAssist.multiplier, speedAssist.ceiling))
    : boost?.active ? boostCeiling : stockMaxSpeed
  // Practice boost limits must not cap the existing AI catch-up assist.
  const engineSpeed = boost ? Math.min(boostCeiling, assistedSpeed) : assistedSpeed
  const maxSpeed = Math.min(physicsSpeedLimit, engineSpeed)
  let physicsVehicle = vehicle
  if (boost?.activated && !input.braking) {
    const headingX = Math.cos(vehicle.angle)
    const headingY = Math.sin(vehicle.angle)
    const longitudinal = vehicle.vx * headingX + vehicle.vy * headingY
    const lateral = -vehicle.vx * headingY + vehicle.vy * headingX
    const ceiling = stockMaxSpeed * boost.rules.speedCeilingMultiplier
    const boostedLongitudinal = Math.min(ceiling, Math.max(0, longitudinal) * boost.rules.initialSpeedMultiplier)
    physicsVehicle = {
      ...vehicle,
      vx: boostedLongitudinal * headingX - lateral * headingY,
      vy: boostedLongitudinal * headingY + lateral * headingX,
    }
  }
  const braking = input.braking || aiSpeedBrake
  const driftTuning = BRAKE_TAP_DRIFT_TUNING
  const driftAvailable = humanDriver && !!boost && !boost.active &&
    boost.speedCeilingMultiplier === 1 && !boost.activated &&
    vehicle.grounded && context.onRoad && context.surface !== 'grass'
  const headingX = driftAvailable ? Math.cos(vehicle.angle) : 0
  const headingY = driftAvailable ? Math.sin(vehicle.angle) : 0
  const forward = vehicle.vx * headingX + vehicle.vy * headingY
  const sideways = -vehicle.vx * headingY + vehicle.vy * headingX
  const slip = driftAvailable ? Math.atan2(sideways, forward) : 0
  const canDrift = driftAvailable && forward >= driftTuning.minimumForwardSpeed
  const previousTap = vehicle.driftTap
  const steeringDirection = Math.sign(input.steering)
  const turning = Math.abs(input.steering) >= driftTuning.minimumSteering
  // An invalid press stays invalid until release; never re-arm midway through
  // a held brake when the driver starts turning or returns to the road.
  const previousHeld = previousTap?.heldSeconds ?? 0
  const validPress = canDrift && turning &&
    (previousHeld === 0 || previousTap?.direction === steeringDirection)
  const heldSeconds = input.braking
    ? validPress
      ? Math.min(driftTuning.maximumTapSeconds + 1, previousHeld + dt)
      : driftTuning.maximumTapSeconds + 1
    : 0
  const tapReleased = canDrift && !input.braking && turning &&
    previousTap?.direction === steeringDirection &&
    previousHeld > 0 && previousHeld <= driftTuning.maximumTapSeconds + 1e-9
  const assistSeconds = !canDrift || input.braking || !turning ? 0
    : tapReleased ? driftTuning.assistSeconds
    : previousTap?.direction === steeringDirection
      ? Math.max(0, previousTap.assistSeconds - dt - 1e-9) : 0
  const assisting = assistSeconds > 0
  const tuning = VEHICLE_DYNAMICS_TUNING
  const extraGrip = 1 + ((terrain.highSpeedGrip ?? 1) - 1) * clamp((vehicle.speed - 170) / 40, 0, 1)
  const targetGrip = surface.grip * terrain.grip * extraGrip
  const previousGrip = vehicle.speed === 0
    ? targetGrip
    : vehicle.surfaceGrip ??
      getSurfaceSpec(vehicle.currentSurface).grip *
        VEHICLE_TERRAIN_SPECS[vehicle.car][vehicle.currentSurface].grip
  const surfaceGrip = context.surface !== vehicle.currentSurface && targetGrip > previousGrip ? targetGrip : targetGrip +
    (previousGrip - targetGrip) * Math.exp(-dt / SURFACE_GRIP_TIME_CONSTANT)
  const dynamics = stepVehicleDynamics(
    {
      angle: physicsVehicle.angle,
      vx: physicsVehicle.vx,
      vy: physicsVehicle.vy,
      yawRate: physicsVehicle.yawRate,
    },
    {
      ...input,
      throttle: braking ? 0 : input.throttle * (1 - driverPressure),
      braking,
      brakePressure,
    },
    {
      mass: car.mass,
      wheelbase: car.wheelbase,
      centerOfMassHeight: car.centerOfMassHeight,
      yawInertia: car.yawInertia,
      frontWeightBias: car.frontWeightBias,
      cornerStiffness: car.cornerStiffness,
      brakeForce: car.brakeForce,
      brakingTractionScale: brakingTractionForSurface(car, context.surface),
      lowSpeedBrakeCornerReserve: terrain.lowSpeedBrakeCornerReserve ?? 0,
      ...(context.surface === 'grass' ? {} : {
        brakeCornerResponse: BRAKE_CORNER_RESPONSE[vehicle.car][context.surface],
      }),
      recovery: car.recovery,
      // Strong stability is a dry-road trait, not an ice/gravel cheat.
      lateralStability: (1 + (car.lateralStability - 1) *
        Math.min(1, surfaceGrip * surfaceGrip)) *
        (assisting ? driftTuning.lateralStabilityScale : 1),
      ...(assisting ? {
        driftAssist: {
          rearGripScale: driftTuning.rearGripScale,
          // Stop adding yaw once the actual velocity/heading slip reaches the target.
          yawRate: -slip * steeringDirection < driftTuning.targetSlipRadians
            ? steeringDirection * driftTuning.yawRate : 0,
        },
      } : {}),
      maxSpeed,
      ...(boost ? { absoluteSpeedLimit: maxSpeed } : {}),
      ...(boost?.active ? { accelerationMultiplier: boost.rules.accelerationMultiplier } : {}),
      safetySpeed: Math.min(physicsSpeedLimit, car.max),
      engineAcceleration:
        car.accel *
        surface.accel *
        terrain.accel,
      maxSteerAngle:
        car.steer * tuning.steering.maximumAngleScale,
      ...(car.lowSpeedSteerAngle === undefined ? {} : { lowSpeedSteerAngle: car.lowSpeedSteerAngle }),
      grip:
        car.grip *
        surfaceGrip,
      brakeGrip: car.brake * surface.brake * terrain.brake,
      rollingResistance:
        (context.onRoad
          ? VEHICLE_DYNAMICS_TUNING.resistance.roadRolling
          : VEHICLE_DYNAMICS_TUNING.resistance.offroadRolling) * terrain.drag,
      aerodynamicResistance:
        (VEHICLE_DYNAMICS_TUNING.resistance.aerodynamicBase +
          Math.abs(input.steering) *
            car.steerLoss *
            VEHICLE_DYNAMICS_TUNING.resistance.steeringDragScale) *
        terrain.drag,
    },
    {
      grade: context.grade,
      roadTangent: context.tangent,
      contactLoad: vehicle.contactLoad,
    },
    dt,
    tuning,
  )
  return {
    ...vehicle,
    x: vehicle.x + dynamics.vx * dt,
    y: vehicle.y + dynamics.vy * dt,
    angle: dynamics.angle,
    vx: dynamics.vx,
    vy: dynamics.vy,
    yawRate: dynamics.yawRate,
    speed: dynamics.speed,
    slip: Math.abs(dynamics.lateralSpeed),
    braking: braking || brakePressure > 0,
    ...(humanDriver ? { brakePressure: driverPressure } : {}),
    ...(boost && humanDriver ? {
      driftTap: { heldSeconds, assistSeconds, direction: assisting || (input.braking && validPress) ? steeringDirection : 0 },
    } : vehicle.driftTap ? { driftTap: undefined } : {}),
    currentSurface: context.surface,
    surfaceGrip,
    onCurb: context.onCurb,
  }
}

// Kept as the small surface-only adapter used by isolated callers. The race
// engine uses the richer track context above.
export function stepPlayer(
  vehicle: RaceVehicle,
  input: DriverInput,
  surface: SurfaceId,
  deltaSeconds: number,
): RaceVehicle {
  const tangent = { x: Math.cos(vehicle.angle), y: Math.sin(vehicle.angle) }
  return stepVehicle(
    vehicle,
    input,
    {
      nearest: {
        index: vehicle.pathIndex,
        point: {
          x: vehicle.x,
          y: vehicle.y,
          surface,
          distance: 0,
          segment: vehicle.pathIndex,
          sectionId: `fallback-${vehicle.pathIndex}`,
          structure: 'surface',
        },
        distance: 0,
      },
      onRoad: true,
      onCurb: false,
      surface,
      tangent,
      normal: { x: -tangent.y, y: tangent.x },
      surfaceHeight: vehicle.z,
      grade: 0,
      structureRunId: vehicle.structureRunId,
      terrainMaterial: 'grass',
      safeAboveWater: false,
    },
    deltaSeconds,
  )
}
