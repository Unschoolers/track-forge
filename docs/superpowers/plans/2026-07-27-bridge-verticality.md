# Bridge Verticality and Track Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add speed-dependent bridge jumps, height-aware shadows and walls, generated track lamps, and readable day/night elevation.

**Architecture:** Keep `elevationProfile.ts` as the road-height authority. A pure vertical integrator owns suspension, takeoff, gravity, and landing; race orchestration feeds its tire-contact result into the existing horizontal model. Pure presentation builders derive bridge, vehicle-shadow, lamp, and night-light geometry before thin Phaser draw functions render ordered passes.

**Tech Stack:** TypeScript 7 strict mode, Phaser 4 Graphics, Vitest, Vite, Biome.

## Global Constraints

- Preserve the current top-down camera and section-based ground/overhead authoring model.
- Use physical world-unit height for dynamics and normalized elevation only for compatibility and broad draw ordering.
- Low speed produces suspension movement; high speed can produce a ballistic jump.
- Airborne cars can clear bridge walls and land off-road.
- Day lighting uses one shared 9 a.m. sun direction.
- Lamp posts are generated along the complete track and are denser on bridge decks.
- Night uses separate shade and additive light passes.
- Do not add a third-party physics or rendering dependency.

---

### Task 1: Pure Vertical Vehicle Dynamics

**Files:**
- Create: `src/domain/race/vehicleVerticalDynamics.ts`
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/config.ts`
- Test: `tests/domain/vehicleVerticalDynamics.test.ts`

**Interfaces:**
- Consumes: physical surface height and grade before/after horizontal movement.
- Produces:

```ts
export interface VehicleVerticalState {
  readonly z: number
  readonly verticalVelocity: number
  readonly grounded: boolean
  readonly suspensionCompression: number
  readonly landingIntensity: number
}

export interface VehicleVerticalEnvironment {
  readonly previousSurfaceHeight: number
  readonly surfaceHeight: number
  readonly previousGrade: number
  readonly grade: number
  readonly longitudinalSpeed: number
  readonly overRoad: boolean
}

export interface VehicleVerticalResult extends VehicleVerticalState {
  readonly contactLoad: number
}

export function stepVehicleVerticalDynamics(
  state: VehicleVerticalState,
  environment: VehicleVerticalEnvironment,
  deltaSeconds: number,
): VehicleVerticalResult
```

- [ ] **Step 1: Write failing pure dynamics tests**

Cover a slow crest that remains grounded, a fast crest that launches, airborne
gravity, ground landing, and non-finite input normalization:

```ts
const fast = stepVehicleVerticalDynamics(
  groundedAt(10),
  {
    previousSurfaceHeight: 9.5,
    surfaceHeight: 10,
    previousGrade: 0.18,
    grade: 0,
    longitudinalSpeed: 250,
    overRoad: true,
  },
  1 / 60,
)
expect(fast.grounded).toBe(false)
expect(fast.verticalVelocity).toBeGreaterThan(0)
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test -- tests/domain/vehicleVerticalDynamics.test.ts`  
Expected: FAIL because the vertical dynamics module does not exist.

- [ ] **Step 3: Implement bounded suspension and ballistic integration**

Use shared constants in `config.ts`:

```ts
export const VERTICAL_DYNAMICS = {
  gravity: 96,
  suspensionTravel: 0.85,
  suspensionResponse: 15,
  takeoffVelocityThreshold: 5.5,
  maximumLaunchVelocity: 42,
  landingVelocityScale: 0.045,
  landingDecay: 6,
  bridgeWallHeight: 3.2,
} as const
```

For grounded motion, calculate required surface velocity from height delta and
`longitudinalSpeed * Math.sin(previousGrade)`. Preserve excess upward velocity
when grade falls at a crest. For airborne motion, integrate
`verticalVelocity - gravity * dt`; land only when descending through the active
surface. Return contact load `0` airborne and a bounded
`0.55..1.35` suspension load grounded.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm run test -- tests/domain/vehicleVerticalDynamics.test.ts`  
Expected: PASS.

### Task 2: Race Integration and Tire Contact

**Files:**
- Modify: `src/domain/track/elevationProfile.ts`
- Modify: `src/domain/race/trackContext.ts`
- Modify: `src/domain/race/vehicleDynamics.ts`
- Modify: `src/domain/race/vehiclePhysics.ts`
- Modify: `src/domain/race/raceFactory.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Test: `tests/domain/vehicleDynamics.test.ts`
- Test: `tests/domain/vehiclePhysics.test.ts`
- Test: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Consumes: `stepVehicleVerticalDynamics`.
- Produces:

```ts
export interface VehicleStepContext {
  // existing fields
  readonly roadHeight: number
  readonly contactLoad: number
}

export interface VehicleDynamicsEnvironment {
  readonly grade: number
  readonly roadTangent: Vector2
  readonly contactLoad: number
}
```

- [ ] **Step 1: Write failing integration tests**

Assert that zero contact removes drive, braking, and tire steering authority;
race steps update both player and AI `z`; reset places the car at
`roadHeightAt`; and stuck recovery never resets an airborne car:

```ts
expect(airborne.speed).toBeCloseTo(initialSpeed, 0)
expect(airborne.yawRate).toBeCloseTo(initialYawRate, 1)
expect(stepped.vehicles.every(({ z }) => Number.isFinite(z))).toBe(true)
```

- [ ] **Step 2: Run affected suites and verify RED**

Run: `npm run test -- tests/domain/vehicleDynamics.test.ts tests/domain/vehiclePhysics.test.ts tests/domain/raceSimulation.test.ts`  
Expected: FAIL on missing vertical/contact state.

- [ ] **Step 3: Integrate contact load and common vertical stepping**

Multiply engine, brake, rolling, and front/rear lateral capacities by clamped
`contactLoad`. Preserve aerodynamic drag and yaw inertia at zero contact.

After every player or AI horizontal step in `raceEngine.ts`, sample the new
context and call:

```ts
const vertical = stepVehicleVerticalDynamics(vehicle, {
  previousSurfaceHeight: previousContext.roadHeight,
  surfaceHeight: nextContext.onRoad ? nextContext.roadHeight : 0,
  previousGrade: previousContext.grade,
  grade: nextContext.grade,
  longitudinalSpeed: moved.speed,
  overRoad: nextContext.onRoad,
}, dt)
```

Copy the result into the returned `RaceVehicle`. Initialize and reset all
vertical fields deterministically.

- [ ] **Step 4: Run affected suites and verify GREEN**

Run: `npm run test -- tests/domain/vehicleDynamics.test.ts tests/domain/vehiclePhysics.test.ts tests/domain/raceSimulation.test.ts`  
Expected: PASS.

### Task 3: Absolute-Height Contacts and Airborne Wall Clearance

**Files:**
- Modify: `src/domain/race/bridgeBarriers.ts`
- Modify: `src/domain/race/collisions.ts`
- Test: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Consumes: vehicle `z`, `grounded`, and `VERTICAL_DYNAMICS.bridgeWallHeight`.
- Produces: wall and vehicle collision decisions based on absolute height.

- [ ] **Step 1: Write failing clearance tests**

```ts
const aboveWall = {
  ...bridgeVehicle,
  z: deckHeight + VERTICAL_DYNAMICS.bridgeWallHeight + 0.1,
  grounded: false,
}
expect(solveBridgeBarrierFrame(
  [aboveWall],
  [{ ...aboveWall, x: aboveWall.x + 50 }],
  bridgePath,
  [],
).events).toHaveLength(0)
```

Also assert a grounded vehicle still hits the wall and vertically separated
vehicles at a crossing do not collide.

- [ ] **Step 2: Run the race simulation suite and verify RED**

Run: `npm run test -- tests/domain/raceSimulation.test.ts`  
Expected: FAIL because wall collision ignores vehicle `z`.

- [ ] **Step 3: Implement absolute-height checks**

Skip a bridge barrier only when:

```ts
const wallTop =
  elevation.height * ROAD_GEOMETRY.bridgeDeckHeight +
  VERTICAL_DYNAMICS.bridgeWallHeight
if (!previous.grounded && previous.z > wallTop) return moved
```

Replace normalized vehicle-collision elevation comparison with an absolute
`z` clearance threshold.

- [ ] **Step 4: Run the race simulation suite and verify GREEN**

Run: `npm run test -- tests/domain/raceSimulation.test.ts`  
Expected: PASS.

### Task 4: Shared Sun Model and Height-Derived Bridge Presentation

**Files:**
- Create: `src/phaser/rendering/lighting.ts`
- Modify: `src/phaser/rendering/bridgeRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Test: `tests/phaser/trackPresentation.test.ts`

**Interfaces:**
- Produces:

```ts
export const WORLD_LIGHTING = {
  sunShadowDirection: { x: 0.78, y: 0.62 },
  shadowLengthPerHeight: 1.55,
  penumbraScale: 1.22,
} as const

export function projectSunShadow(
  point: Vector2,
  height: number,
  scale?: number,
): Vector2
```

Bridge primitives add `shadow-soft`, `shadow-core`, and `side-face` polygons.

- [ ] **Step 1: Write failing bridge-presentation tests**

Assert the ramp-foot shadow offset is near zero, deck offset is larger, the
shadow direction is consistent, side faces grow with height, and shadow passes
precede pillars and decks.

- [ ] **Step 2: Run the presentation suite and verify RED**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts`  
Expected: FAIL because bridge shadows use a constant offset and have no faces.

- [ ] **Step 3: Implement projected bridge geometry**

Build each shadow quad by projecting each edge vertex with its own endpoint
height. Emit a broader penumbra before a core shadow. Build side-face quads
between the elevated edge and the same edge projected toward the ground;
choose the sun-opposed side from its normal dot product with the shadow
direction. Do not emit meaningful shadow/face polygons below `0.005` height.

Render sun shadows only in day mode. Keep a small ambient under-deck occlusion
at night.

- [ ] **Step 4: Run presentation tests and verify GREEN**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts`  
Expected: PASS.

### Task 5: Projected Vehicle Shadows and Landing Feedback

**Files:**
- Modify: `src/phaser/rendering/vehicleRenderer.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Modify: `src/domain/race/trackContext.ts`
- Test: `tests/phaser/renderingContracts.test.ts`
- Test: `tests/phaser/raceCamera.test.ts`

**Interfaces:**
- Produces:

```ts
export interface VehicleShadow {
  readonly center: Vector2
  readonly angle: number
  readonly width: number
  readonly length: number
  readonly alpha: number
}

export function projectVehicleShadow(
  vehicle: RaceVehicle,
  night: boolean,
): VehicleShadow | null
```

- [ ] **Step 1: Write failing shadow and landing tests**

Assert the ground shadow is tight, bridge and airborne shadows separate in the
sun direction, higher shadows soften, night returns no sun shadow, and landing
intensity adds bounded camera shake.

- [ ] **Step 2: Run renderer/camera suites and verify RED**

Run: `npm run test -- tests/phaser/renderingContracts.test.ts tests/phaser/raceCamera.test.ts`  
Expected: FAIL because vehicles embed a fixed local rectangle shadow.

- [ ] **Step 3: Split shadow and body passes**

Remove the fixed rectangle from `renderVehicles`. Add
`renderVehicleShadows` on a dedicated graphics layer below bridge decks.
Classify body depth from absolute `z`, and add landing intensity to camera
shake with a strict upper bound.

- [ ] **Step 4: Run renderer/camera suites and verify GREEN**

Run: `npm run test -- tests/phaser/renderingContracts.test.ts tests/phaser/raceCamera.test.ts`  
Expected: PASS.

### Task 6: Generated Lamp Posts and Night Light Passes

**Files:**
- Create: `src/phaser/rendering/lampPostRenderer.ts`
- Modify: `src/phaser/rendering/nightRenderer.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Test: `tests/phaser/trackPresentation.test.ts`
- Test: `tests/phaser/renderingContracts.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LampPost {
  readonly position: Vector2
  readonly roadAnchor: Vector2
  readonly side: -1 | 1
  readonly height: number
  readonly bridge: boolean
}

export function buildLampPosts(
  geometry: TrackGeometry,
): readonly LampPost[]

export function renderNightShade(
  graphics: Phaser.GameObjects.Graphics,
  viewport: NightViewport,
): void

export function renderNightLights(
  graphics: Phaser.GameObjects.Graphics,
  vehicles: readonly VehicleLightTransform[],
  lamps: readonly LampPost[],
): void
```

- [ ] **Step 1: Write failing deterministic placement tests**

Assert repeated builds return the same lamps; maximum bridge spacing is less
than maximum ground spacing; every post is beyond the road edge; sides
alternate on ordinary stretches; and no post is inside the start-grid
exclusion radius.

- [ ] **Step 2: Run presentation/rendering suites and verify RED**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts tests/phaser/renderingContracts.test.ts`  
Expected: FAIL because lamp placement and split night passes do not exist.

- [ ] **Step 3: Implement geometry-derived lamps**

Sample normal sections every `150` world units and full bridge decks every
`90` world units. Position posts at
`ROAD_GEOMETRY.edgeWidth / 2 + 11` along the ribbon normal. Reject candidates
within `72` units of the start position, within `64` units of an at-grade
crossing, or within `54` units of another post.

Render poles, heads, and day shadows in the track overlay. Split the current
night renderer into a normal shade graphics object and an additive light
graphics object. Draw warm lamp pools and fixture glows alongside transformed
vehicle lamps.

- [ ] **Step 4: Run presentation/rendering suites and verify GREEN**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts tests/phaser/renderingContracts.test.ts`  
Expected: PASS.

### Task 7: Full Regression and Browser Validation

**Files:**
- Modify only files required by failures attributable to Tasks 1-6.
- Update: `docs/refactorplan.md`

**Interfaces:**
- Consumes all preceding deliverables.
- Produces one verified bridge/jump/lighting feature.

- [ ] **Step 1: Run all project gates**

Run: `npm run verify`  
Expected: all Vitest suites, strict TypeScript, Biome, and Vite build pass.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check`  
Expected: exit code `0`; existing CRLF conversion warnings are acceptable.

- [ ] **Step 3: Validate in the running browser**

Use one track containing a long bridge and crossing. Confirm:

1. slow crest travel produces a small suspension bop;
2. fast crest travel produces a visible jump and separated shadow;
3. high airborne cars can clear a wall and land on grass;
4. deck shadows and faces grow continuously along ramps in day mode;
5. lamp posts follow the whole track without blocking start/crossings;
6. night mode has no sun shadow and keeps both road levels readable;
7. pause and quit still silence continuous audio.

- [ ] **Step 4: Record shipped behavior**

Add a dated `docs/refactorplan.md` entry describing vertical dynamics,
height-aware barriers, projected shadows, generated lamps, and split night
lighting.
