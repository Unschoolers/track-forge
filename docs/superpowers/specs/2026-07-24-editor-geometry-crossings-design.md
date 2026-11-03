# Track Geometry and Crossings Design

**Date:** 2026-07-24  
**Status:** Approved

## Goals

- Reduce editor control-point noise without making freehand drawing feel sluggish.
- Produce predictable, smooth turns without Catmull-Rom loops or kinks caused by uneven control-point spacing.
- Render non-elevated self-crossings as connected, polygonal at-grade junctions.
- Let the user select a junction with the existing Select tool and choose either branch as elevated.
- Make elevation readable through a deck shadow, visible bridge sides, and restrained supports.
- Keep cars on an elevated deck; hitting a bridge side is a collision rather than an escape to grass or the lower road.
- Place every race vehicle relative to the start line in world-space units.

## Track Data

Tracks gain an `elevations` collection. Each entry identifies the two
intersecting source segments and which one is above:

```ts
export interface TrackElevation {
  readonly firstSegment: number
  readonly secondSegment: number
  readonly upperSegment: number
}
```

Crossings themselves are derived from the sampled road path. They are not
duplicated in storage. Old tracks decode with an empty elevation collection.
Malformed or stale elevation entries are discarded at the storage boundary.

## Editor Geometry

Pointer moves remain cheap and responsive, but a completed Draw gesture is
finalized as one operation:

1. remove near-duplicate samples;
2. simplify only points whose removal stays within a zoom-aware tolerance;
3. preserve corners with meaningful heading change;
4. resample long gaps to a bounded world-space interval;
5. close the loop only after finalization.

This replaces the current behavior where each qualifying pointer move becomes
a permanent control point. The whole gesture remains one undo entry.

The road path uses chord-length-aware interpolation and bounded tangents.
Control points are normalized before interpolation, so clusters cannot create
bulges and long/short transitions cannot produce sharp spline overshoot.

## Crossings

Crossings are intersections between non-adjacent path segments. Detection:

- ignores neighboring and wrap-neighbor segments;
- rejects shared endpoints and near-parallel overlaps;
- deduplicates multiple sampled intersections belonging to the same source
  segment pair;
- returns a stable key from the ordered source-segment pair;
- calculates the center, branch tangents, angle, and a bridge span.

At grade, the renderer fills the exact intersection polygon implied by the two
road strips. At a perpendicular crossing this is square; at other angles it is
a skewed quadrilateral. It is never circular. Internal road-edge strokes and
center markings are hidden inside the junction conflict area.

## Contextual Control

The existing Select tool selects a crossing when the pointer is closer to the
crossing than to a control point. A small contextual HTML panel appears near
the bottom of the editor with:

- `At grade`
- `Branch A above`
- `Branch B above`

Changing the setting is an editor command and participates in undo/redo.
Moving geometry so a crossing disappears also removes its effective elevation;
stale persisted entries are ignored.

## Elevated Presentation

The lower road remains in the normal track layer. The upper road is redrawn
over the crossing in this order:

1. soft offset shadow;
2. bridge supports beneath the deck;
3. deck edge and surface;
4. center marking;
5. solid side barriers.

The effect stays compatible with TrackForge's top-down presentation: it
communicates height without introducing a 3D camera or mesh pipeline.

## Vehicle Behavior

Bridge decks produce two side barrier segments. A vehicle that entered the
deck on its upper branch remains associated with that branch across the
crossing. If its body crosses a side barrier:

- its position is projected back inside the deck;
- outward lateral velocity is reflected and reduced;
- speed is reduced;
- a barrier collision event is emitted;
- player damage uses the existing impact cooldown and damage limit.

The lower and upper branches do not collide with one another at an elevated
crossing.

## Start Grid

Grid `back` values are world-space distances from the start line, not sampled
path indexes. Spawn positions are found by walking backward along the path by
that distance, then applying the configured lateral lane offset using the path
normal.

## Verification

- Pure domain tests cover simplification, turn bounds, crossing detection,
  elevation persistence, deck barriers, and start-grid placement.
- Renderer contract tests cover polygonal junctions and ordered bridge layers.
- Input and UI tests cover contextual selection and all three elevation
  choices.
- `npm run verify` and `git diff --check` are the final gates.

