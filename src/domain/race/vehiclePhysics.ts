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
import {
  ARCADE_BRAKE_TIMING,
  ARCADE_DYNAMICS_TUNING,
  VEHICLE_DYNAMICS_TUNING,
} from '@/domain/race/vehiclePhysicsConfig'

export function stepVehicle(
  vehicle: RaceVehicle,
  input: DriverInput,
  context: VehicleStepContext,
  deltaSeconds: number,
  handling: 'arcade' | 'simulation' = 'simulation',
  speedLimit = Number.POSITIVE_INFINITY,
): RaceVehicle {
  if (vehicle.wrecked || vehicle.finishedAt !== null) {
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
  const progressiveBrake = handling === 'arcade' && vehicle.player
  const driverPressure = progressiveBrake
    ? clamp(
        (vehicle.brakePressure ?? 0) + (input.braking
          ? dt / ARCADE_BRAKE_TIMING.pressSeconds
          : -dt / ARCADE_BRAKE_TIMING.releaseSeconds),
        0,
        1,
      )
    : Number(input.braking)
  const brakePressure = vehicle.speed > speedLimit ? 1 : driverPressure
  const car = CAR_SPECS[vehicle.car]
  const surface =
    context.surface === 'grass'
      ? OFFROAD_SURFACE
      : SURFACE_SPECS[context.surface]
  const terrain = VEHICLE_TERRAIN_SPECS[vehicle.car][context.surface]
  const damageRatio = vehicle.player
    ? clamp(vehicle.damage / Math.max(1, vehicle.damageLimit), 0, 1)
    : 0
  const condition = {
    max:
      1 -
      damageRatio *
        VEHICLE_DYNAMICS_TUNING.damage.maximumSpeedLoss,
    accel:
      1 -
      damageRatio *
        VEHICLE_DYNAMICS_TUNING.damage.maximumAccelerationLoss,
    grip:
      1 -
      damageRatio *
        VEHICLE_DYNAMICS_TUNING.damage.maximumGripLoss,
  }
  const maxSpeed = Math.min(speedLimit, car.max * surface.max * terrain.max * condition.max)
  const braking = input.braking || vehicle.speed > speedLimit
  const tuning = handling === 'arcade'
    ? ARCADE_DYNAMICS_TUNING
    : VEHICLE_DYNAMICS_TUNING
  const dynamics = stepVehicleDynamics(
    {
      angle: vehicle.angle,
      vx: vehicle.vx,
      vy: vehicle.vy,
      yawRate: vehicle.yawRate,
    },
    {
      ...input,
      // The shared input controller models an automatic accelerator. Holding
      // the service brake must cut drive torque instead of asking the finite
      // brakes to fight a permanently wide-open engine.
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
      recovery: car.recovery,
      maxSpeed,
      engineAcceleration:
        car.accel *
        surface.accel *
        terrain.accel *
        condition.accel,
      maxSteerAngle:
        car.steer * tuning.steering.maximumAngleScale,
      grip:
        car.grip *
        surface.grip *
        terrain.grip *
        condition.grip,
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
    ...(progressiveBrake ? { brakePressure: driverPressure } : {}),
    currentSurface: context.surface,
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
