import { describe, expect, it, vi } from 'vitest'
import { CAR_SPECS } from '@/domain/config'
import { ARCADE_DYNAMICS_TUNING, VEHICLE_DYNAMICS_TUNING } from '@/domain/race/vehiclePhysicsConfig'
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
  it('actually passes the arcade steering-angle scale to the dynamics integrator', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 })
    const vehicle = race.vehicles[0]
    if (!vehicle) throw new Error('Missing vehicle')
    const context = getVehicleStepContext(path, vehicle)
    const input = { steering: 0.3, throttle: 1, braking: false }
    stepVehicle(vehicle, input, context, 1 / 60, 'arcade')
    const arcade = vi.mocked(stepVehicleDynamics).mock.lastCall
    expect(arcade?.[2].maxSteerAngle).toBeCloseTo(
      CAR_SPECS.blue.steer * ARCADE_DYNAMICS_TUNING.steering.maximumAngleScale,
    )
    stepVehicle(vehicle, input, context, 1 / 60, 'simulation')
    const simulation = vi.mocked(stepVehicleDynamics).mock.lastCall
    expect(simulation?.[2].maxSteerAngle).toBeCloseTo(
      CAR_SPECS.blue.steer * VEHICLE_DYNAMICS_TUNING.steering.maximumAngleScale,
    )
    expect(arcade?.[2].maxSteerAngle).toBeGreaterThan(simulation?.[2].maxSteerAngle ?? 0)
  })
})
