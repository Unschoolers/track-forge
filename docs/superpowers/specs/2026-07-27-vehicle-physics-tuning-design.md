# Vehicle Physics Tuning Design

## Goal

Make normal road handling feel planted instead of permanently icy, while
preserving controllable braking drifts and putting every vehicle-physics tuning
value in one strict TypeScript module.

## Root Cause

The dynamic bicycle model caps tire force correctly, but it deliberately avoids
any lateral-velocity stabilization. Once a tire saturates, lateral velocity can
therefore persist after the driver releases the wheel. The existing `recovery`
value damps yaw rate only; it does not settle the vehicle's body slip.

Physics values are also split between `config.ts`, `vehiclePhysics.ts`, and
private constants in `vehicleDynamics.ts`. This makes the complete handling
model difficult to inspect or tune as a coherent system.

## Considered Approaches

### Move only algorithm constants

This would expose the current magic numbers, but car, surface, terrain, and
vertical tuning would remain elsewhere. It does not satisfy the single-file
tuning goal.

### Move only per-car handling

This makes vehicle identities easier to tune, but the global tire model would
remain opaque and the ice-like behavior would still require editing algorithm
code.

### Central typed physics module

Create `src/domain/race/vehiclePhysicsConfig.ts` as the sole owner of:

- global integration, force, tire, steering, stability, and resistance values;
- per-car performance and chassis values;
- surface and vehicle-terrain modifiers;
- vertical suspension, gravity, takeoff, landing, and bridge-wall values.

This approach is selected because it gives the tuning data one discoverable
home while leaving simulation code responsible only for applying that data.

## Architecture

`vehiclePhysicsConfig.ts` exports explicit readonly interfaces and constants:

- `VEHICLE_DYNAMICS_TUNING` for the shared horizontal model;
- `CAR_PHYSICS_SPECS` for each chassis and performance profile;
- `SURFACE_PHYSICS_SPECS` and `VEHICLE_TERRAIN_PHYSICS_SPECS`;
- `VERTICAL_DYNAMICS`.

`config.ts` continues to own presentation metadata, road geometry, AI tuning,
and public compatibility exports. It composes car and surface display records
with the imported physics records, so existing callers do not need a sweeping
migration.

The low-level dynamics integrator accepts an optional tuning value for focused
tests and future simulation modes. Production callers use the exported default.
No runtime mutation or global settings UI is introduced.

## Planted Handling Model

The existing friction-circle and load-transfer model remains intact. A
configurable lateral stability force is added after tire-force integration:

- it scales with ground contact and vehicle speed;
- it is strongest when the steering wheel is released;
- it reduces while steering so the rear can rotate;
- it reduces further under braking so trail-braking drifts remain possible;
- it is zero while airborne.

Yaw recovery remains independent and configurable. This avoids an artificial
snap-to-heading while letting sideways velocity settle faster than it does
today.

The default street setup will also use a slightly higher tire-force scale and
earlier tire response. Ice, dirt, grass, damage, and car-specific multipliers
continue to modify the same shared model.

The initial planted baseline uses `lateralDamping: 7.2`. This value is high
enough to settle residual body slip in roughly a quarter-second, while the
steering and braking retention multipliers reduce its authority during an
intentional slide.

## Safety and Normalization

Simulation code clamps time steps, contact load, and all values that can create
division by zero or non-finite output. Tunable multipliers use safe lower bounds
at consumption sites, allowing experimentation without turning invalid values
into `NaN`.

## Tests

Focused domain tests will prove:

- the default tuning settles lateral velocity promptly after steering release;
- braking still produces more slip than ordinary cornering;
- a deliberately loose tuning profile retains more slip, proving the config is
  actually consumed;
- airborne vehicles receive no hidden stability force;
- car, surface, terrain, and vertical values are available from the central
  module;
- the existing physics, race, strict TypeScript, lint, and production build
  gates remain green.

## Non-Goals

- A runtime tuning UI or persistence format.
- Replacing the custom bicycle model with a third-party physics engine.
- Eliminating drift or forcing vehicles onto the track centerline.
- Retuning AI racing lines independently of the shared vehicle physics.
