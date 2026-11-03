# Track Geometry and Race Topology Design

## Status

Approved for inline implementation on `main` on 2026-07-24.

## Goal

Turn an authored TrackForge stroke into one authoritative, smooth, editable race
surface whose crossings, elevation, start grid, lap progression, AI, rendering,
and collision rules all agree.

## Product principles

- Drawing stays immediate, but pointer noise is simplified and normalized when
  the gesture ends.
- Smooth points produce fair, bounded curves. Corner points preserve intentional
  hard direction changes without producing renderer spikes.
- A crossing is a real junction by default. Either branch may be promoted to a
  bridge with visible approach ramps, shadow, supports, and containment walls.
- Cars on different heights neither collide nor visually overlap in the wrong
  order. Cars that hit a bridge wall take damage and recover on the correct
  branch.
- A lap only counts after the car traverses the ordered course sectors and then
  crosses the configured start line in the configured direction.
- Structural geometry conflicts are explained in the editor and repair actions
  are explicit; saving must not silently rewrite a creator's track. Sharp and
  needle-like turns are always valid creator choices.

## Architecture

### Authoring model

`TrackPoint` gains a stable id, a curve mode (`smooth` or `corner`), and a
bounded tension value. `Track` gains a start-line position and race direction.
The storage boundary upgrades older version-5 tracks by assigning deterministic
point ids and defaults while preserving coordinates, surfaces, trees, and
crossing choices.

Crossing elevation references use stable branch ids rather than depending only
on array indexes. During the compatibility window, persisted legacy segment
indexes are decoded and resolved to the corresponding point ids.

### Derived geometry

`TrackGeometry` is the sole derived representation consumed outside the track
domain. It contains:

- the center path and cumulative distances;
- left/right ribbon boundaries and surface runs;
- crossings found through a uniform-grid broad phase;
- an elevation profile along the path;
- the resolved start line and ordered sector gates;
- editor diagnostics.

`TrackGeometryService` caches geometry by an immutable track-shape signature.
Editing creates new arrays, so repeated render, hit-test, AI, validation, and
race calls share a result without stale mutable state.

### Curve and ribbon construction

Smooth segments use bounded cubic Hermite/Bezier tangents. Per-point tension
scales the tangent, and corner points contribute a zero tangent on the corner
side. The curve is sampled by arc length and normalized to near-uniform
spacing.

The road is rendered as filled ribbon quads from left/right boundaries, with
continuous join geometry. Curbs and markings use the same normals and distance
samples. Phaser line joins are not used to define the road silhouette.

### Crossings and elevation

Crossing detection indexes sample-segment bounding boxes into uniform cells,
tests only candidate pairs, rejects adjacent or shallow intersections, and
deduplicates by stable branch key.

An elevated branch has a continuous height profile: ground, approach ramp,
level deck, departure ramp, ground. The renderer is split into base road,
lower vehicles, bridge overlay, and upper vehicles. Shadows remain below the
deck; deck sidewalls remain above vehicles. Collision filtering uses the same
height function, and bridge containment is active only where meaningful height
exists.

### Race topology

Race state stores continuous distance-along-path, current elevation, and the
next required sector. Nearest-path tracking favors the previous branch and
rejects implausible teleports at crossings. Three ordered sector gates are
derived from the configured start distance. A forward start-line crossing only
increments the lap after all gates were crossed in order.

AI look-ahead, recovery, wrong-way detection, surface lookup, bridge barriers,
vehicle contacts, camera hints, and ranking all consume `TrackGeometry`.

### Editor UX

Selecting a crossing opens contextual controls using branch surface/direction
labels rather than abstract A/B. Selecting a point exposes smooth/corner,
tension, insert-before/after, and delete controls. A start-line tool places the
line on the nearest path and lets the creator reverse race direction. The
editor renders start-grid slots, bridge ramp extents, selected branch emphasis,
and actionable diagnostics.

## Compatibility and safety

- Runtime and persistence remain strict-TypeScript compatible.
- Version-5 tracks load without data loss and save as the new version.
- No automatic geometry repair occurs during load or save.
- The start line defaults to the existing path origin and forward direction.
- Existing flat crossings remain flat until explicitly elevated.
- All public input is normalized at the repository or command boundary.

## Acceptance criteria

1. A track is built once per unchanged shape and shared by rendering and race
   systems.
2. Road edges remain continuous through tight smooth turns with no radial
   ribbons or miter spikes.
3. At-grade crossings render as one coherent intersection.
4. Elevated crossings show ramps, deck, shadow, supports, and sidewalls.
5. Cars on different levels do not collide and render in the correct order.
6. Bridge walls contain cars on the elevated branch and recovery preserves the
   branch.
7. Shortcutting across the start line cannot complete a lap.
8. Start position, direction, and grid slots are editable and persisted.
9. Curve mode and tension are editable per point, including needle turns.
10. The editor reports shallow crossings, ramp conflicts, unsafe start
    placement, and scenery conflicts with explicit repair controls.
