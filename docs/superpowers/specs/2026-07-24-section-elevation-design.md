# Section-Based Road Elevation Design

**Date:** 2026-07-24  
**Status:** Approved

## Goals

- Make elevation a general road property rather than a crossing-only effect.
- Let an author paint any road section as ground or overhead.
- Join adjacent overhead sections into a continuous bridge of arbitrary length.
- Add smooth ramps automatically only where a bridge leaves or rejoins ground.
- Keep elevated vehicles on the deck with continuous side-wall collisions.
- Derive crossing behavior from the roads' actual heights.
- Preserve elevation when curves are resampled or control points are moved.

## Authoring Model

Each authored control point owns the road section from that point to the next
control point. The section stores one of two levels:

```ts
export type RoadElevation = 'ground' | 'overhead'

export interface TrackPoint {
  // Existing point fields...
  readonly elevation?: RoadElevation
}
```

An omitted value means `ground`, keeping legacy tracks compact and compatible.
For a closed track, the last unique control point owns the closing section back
to the first point. The duplicated closing point, when present in editor input,
mirrors the first point and does not create a second independently authored
section.

Elevation belongs to authored sections, not generated path samples. The path
builder copies the owning point's stable id and elevation onto every resampled
point. Curve edits, spacing changes, and renderer sampling therefore cannot
shift an elevated stretch onto an unrelated piece of road.

The crossing-specific `TrackElevation` collection becomes legacy migration
input rather than the source of truth. New tracks use section elevation.

## Elevated Runs and Ramps

The geometry layer groups consecutive overhead sections into elevated runs.
Runs may wrap across the start of a closed track. A run contains:

- stable start and end section ids;
- its distance interval along the path;
- an automatically calculated ramp-in interval;
- a level deck interval;
- an automatically calculated ramp-out interval.

Ramp length is derived from road width and capped by available run length.
When a run is too short for two full ramps, both ramps shorten symmetrically
and meet smoothly. Height uses an eased interpolation with zero slope at the
ground and deck boundaries, avoiding a visible or physical step.

`elevationAt` becomes the single height authority for rendering, crossings,
vehicle ordering, lighting, AI context, and collision. It returns continuous
height plus the stable elevated-run id.

## Editor Interaction

The editor gains an Elevation tool with two choices:

- `Ground`
- `Overhead`

Pressing or dragging over the road paints the nearest authored section. A
gesture may cover many sections but creates one undo entry. The renderer shows
the affected section and its automatic ramp boundaries immediately.

Crossing selection remains as a convenience:

- `At grade` paints both involved sections as ground;
- `Branch A above` paints branch A overhead and branch B ground;
- `Branch B above` paints branch B overhead and branch A ground.

These controls dispatch the same section-paint commands as the elevation tool;
there is no separate crossing elevation state to drift out of sync.

## Crossing Semantics

Crossings compare the continuous height of both branches at their intersection:

- effectively equal heights produce an at-grade polygonal junction;
- different heights produce an overpass, with the higher road uninterrupted;
- a branch inside a ramp uses its interpolated height;
- near-equal ramp crossings remain at grade to avoid paper-thin visual
  separation and ambiguous collision behavior.

The crossing detector remains responsible for planar intersection geometry.
It no longer chooses elevation from `TrackElevation`; it samples the shared
elevation profile for both crossing branches.

## Rendering

Bridge rendering follows the actual curved road ribbon rather than drawing a
straight crossing-local stroke. Each elevated run is rendered in ordered
passes:

1. a soft, consistently offset shadow following the whole raised ribbon;
2. pillars beneath level portions at regular world-space spacing;
3. ramp and deck edge ribbons;
4. the road surface and its markings;
5. continuous side walls where the deck has cleared the ground.

Ramps retain ordinary road edges while their height is too low for a wall.
Walls fade or begin only after a small clearance threshold. Pillars are skipped
inside ramps and near crossing conflict zones where they would visually block
the lower road.

The normal road pass omits elevated run samples after the ramp begins, avoiding
double-painted edges and markings. At-grade junction fill is drawn only where
both branches are at the same effective height.

## Vehicle and Collision Behavior

Vehicle height is sampled from its current path position. The same value drives:

- visual depth at crossings;
- whether two vehicles can collide across different road levels;
- headlight and shadow placement;
- bridge-wall activation.

Once the deck clears the configured threshold, both ribbon edges become solid
barriers. Barrier resolution uses the nearest path tangent and normal at the
vehicle, so it works along long curves rather than only around a crossing.
Impact response keeps the current projection, reflected lateral velocity,
speed loss, damage cooldown, and feedback behavior.

The ramp itself remains drivable and has no artificial side collision beyond
the ordinary road boundary until the walls begin.

## Persistence and Migration

Tracks advance to a new schema version. The repository validates section
elevation at the storage boundary and normalizes unknown values to `ground`.

When loading a crossing-elevation track:

1. decode and normalize point ids;
2. map each legacy upper segment to its owning authored section;
3. mark that section overhead;
4. merge adjacent migrated sections naturally through run derivation;
5. discard the crossing-specific collection when the upgraded track is saved.

Malformed or stale crossing entries remain harmless. Existing ground-only
tracks load without visual changes.

## Responsibility Split

- `model.ts`: public section-elevation type and schema version.
- `pathBuilder.ts`: preserve source section identity and elevation in samples.
- `elevationProfile.ts`: derive runs, ramps, height, and crossing comparison.
- editor state/input/UI: elevation painting and crossing shortcuts.
- bridge presentation renderer: curved ribbons, shadows, pillars, and walls.
- bridge barrier solver: continuous elevated-run wall collision.
- repository: validation and legacy migration.

This keeps authoring, derived geometry, presentation, and physics separate while
giving every consumer one elevation profile.

## Verification

- Domain coverage validates wrapped runs, automatic ramps, short runs,
  continuous height, and crossing height classification.
- Editor coverage validates drag painting and single-step undo/redo.
- Storage coverage validates legacy migration and malformed elevation input.
- Renderer contracts validate long curved bridges, ordered passes, and walls.
- Race coverage validates continuous wall collision and separated crossing
  levels.
- `npm run verify` and `git diff --check` remain the final gates.
