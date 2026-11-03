import { describe, expect, it } from 'vitest'
import {
  CAR_PHYSICS_SPECS,
  SURFACE_PHYSICS_SPECS,
  VEHICLE_DYNAMICS_TUNING,
  VEHICLE_TERRAIN_PHYSICS_SPECS,
  VERTICAL_DYNAMICS,
} from '@/domain/race/vehiclePhysicsConfig'

describe('vehicle physics configuration', () => {
  it('exposes every horizontal and vertical tuning family in one module', () => {
    expect(VEHICLE_DYNAMICS_TUNING.stability.lateralDamping).toBeGreaterThan(0)
    expect(
      VEHICLE_DYNAMICS_TUNING.damage.maximumGripLoss,
    ).toBeGreaterThan(0)
    expect(
      VEHICLE_DYNAMICS_TUNING.forces.maximumContactLoad,
    ).toBeGreaterThan(1)
    expect(CAR_PHYSICS_SPECS.blue.mass).toBeGreaterThan(0)
    expect(SURFACE_PHYSICS_SPECS.ice.grip).toBeLessThan(
      SURFACE_PHYSICS_SPECS.street.grip,
    )
    expect(VEHICLE_TERRAIN_PHYSICS_SPECS.yellow.grass.grip).toBeGreaterThan(1)
    expect(VERTICAL_DYNAMICS.gravity).toBeGreaterThan(0)
    expect(VERTICAL_DYNAMICS.crestDropForFullLaunch).toBeGreaterThan(0)
    expect(VERTICAL_DYNAMICS.maximumContactLoad).toBeGreaterThan(1)
  })
})
