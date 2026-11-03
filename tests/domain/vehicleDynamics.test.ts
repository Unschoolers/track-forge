import { describe, expect, it } from 'vitest'
import {
  stepVehicleDynamics,
  type VehicleDynamicsParameters,
  type VehicleDynamicsResult,
  type VehicleDynamicsState,
} from '@/domain/race/vehicleDynamics'
import {
  VEHICLE_DYNAMICS_TUNING,
  type VehicleDynamicsTuning,
} from '@/domain/race/vehiclePhysicsConfig'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'

const PARAMETERS: VehicleDynamicsParameters = {
  mass: 1_250,
  wheelbase: 26,
  centerOfMassHeight: 5.2,
  yawInertia: 220_000,
  frontWeightBias: 0.54,
  cornerStiffness: 8.5,
  brakeForce: 130_000,
  recovery: 1.5,
  maxSpeed: 300,
  engineAcceleration: 210,
  maxSteerAngle: 0.48,
  grip: 1,
  brakeGrip: 1,
  rollingResistance: 1.15,
  aerodynamicResistance: 8.5,
}

const FLAT = {
  grade: 0,
  roadTangent: { x: 1, y: 0 },
  contactLoad: 1,
} as const

function run(
  initial: VehicleDynamicsState,
  control: {
    readonly steering: number
    readonly throttle: number
    readonly braking: boolean
  },
  frames: number,
  parameters: VehicleDynamicsParameters = PARAMETERS,
  tuning: VehicleDynamicsTuning = VEHICLE_DYNAMICS_TUNING,
): VehicleDynamicsResult {
  let state: VehicleDynamicsState = initial
  let result = stepVehicleDynamics(
    state,
    control,
    parameters,
    FLAT,
    1 / 60,
    tuning,
  )
  for (let frame = 1; frame < frames; frame += 1) {
    state = result
    result = stepVehicleDynamics(
      state,
      control,
      parameters,
      FLAT,
      1 / 60,
      tuning,
    )
  }
  return result
}

describe('dynamic bicycle vehicle model', () => {
  it('brakes progressively instead of stopping instantly', () => {
    const initial = { angle: 0, vx: 160, vy: 0, yawRate: 0 }
    const coasting = run(
      initial,
      { steering: 0, throttle: 0, braking: false },
      60,
    )
    const braking = run(
      initial,
      { steering: 0, throttle: 0, braking: true },
      60,
    )

    expect(braking.speed).toBeLessThan(coasting.speed)
    expect(braking.speed).toBeGreaterThan(35)
  })

  it('turns hard braking into a bounded lateral drift', () => {
    const initial = { angle: 0, vx: 170, vy: 0, yawRate: 0 }
    const cornering = run(
      initial,
      { steering: 0.72, throttle: 0, braking: false },
      40,
    )
    const trailBraking = run(
      initial,
      { steering: 0.72, throttle: 0, braking: true },
      40,
    )

    expect(trailBraking.lateralSpeed).not.toBe(0)
    expect(Math.abs(trailBraking.yawRate)).toBeGreaterThan(0.05)
    expect(Math.abs(trailBraking.yawRate)).toBeLessThan(2.4)
    expect(Math.abs(trailBraking.angle)).toBeGreaterThan(0.2)
    const corneringSlipAngle = Math.abs(
      Math.atan2(cornering.lateralSpeed, cornering.longitudinalSpeed),
    )
    const brakingSlipAngle = Math.abs(
      Math.atan2(
        trailBraking.lateralSpeed,
        trailBraking.longitudinalSpeed,
      ),
    )
    expect(brakingSlipAngle).toBeGreaterThan(corneringSlipAngle)
    expect(brakingSlipAngle).toBeGreaterThan(0.05)
  })

  it('recovers a braking drift after counter-steering', () => {
    const initial = { angle: 0, vx: 160, vy: 0, yawRate: 0 }
    const drifting = run(
      initial,
      { steering: 0.75, throttle: 0, braking: true },
      32,
    )
    const recovered = run(
      drifting,
      { steering: -0.45, throttle: 0.45, braking: false },
      70,
    )

    expect(Math.abs(recovered.lateralSpeed)).toBeLessThan(
      Math.abs(drifting.lateralSpeed),
    )
    expect(Math.abs(recovered.yawRate)).toBeLessThan(
      Math.abs(drifting.yawRate),
    )
  })

  it('settles residual body slip promptly after steering release', () => {
    const initial = { angle: 0, vx: 170, vy: 0, yawRate: 0 }
    const cornering = run(
      initial,
      { steering: 0.75, throttle: 0.4, braking: false },
      30,
    )
    const released = run(
      cornering,
      { steering: 0, throttle: 0.4, braking: false },
      15,
    )

    expect(Math.abs(released.lateralSpeed)).toBeLessThan(0.8)
  })

  it('consumes stability tuning instead of baking in one handling feel', () => {
    const initial = { angle: 0, vx: 170, vy: 0, yawRate: 0 }
    const cornering = run(
      initial,
      { steering: 0.75, throttle: 0.4, braking: false },
      30,
    )
    const planted = run(
      cornering,
      { steering: 0, throttle: 0.4, braking: false },
      15,
    )
    const loose = run(
      cornering,
      { steering: 0, throttle: 0.4, braking: false },
      15,
      PARAMETERS,
      {
        ...VEHICLE_DYNAMICS_TUNING,
        stability: {
          ...VEHICLE_DYNAMICS_TUNING.stability,
          lateralDamping: 0.15,
        },
      },
    )

    expect(Math.abs(loose.lateralSpeed)).toBeGreaterThan(
      Math.abs(planted.lateralSpeed) * 1.8,
    )
  })

  it('uses mass and road grade in longitudinal acceleration', () => {
    const stopped = { angle: 0, vx: 0, vy: 0, yawRate: 0 }
    const light = stepVehicleDynamics(
      stopped,
      { steering: 0, throttle: 1, braking: false },
      { ...PARAMETERS, mass: 1_000 },
      FLAT,
      0.05,
    )
    const heavy = stepVehicleDynamics(
      stopped,
      { steering: 0, throttle: 1, braking: false },
      { ...PARAMETERS, mass: 1_600 },
      FLAT,
      0.05,
    )
    expect(light.speed).toBeGreaterThan(heavy.speed)

    const moving = { angle: 0, vx: 120, vy: 0, yawRate: 0 }
    const uphill = stepVehicleDynamics(
      moving,
      { steering: 0, throttle: 0, braking: false },
      PARAMETERS,
      { ...FLAT, grade: 0.15 },
      0.05,
    )
    const flat = stepVehicleDynamics(
      moving,
      { steering: 0, throttle: 0, braking: false },
      PARAMETERS,
      FLAT,
      0.05,
    )
    const downhill = stepVehicleDynamics(
      moving,
      { steering: 0, throttle: 0, braking: false },
      PARAMETERS,
      { ...FLAT, grade: -0.15 },
      0.05,
    )

    expect(uphill.speed).toBeLessThan(flat.speed)
    expect(downhill.speed).toBeGreaterThan(flat.speed)
  })

  it('removes tire and drive authority while airborne', () => {
    const initial = { angle: 0, vx: 120, vy: 0, yawRate: 0.45 }
    const airborne = stepVehicleDynamics(
      initial,
      { steering: 1, throttle: 1, braking: true },
      PARAMETERS,
      { ...FLAT, contactLoad: 0 },
      0.05,
    )
    const grounded = stepVehicleDynamics(
      initial,
      { steering: 1, throttle: 1, braking: true },
      PARAMETERS,
      FLAT,
      0.05,
    )

    expect(airborne.yawRate).toBeCloseTo(initial.yawRate, 5)
    expect(airborne.speed).toBeCloseTo(initial.vx, 0)
    expect(Math.abs(grounded.speed - initial.vx)).toBeGreaterThan(2)
    expect(Math.abs(grounded.yawRate - initial.yawRate)).toBeGreaterThan(0.01)
  })

  it('derives physical uphill and downhill grades from bridge ramps', () => {
    const path = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street', structure: 'surface' },
        { x: 180, y: 0, surface: 'street', structure: 'overpass' },
        { x: 380, y: 0, surface: 'street', structure: 'overpass' },
        { x: 380, y: 180, surface: 'street', structure: 'surface' },
        { x: 0, y: 180, surface: 'street', structure: 'surface' },
        { x: 0, y: 0, surface: 'street', structure: 'surface' },
      ],
      EMPTY_TERRAIN,
    )
    const grades = path.points.map((_, index) =>
      path.roadSurface.gradeAt(index),
    )

    expect(Math.max(...grades)).toBeGreaterThan(0.02)
    expect(Math.min(...grades)).toBeLessThan(-0.02)
  })
})
