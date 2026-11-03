# Vehicle Physics Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize all vehicle-physics values in one strict TypeScript module and make default road handling settle body slip promptly without removing deliberate drifts.

**Architecture:** A new domain configuration module owns horizontal model constants, car chassis/performance values, surfaces, terrain modifiers, and vertical dynamics. Existing public configuration records compose those physics values with presentation metadata. The bicycle integrator consumes an injectable readonly tuning record and applies contact-aware stability damping after tire-force integration.

**Tech Stack:** TypeScript 7 strict mode, Vitest, Phaser 4, Vite 7, Biome

## Global Constraints

- Keep the custom dynamic bicycle model and existing friction-circle/load-transfer behavior.
- Preserve controllable braking drift and remove only excessive residual body slip.
- Put all user-tunable vehicle physics values in `src/domain/race/vehiclePhysicsConfig.ts`.
- Keep existing `CAR_SPECS`, `SURFACE_SPECS`, `VEHICLE_TERRAIN_SPECS`, and `VERTICAL_DYNAMICS` exports compatible.
- Do not add a runtime tuning UI, persistence format, or third-party physics dependency.

---

### Task 1: Establish the typed physics configuration boundary

**Files:**
- Create: `src/domain/race/vehiclePhysicsConfig.ts`
- Modify: `src/domain/config.ts`
- Test: `tests/domain/vehiclePhysicsConfig.test.ts`

**Interfaces:**
- Produces: `VehicleDynamicsTuning`, `CarPhysicsSpec`, `SurfacePhysicsSpec`, `TerrainPhysicsModifier`, `VerticalDynamicsTuning`
- Produces: `VEHICLE_DYNAMICS_TUNING`, `CAR_PHYSICS_SPECS`, `SURFACE_PHYSICS_SPECS`, `VEHICLE_TERRAIN_PHYSICS_SPECS`, `VERTICAL_DYNAMICS`
- Preserves: existing records exported by `src/domain/config.ts`

- [ ] **Step 1: Write the failing central-config test**

```ts
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
    expect(CAR_PHYSICS_SPECS.blue.mass).toBeGreaterThan(0)
    expect(SURFACE_PHYSICS_SPECS.ice.grip).toBeLessThan(
      SURFACE_PHYSICS_SPECS.street.grip,
    )
    expect(VEHICLE_TERRAIN_PHYSICS_SPECS.yellow.grass.grip).toBeGreaterThan(1)
    expect(VERTICAL_DYNAMICS.gravity).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npm run test -- tests/domain/vehiclePhysicsConfig.test.ts`

Expected: FAIL because `vehiclePhysicsConfig.ts` does not exist.

- [ ] **Step 3: Create the typed module and move physics-only data**

Define readonly nested records for:

```ts
export interface VehicleDynamicsTuning {
  readonly integration: {
    readonly maximumDeltaSeconds: number
    readonly maximumYawRate: number
  }
  readonly forces: {
    readonly gravityAcceleration: number
    readonly referenceMass: number
    readonly lateralGripScale: number
    readonly brakeGripUsage: number
    readonly minimumLateralBudget: number
  }
  readonly steering: {
    readonly maximumAngleScale: number
    readonly highSpeedReduction: number
    readonly minimumTireSpeed: number
    readonly fullTireResponseSpeed: number
  }
  readonly stability: {
    readonly lateralDamping: number
    readonly steeringRetention: number
    readonly brakingRetention: number
    readonly lowSpeedSettling: number
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
```

Move the physics fields from car, surface, terrain, and vertical records without
changing their current values. Set planted defaults in the shared tuning:

```ts
stability: {
  lateralDamping: 7.2,
  steeringRetention: 0.58,
  brakingRetention: 0.34,
  lowSpeedSettling: 5.5,
}
```

- [ ] **Step 4: Compose public display config with the physics records**

In `config.ts`, import the new records, spread each car/surface physics record
into its matching presentation object, and re-export:

```ts
export {
  VEHICLE_TERRAIN_PHYSICS_SPECS as VEHICLE_TERRAIN_SPECS,
  VERTICAL_DYNAMICS,
} from '@/domain/race/vehiclePhysicsConfig'
```

- [ ] **Step 5: Run the focused configuration test**

Run: `npm run test -- tests/domain/vehiclePhysicsConfig.test.ts`

Expected: PASS.

### Task 2: Consume tuning and settle residual body slip

**Files:**
- Modify: `src/domain/race/vehicleDynamics.ts`
- Modify: `src/domain/race/vehiclePhysics.ts`
- Test: `tests/domain/vehicleDynamics.test.ts`

**Interfaces:**
- Consumes: `VehicleDynamicsTuning`, `VEHICLE_DYNAMICS_TUNING`
- Changes: `stepVehicleDynamics(..., deltaSeconds, tuning?)`
- Preserves: existing five-argument callers through a default parameter

- [ ] **Step 1: Write failing behavior and injection tests**

Add a helper that first corners for 30 frames and then releases steering for 60
frames. Assert:

```ts
expect(Math.abs(released.lateralSpeed)).toBeLessThan(
  Math.abs(cornering.lateralSpeed) * 0.22,
)
```

Create a loose tuning copy with `stability.lateralDamping: 0.15`, run the same
release, and assert:

```ts
expect(Math.abs(loose.lateralSpeed)).toBeGreaterThan(
  Math.abs(planted.lateralSpeed) * 1.8,
)
```

Keep the existing braking-slip and airborne-authority assertions.

- [ ] **Step 2: Run the focused test and verify expected failures**

Run: `npm run test -- tests/domain/vehicleDynamics.test.ts`

Expected: FAIL because `stepVehicleDynamics` does not consume injected tuning
and residual lateral velocity exceeds the planted limit.

- [ ] **Step 3: Replace private constants with typed tuning reads**

Import the central type/default and add:

```ts
export function stepVehicleDynamics(
  state: VehicleDynamicsState,
  control: VehicleDynamicsControl,
  parameters: VehicleDynamicsParameters,
  environment: VehicleDynamicsEnvironment,
  deltaSeconds: number,
  tuning: VehicleDynamicsTuning = VEHICLE_DYNAMICS_TUNING,
): VehicleDynamicsResult
```

Replace integration, force, steering, load-transfer, and settling magic numbers
with their matching typed configuration properties.

- [ ] **Step 4: Apply contact-aware stability damping**

After tire-force integration and before conversion to world velocity:

```ts
const steeringFactor =
  1 - Math.abs(steeringInput) * (1 - tuning.stability.steeringRetention)
const brakingFactor = control.braking
  ? tuning.stability.brakingRetention
  : 1
const lateralStability =
  tuning.stability.lateralDamping *
  steeringFactor *
  brakingFactor *
  tireResponse *
  contactLoad
nextLateral *= Math.exp(-lateralStability * dt)
```

This must evaluate to no stability force while airborne.

- [ ] **Step 5: Make the high-level adapter consume resistance tuning**

Replace the road/off-road rolling resistance, aerodynamic base, steering drag,
and maximum steer-angle scale in `vehiclePhysics.ts` with values from
`VEHICLE_DYNAMICS_TUNING`.

- [ ] **Step 6: Run focused physics tests**

Run: `npm run test -- tests/domain/vehicleDynamics.test.ts tests/domain/vehiclePhysics.test.ts tests/domain/raceSimulation.test.ts`

Expected: PASS with deliberate drift, planted recovery, airborne behavior, and
race integration intact.

### Task 3: Document tuning and verify the complete application

**Files:**
- Modify: `docs/refactorplan.md`
- Verify: all changed source and test files

**Interfaces:**
- Documents: the central file path and the stability-assist behavior.

- [ ] **Step 1: Document the tuning boundary**

Add a shipped item describing `vehiclePhysicsConfig.ts`, including the fact
that ordinary handling is planted while braking and steering reduce the
stability force to preserve drift.

- [ ] **Step 2: Run strict full verification**

Run: `npm run verify`

Expected: all Vitest files pass, strict TypeScript passes, Biome reports no
errors, and Vite produces a production build.

- [ ] **Step 3: Check patch hygiene**

Run: `git diff --check`

Expected: exit code 0; Windows line-ending notices are acceptable.

- [ ] **Step 4: Inspect the final working tree**

Run: `git status --short`

Expected: the implementation is visible in the user-requested `main` checkout
without altering or discarding unrelated existing work.
