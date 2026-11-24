import { describe, expect, it, vi } from 'vitest'
import { CAR_SPECS } from '@/domain/config'
import { steeringLimitAtSpeed, VEHICLE_DYNAMICS_TUNING } from '@/domain/race/vehiclePhysicsConfig'
import { createRace } from '@/domain/race/raceFactory'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { stepVehicleDynamics } from '@/domain/race/vehicleDynamics'

vi.mock('@/domain/race/vehicleDynamics', () => ({
  stepVehicleDynamics: vi.fn((state) => ({
    ...state, speed: 100, lateralSpeed: 0, longitudinalSpeed: 100,
  })),
}))

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street' },
  { x: 500, y: 0, surface: 'street' },
], EMPTY_TERRAIN)

describe('Arcade steering authority', () => {
  it.each([
    ['red', 2.28, 40],
    ['blue', 2.72, 40],
    ['yellow', 2.46, 40],
    ['green', 3.2, 3.2 * 0.235 * 180 / Math.PI],
  ] as const)('preserves %s high-speed steering while setting low-speed lock', (car, originalRack, lowDegrees) => {
    const race = createRace({ path, playerCar: car, difficulty: 'normal', laps: 1 })
    const vehicle = race.vehicles[0]
    if (!vehicle) throw new Error('Missing vehicle')
    const context = getVehicleStepContext(path, vehicle)
    stepVehicle(vehicle, { steering: 1, throttle: 1, braking: false }, context, 1 / 60)
    const params = vi.mocked(stepVehicleDynamics).mock.lastCall?.[2]
    if (!params) throw new Error('Missing dynamics parameters')
    const angle = (ratio: number) => steeringLimitAtSpeed(
      params.maxSteerAngle,
      ratio,
      VEHICLE_DYNAMICS_TUNING.steering.highSpeedReduction,
      params.lowSpeedSteerAngle,
    ) * 180 / Math.PI
    const originalHighDegrees = originalRack * 0.235 * 0.69 * 180 / Math.PI
    expect(angle(0)).toBeCloseTo(lowDegrees, 8)
    expect(angle(0.5)).toBeCloseTo((lowDegrees + originalHighDegrees) / 2, 8)
    expect(angle(1)).toBeCloseTo(originalHighDegrees, 8)
    expect(angle(1.2)).toBeCloseTo(originalHighDegrees, 8)
  })

  it('always passes the same Arcade steering-angle scale to the dynamics integrator', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 })
    const vehicle = race.vehicles[0]
    if (!vehicle) throw new Error('Missing vehicle')
    const context = getVehicleStepContext(path, vehicle)
    const input = { steering: 0.3, throttle: 1, braking: false }
    stepVehicle(vehicle, input, context, 1 / 60, 'arcade')
    const arcade = vi.mocked(stepVehicleDynamics).mock.lastCall
    expect(arcade?.[2].maxSteerAngle).toBeCloseTo(
      CAR_SPECS.blue.steer * VEHICLE_DYNAMICS_TUNING.steering.maximumAngleScale,
    )
    stepVehicle(vehicle, input, context, 1 / 60, 'simulation')
    const simulation = vi.mocked(stepVehicleDynamics).mock.lastCall
    expect(simulation?.[2].maxSteerAngle).toBeCloseTo(
      CAR_SPECS.blue.steer * VEHICLE_DYNAMICS_TUNING.steering.maximumAngleScale,
    )
    expect(simulation).toEqual(arcade)
    stepVehicle(vehicle, input, context, 1 / 60)
    expect(vi.mocked(stepVehicleDynamics).mock.lastCall).toEqual(arcade)
    expect(VEHICLE_DYNAMICS_TUNING.steering.maximumAngleScale).toBe(0.235)
  })
})
