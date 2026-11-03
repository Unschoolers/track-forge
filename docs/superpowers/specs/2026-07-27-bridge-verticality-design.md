# Bridge Verticality, Shadows, and Track Lighting Design

**Date:** 2026-07-27  
**Status:** Approved

## Goals

- Make ramps, bridge decks, underpasses, and airborne cars readable in the
  existing top-down presentation.
- Let ramp speed produce anything from suspension movement to a meaningful
  jump.
- Apply gravity, tire unloading, airborne wall clearance, and landing forces
  consistently to player and AI vehicles.
- Replace the fixed bridge shadow with height-derived 9 a.m. sunlight.
- Generate lamp posts along the whole track, with denser coverage on bridges,
  and use them to preserve road readability at night.
- Keep the current section-elevation authoring model and Phaser 2D renderer.

## Non-Goals

- A perspective or 3D camera, mesh-based terrain, or a general-purpose 3D
  physics engine.
- Manual lamp placement in the editor.
- Arbitrary terrain hills outside the road elevation profile.
- Destructible bridge furniture.

The vertical dynamics boundary is intentionally reusable when ground and hill
layers are introduced later.

## Elevation Authority and Vehicle State

`elevationProfile.ts` remains the sole authority for road height and grade.
Normalized elevation continues to classify crossings and draw order, while
physical height is expressed in world units.

Every race vehicle gains explicit vertical state:

```ts
interface VehicleVerticalState {
  readonly z: number
  readonly verticalVelocity: number
  readonly grounded: boolean
  readonly suspensionCompression: number
  readonly landingIntensity: number
}
```

`z` is the underside of the vehicle above the ground plane, not a cosmetic
screen offset. A grounded vehicle follows the sampled driving surface. An
airborne vehicle follows its own ballistic trajectory. `landingIntensity`
decays after contact and drives camera and presentation feedback without
reconstructing an impact from render history.

The track context supplies physical road height, grade, tangent, lateral
distance, and whether the car is over the drivable ribbon. Off the bridge
ribbon, the landing surface returns to ground height. This permits a car that
clears a bridge wall to land in the surrounding terrain.

## Vertical Dynamics

A focused vertical integrator runs for every vehicle after horizontal movement:

1. Determine the road surface before and after the horizontal step.
2. While grounded, derive the surface's required vertical velocity from
   longitudinal speed and grade.
3. Use a damped suspension response to track that surface velocity.
4. At a crest, preserve upward momentum when the road falls away faster than
   the suspension can extend.
5. While airborne, integrate vertical velocity under gravity.
6. Land when the vehicle descends through the surface beneath it.

Takeoff depends on speed and the change in road slope. At low speed, the
suspension absorbs the transition and produces only a small compression/rebound
motion. At high speed, upward road velocity survives the crest and produces a
longer ballistic arc. Values are capped to avoid unstable or track-skipping
launches caused by noisy samples.

Suspension compression and landing force use critically damped, bounded values.
Landing does not teleport or rotate the vehicle. A hard landing briefly reduces
stability and contributes to camera shake.

## Horizontal Contact and Walls

The existing dynamic bicycle model receives a normalized tire-contact load.
Grounded contact supplies drive force, braking, and lateral tire forces.
Suspension unloading reduces those forces; airborne contact removes them almost
entirely while preserving aerodynamic drag and angular inertia. Steering or
braking in the air therefore cannot unrealistically redirect the car.

Bridge walls have a physical top height above the deck. The barrier solver
continues to contain grounded cars and low hops. It skips a wall only when the
car's underside has cleared the wall top, allowing a sufficiently fast jump to
leave the bridge. Once outside the ribbon, the car falls toward ground height
and uses normal off-road behavior after landing.

Vehicle-to-vehicle contacts continue to require compatible absolute heights,
not merely matching bridge-run identifiers.

## Day Bridge Presentation

Lighting constants define one shared 9 a.m. sun direction, shadow projection
scale, bridge face contrast, and softness. Renderers consume these constants
rather than inventing offsets independently.

Every bridge sample carries its physical height. The presentation derives:

1. a broad, low-alpha penumbra;
2. a tighter core shadow;
3. height-revealing side-face polygons on the sun-opposed edges;
4. supports projected from level deck sections to the ground;
5. the existing edge, road, markings, and guard walls.

Shadow displacement grows continuously from zero at the ramp foot to the full
deck offset. This makes ascent and descent visible and removes the current
floating ribbon with a constant 9-by-11 shadow. Side faces grow with the same
height profile, so long approaches read as ramps rather than recolored road.

Pillars remain restricted to level deck portions. Their ground endpoints and
shadows share the sun projection, and placement avoids lower-road conflict
zones.

## Vehicle Presentation

Vehicle bodies remain anchored to their physical horizontal coordinates so
visual steering and collision positions agree. Shadows are separate
presentation primitives projected from each car onto its receiving ground
plane:

- a grounded car has a tight contact shadow;
- a car on a bridge casts a longer directional ground shadow;
- an airborne car separates further from its shadow as `z` increases;
- shadow alpha and softness decrease with separation.

Shadows render in their own pass below bridge decks. Bodies use absolute
vertical height for lower/upper draw ordering, so a jumping car can pass above
a deck while its shadow remains below it. Landing compression slightly changes
the body silhouette for a few frames and adds bounded camera shake.

Headlights and taillights remain anchored to the visible body, never to the
projected shadow.

## Generated Lamp Posts

Lamp placement is derived from cached track geometry and is not persisted.
Posts are sampled by world distance rather than path index:

- normal track spacing is sparse and regular;
- bridge decks use denser spacing;
- sides alternate for normal stretches;
- bridge decks receive balanced edge coverage;
- posts are rejected near start grids, at-grade junction centers, conflicting
  lower roads, and places where adjacent posts would overlap on tight curves.

Posts sit beyond the road edge and therefore do not narrow the driving ribbon.
They are decorative in this iteration and do not add collision bodies.

During the day, posts render with a pole, lamp head, and small directional
shadow. At night, the same generated data produces warm pools on the road and a
subtle lamp glow. Bridge lamps also illuminate the nearest wall face.

## Night Rendering

Night presentation separates darkness and illumination into distinct passes:

- a normal-blend shade pass covers the rotated camera viewport without square
  edges;
- an additive light pass draws generated lamp pools, vehicle headlight cones,
  brake lights, and fixture glows.

Sun-cast bridge and vehicle shadows are disabled at night. Ambient bridge
occlusion remains under the deck, while lamps, lit wall faces, and headlights
communicate height. All lights remain in world coordinates and share the same
camera transform as the track.

## Responsibility Split

- `elevationProfile.ts`: physical road height and grade sampling.
- `vehicleVerticalDynamics.ts`: suspension, takeoff, gravity, and landing.
- `vehicleDynamics.ts`: tire forces scaled by contact load.
- `raceEngine.ts`: common vertical integration for player and AI vehicles.
- `bridgeBarriers.ts`: height-aware wall clearance.
- `lighting.ts`: shared sun and lamp presentation constants.
- `bridgeRenderer.ts`: height-derived shadows, faces, supports, and decks.
- `lampPostRenderer.ts`: deterministic placement and day/night primitives.
- `vehicleRenderer.ts`: separate vehicle body and projected shadow passes.
- `nightRenderer.ts`: separate shade and additive light geometry.
- `RaceScene.ts`: ordered graphics layers only.

## Safety and Recovery

All vertical input is clamped and normalized at the dynamics boundary. Missing
or non-finite legacy state initializes from the current road height. Resetting a
vehicle clears vertical velocity and places it on the sampled driving surface.

An airborne car that leaves a bridge retains the existing stuck recovery path
after it lands. Recovery does not trigger in mid-air. Degenerate paths fall
back to flat ground with no launch.

## Verification

- Pure dynamics tests cover low-speed suspension movement, fast crest takeoff,
  gravity, landing, invalid values, and contact-load output.
- Race integration tests cover player and AI vertical updates, reset behavior,
  absolute-height vehicle contacts, and clearing bridge walls.
- Presentation tests cover height-scaled shadows, ramp side faces, projected
  vehicle shadows, deterministic lamp spacing, bridge density, and exclusion
  zones.
- Night tests cover separate darkness/light passes and lamp pools without
  viewport-edge artifacts.
- Existing bridge, camera, physics, and rendering suites remain green.
- Final verification uses `npm run verify` and `git diff --check`.
