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
  ARCADE_ASSIST_BRAKING,
  ARCADE_DYNAMICS_TUNING,
  VEHICLE_DYNAMICS_TUNING,
} from '@/domain/race/vehiclePhysicsConfig'

// An exponential response reaches about 95% of the new grip in 0.15 s.
const SURFACE_GRIP_TIME_CONSTANT = 0.05

function getSurfaceSpec(surface: SurfaceId | 'grass') {
  return surface === 'grass' ? OFFROAD_SURFACE : SURFACE_SPECS[surface]
}

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
  const arcadePlayer = handling === 'arcade' && vehicle.player
  const driverPressure = arcadePlayer
    ? clamp(
        (vehicle.brakePressure ?? 0) + (input.braking
          ? dt / ARCADE_BRAKE_TIMING.pressSeconds
          : -dt / ARCADE_BRAKE_TIMING.releaseSeconds),
        0,
        1,
      )
    : Number(input.braking)
  const previousAssist = vehicle.arcadeAssistBrake ?? 0
  // A small deadband and bounded pressure slew avoid flicker at the target.
  const speedError = vehicle.speed - speedLimit
  const assistTarget = arcadePlayer
    ? clamp((speedError - (previousAssist > 0 ? 0 : 2)) * 0.04, 0, ARCADE_ASSIST_BRAKING.maxPressure)
    : 0
  const assistBrake = arcadePlayer
    ? clamp(
        assistTarget,
        Math.max(0, previousAssist - dt * ARCADE_ASSIST_BRAKING.pressureSlewPerSecond),
        Math.min(ARCADE_ASSIST_BRAKING.maxPressure, previousAssist + dt * ARCADE_ASSIST_BRAKING.pressureSlewPerSecond),
      )
    : 0
  const legacySpeedBrake = !vehicle.player && vehicle.speed > speedLimit
  const brakePressure = Math.max(driverPressure, assistBrake, Number(legacySpeedBrake))
  const car = CAR_SPECS[vehicle.car]
  const surface = getSurfaceSpec(context.surface)
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
  const physicsSpeedLimit = vehicle.player ? Number.POSITIVE_INFINITY : speedLimit
  const maxSpeed = Math.min(physicsSpeedLimit, car.max * surface.max * terrain.max * condition.max)
  const braking = input.braking || legacySpeedBrake || assistBrake > 0
  const tuning = handling === 'arcade'
    ? ARCADE_DYNAMICS_TUNING
    : VEHICLE_DYNAMICS_TUNING
  const targetGrip = surface.grip * terrain.grip
  const previousGrip = vehicle.speed === 0
    ? targetGrip
    : vehicle.surfaceGrip ??
      getSurfaceSpec(vehicle.currentSurface).grip *
        VEHICLE_TERRAIN_SPECS[vehicle.car][vehicle.currentSurface].grip
  const surfaceGrip = targetGrip +
    (previousGrip - targetGrip) * Math.exp(-dt / SURFACE_GRIP_TIME_CONSTANT)
  const dynamics = stepVehicleDynamics(
    {
      angle: vehicle.angle,
      vx: vehicle.vx,
      vy: vehicle.vy,
      yawRate: vehicle.yawRate,
    },
    {
      ...input,
      // Manual braking overrides either throttle mode. The corner assist
      // blends out engine torque as its brake pressure rises.
      throttle: input.braking || legacySpeedBrake
        ? 0
        : input.throttle * (1 - Math.max(driverPressure, assistBrake / ARCADE_ASSIST_BRAKING.maxPressure)),
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
      safetySpeed: Math.min(physicsSpeedLimit, car.max),
      engineAcceleration:
        car.accel *
        surface.accel *
        terrain.accel *
        condition.accel,
      maxSteerAngle:
        car.steer * tuning.steering.maximumAngleScale,
      grip:
        car.grip *
        surfaceGrip *
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
    ...(arcadePlayer ? { brakePressure: driverPressure } : {}),
    ...(arcadePlayer || vehicle.arcadeAssistBrake !== undefined
      ? { arcadeAssistBrake: assistBrake }
      : {}),
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
