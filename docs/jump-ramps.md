# Directional jump ramps — delivery plan

## Contract

A Jump road structure is an authored ascending ramp with an abrupt high
lip. The next ordinary road starts at its local terrain elevation. Use the
existing bridge relative height in V1; ramp length sets inclination.
The ramp is a physical structure, not a speed boost or a visual-only effect.

Keep the existing deterministic 60 Hz XY and Z vehicle simulation. Phaser
Arcade and Matter are planar solvers; neither represents the independent
elevation coordinate and composed road support used here. Phaser remains
the presentation adapter for ramp meshes, shadows, cues and landing effects.

## Slices

1. **Takeoff physics foundation (this draft).** A grounded driver crossing
   an authored lip receives the lip height and positive travel grade in the
   vertical step. Convert actual longitudinal speed to vertical velocity,
   release tire contact and use existing ballistic flight and landing.
   No production caller emits the signal yet. Existing bridges behave as
   before. Keep this draft open through integration or review the foundation
   separately before merging; it does not expose a playable jump.
2. **Canonical structure and authoring.** Extend the road structure model,
   codec, editor paint/undo/redo, serialization, stable IDs and geometry
   cache. Audit all surface/overpass checks rather than treating Jump as
   Overpass. Preserve legacy saves; explicitly negotiate compatibility of
   jump-capable shared tracks with older peers instead of silently flattening
   a ramp. Geometry must expose both sides of a discontinuity; a sampled
   linear interpolation or centered finite difference across the lip must
   not fabricate a downhill approach. Reject empty, all-loop, too short,
   crossing-conflicted or unsupported jump placements with useful diagnostics.
3. **Playable vertical slice.** Detect swept crossing of the finite lip in
   the launch direction with prior grounded support and forward velocity.
   Pass the canonical lip height and travel grade to the vertical step;
   never emit for lateral exits, reverse motion or stale nearest-road
   samples. Distinguish intentional flight from bridge-fall recovery, retain
   water-contact, checkpoint order, landing and explicit recovery semantics.
   Verify road support, airborne tire unloading and safe recovery targets.
   Directional ramps stay physically fixed. Proposed V1: disallow reverse
   racing on a jump track, including imported tracks, with an explanation;
   don't mirror the structure dynamically or allow cars to teleport up the
   back face. Confirm this product choice before exposing the tool.
4. **Presentation.** Reuse the bridge ribbon/material/shadow builders with
   an explicit lip face and correct depth ordering. Avoid drawing a
   descending connecting triangle across the discontinuity. Editor shows
   the direction and a readable takeoff stripe; no per-frame static mesh
   generation. Reuse existing car height, landing intensity and effects.
5. **AI and release.** Use the existing AI optimization/tuning and lane
   checker tools for a representative straight ramp and varied approaches,
   all four cars, Hard first, then Medium/Easy. Measure pace, landings,
   recoveries and gate completion; no car speed cheat or track-specific
   production special cases. Verify ghosts and nearby peer compatibility,
   native frame pacing and visible jump cues before merge/release.

## Verification

Narrow domain tests for faster vs slower launch, landing, repeated events,
ordinary bridge fall, malformed lip signals; then authored profile/codec
round trips and editor command tests, race takeoff/recovery scenarios,
component render checks, deterministic AI lane and optimization runs and
the normal verify gate. Android visual/frame-pacing evidence is separate.

The first slice intentionally adds no persisted structure, new gameplay
setting, Phaser physics dependency or runtime jump trigger. Existing
track behavior is unchanged. Revert the foundation to remove the unused
takeoff input; later integration must include a migration/rollback review.
