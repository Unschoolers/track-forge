# Terrain Hills, Water, and Editor Design

**Date:** 2026-07-29  
**Status:** Approved

## Goals

- Make the map editor the primary production-quality creation surface.
- Let creators paint one raised hill level with simple Raise and Lower tools.
- Generate solid hill plateaus and approximately 45-degree natural slopes.
- Let ordinary roads follow terrain and preserve gravity, suspension, and jump
  behavior.
- Add flat water as a terrain material; entering it ends the player's race.
- Keep overpasses structurally separate from terrain so the world can express
  base ground, hill ground, and an overpass above a hill.
- Preserve mobile-first interaction, strict TypeScript, deterministic saves,
  and undo/redo.
- Improve reuse by replacing parallel height calculations with one composed
  terrain and road-surface authority.

## Non-Goals

- Multiple hill levels, arbitrary height sculpting, erosion, caves, tunnels,
  or water depth.
- Water currents, buoyancy, swimming, boats, or deformable terrain.
- A perspective camera or mesh-based 3D engine.
- Manually placed bridge supports or arbitrary structure heights.
- A general-purpose map-object system in this milestone.

## Chosen Approach

The terrain is a sparse, fixed-size grid. Default cells are level-zero grass
and are not persisted. Authored cells store either `hill` or `water`:

```ts
export const TERRAIN_KINDS = ['hill', 'water'] as const
export type TerrainKind = (typeof TERRAIN_KINDS)[number]

export interface TerrainCell {
  readonly column: number
  readonly row: number
  readonly kind: TerrainKind
}

export interface TerrainMap {
  readonly cellSize: number
  readonly cells: readonly TerrainCell[]
}
```

This was selected over polygon zones, which are harder to draw and edit on a
phone, and bitmap heightmaps, which add smoothing, serialization, and memory
complexity that a binary hill level does not need.

The grid is an authoring representation, not the visible geometry. A cached
terrain compiler derives continuous contours, slope bands, material lookup,
and height sampling. Rendering must not expose individual square cells.

## World Levels and Terrain Shape

All vertical constants live in one `WORLD_ELEVATION` configuration:

- terrain cell size: `32` world units;
- base terrain: `0`;
- hill plateau and overpass clearance: `24` world units per level;
- natural hill slope run: `24` world units, producing a 1:1 rise/run;
- road-adjacent slope run: `96` world units, limiting the authored terrain
  transition near a road to roughly 14 degrees.

The hill mask represents the full hill footprint. Height is zero at its
boundary, rises across the inward slope band, and becomes flat at the plateau.
Adjacent hill cells merge before contour generation, eliminating internal
seams.

Near the road ribbon, the compiled terrain surface widens the same boundary
transition. This is a terrain deformation, not a path-specific visual trick:
every consumer sees the same height at a world coordinate, including both
branches of a crossing. Away from roads, the terrain retains the natural
45-degree slope.

Water is always level zero. Painting water replaces a hill cell; raising a
water cell replaces water with hill. Lowering or painting Ground removes the
authored cell and returns it to default grass.

## Canonical Height Architecture

The current binary road `elevation` name is ambiguous once terrain exists.
Track schema version 8 replaces it with explicit structure intent:

```ts
export type RoadStructure = 'surface' | 'overpass'

export interface TrackPoint {
  // Existing fields...
  readonly structure?: RoadStructure
}
```

Version-7 `elevation: 'overhead'` migrates to `structure: 'overpass'`;
`ground` migrates to `surface`. The editor labels the existing road-elevation
tool as Structure and offers Surface and Overpass.

Height logic is split by responsibility but composed through one public
surface:

- `terrainField.ts`: normalized sparse cells and brush operations;
- `terrainSurface.ts`: cached contours, materials, and world-coordinate
  terrain height;
- `roadStructureProfile.ts`: continuous overpass runs and relative deck
  height;
- `roadSurface.ts`: absolute road height, grade, material, and structural
  clearance by composing terrain plus road structure.

`TrackGeometry` owns the compiled terrain surface and road-surface profile.
Editor rendering, race creation, AI, crossing classification, barriers,
vehicle vertical dynamics, shadows, lamps, and diagnostics receive the same
cached geometry. No renderer or physics module may independently reconstruct
terrain or deck height.

Crossings compare absolute composed road heights. Equal surface roads remain
an at-grade junction. An overpass is above the local terrain, including when
the terrain beneath it is already a hill.

## Terrain Rendering

Terrain renders below scenery and roads in ordered passes:

1. base grass;
2. flat water fill and shoreline;
3. hill cast shadow;
4. hill slope faces with light-direction shading;
5. hill plateau;
6. road-adjacent terrain deformation faces;
7. editor-only brush preview and contour emphasis.

The compiler produces reusable presentation polygons from merged cell
contours. The visible edge is smooth at the grid resolution and contains no
per-cell strokes. Hill shadows use the existing 9 a.m. world-lighting
direction. Water uses a subtle deterministic texture generated in code, not a
new bitmap asset, and remains flat in day and night modes.

Trees sample the terrain surface for presentation and shadow length. A tree
cannot be placed in water. Existing trees found in newly painted water remain
editable and receive a diagnostic repair action rather than being silently
deleted.

## Solid Overpasses and Underpasses

The existing continuous raised-road renderer becomes structure-aware:

- deck height is relative to local compiled terrain;
- shadows project onto the receiving terrain rather than an assumed zero
  plane;
- side faces extend from the deck to local terrain;
- pillars terminate at local terrain and are omitted in water unless a future
  water-support style is added;
- guard walls and collision clearance use absolute deck height;
- vehicles below and above compare absolute heights.

Surface roads entering water are not treated as bridges. The editor reports a
diagnostic and the race remains playable, but driving into the water is fatal.
An Overpass section may cross water safely when the vehicle is on its deck.

## Mobile-First Editor

The editor gains a Terrain tool. Its contextual dock provides:

- `RAISE`
- `LOWER`
- `WATER`
- `GROUND`
- small, medium, and large brush sizes

All interactive targets are at least 44 CSS pixels and respect safe-area
insets. The controls use two compact rows on narrow screens instead of
shrinking seven buttons onto one line.

Brush radii are `48`, `96`, and `160` world units. They are centralized with
the terrain constants rather than duplicated in UI and input code.

The existing editor chrome is split into focused reusable builders for the
tool palette, contextual dock, history/camera actions, selection panels, and
track actions. The tool palette uses two columns on short/mobile viewports so
the additional tool does not overflow vertically.

Dragging paints a world-space circular brush. Zoom does not change the
authored brush radius. A pointer gesture:

1. begins one editor transaction;
2. computes only cells newly entered by the brush;
3. updates an immediate terrain preview;
4. commits all touched cells as one undo entry on release or cancellation.

No-op strokes do not create history. A second pointer cancels painting before
camera interaction so accidental multi-touch cannot alter terrain.

The editor renderer shows the brush footprint, hill footprint, slope direction,
water shoreline, and affected road grade before a stroke is committed.

## Persistence and Boundaries

Tracks advance to version 8 and always expose a normalized `terrain` map.
Version 7 tracks load with an empty map. The repository:

- coerces integer row and column coordinates;
- rejects non-finite and out-of-range values;
- accepts only known terrain kinds;
- deduplicates cells by coordinate with last valid value winning;
- sorts cells deterministically;
- accepts at most `20,000` authored cells with row and column values between
  `-2,048` and `2,048`;
- migrates old road elevation to road structure;
- never persists default ground cells.

Terrain brush input is bounded by the same coordinate limits before it reaches
editor state. Corrupt or oversized terrain cannot allocate an unbounded grid.

## Water Crash Lifecycle

Terrain material is sampled at every vehicle's world position. A vehicle is in
water when:

- the compiled terrain material is `water`; and
- its underside is not safely above the water on an overpass deck.

Player water contact immediately:

- changes race phase to finished;
- records result outcome `water`;
- stops continuous audio through the existing result lifecycle;
- emits one crash feedback event;
- displays a water-crash result without recording a lap-time score.

AI water contact uses the existing recovery path and does not end the player's
race. Repeated contact is guarded so feedback and result publication happen
once.

`RaceResult` gains an explicit outcome (`finished`, `wrecked`, or `water`)
instead of inferring every terminal state from `playerWrecked`.

## Reuse and Refactoring Rules

- Extend `TrackGeometryService`; do not create a second terrain cache in the
  editor or race session.
- Replace `elevationProfile.ts` with explicit structure and composed-surface
  modules; do not leave compatibility aliases in runtime code.
- Reuse the editor's partial snapshot patch and gesture history path for
  terrain.
- Reuse one brush-to-cell helper for preview, mutation, and tests.
- Reuse the existing world-lighting projection for hills, structures, trees,
  and vehicle shadows.
- Reuse race result/audio teardown for water crashes.
- Split editor chrome by responsibility while keeping one DOM behavior path
  for mobile and desktop.
- Prefer deleting obsolete elevation plumbing over adding adapters around it.

## Verification

- Terrain domain tests cover normalization, merged cells, all brush modes,
  brush sizes, natural slopes, road-adjacent slopes, plateau height, water
  material, and cache invalidation.
- Storage tests cover v7-to-v8 migration, structure migration, malformed cells,
  bounds, deduplication, deterministic ordering, and round trips.
- Editor tests cover world-space brushes, preview parity, one-step undo/redo,
  no-op gestures, cancellation, multi-touch safety, and camera preservation.
- Presentation tests cover seam-free hill contours, 9 a.m. shadows, shorelines,
  day/night water, tree anchoring, local-terrain bridge faces, and pillars.
- Race tests cover uphill/downhill gravity, hill crests, absolute crossing
  height, safe over-water decks, player water termination, no score, AI
  recovery, and one-shot feedback/audio teardown.
- UI tests cover the two-row mobile dock, 44-pixel targets, active brush state,
  tool-palette fit, and desktop reuse.
- Final gates are `npm run verify`, `git diff --check`, and a production source
  LOC/reuse review to ensure the refactor did not introduce parallel systems.
