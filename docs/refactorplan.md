# TrackForge Refactor Plan

## Shipped on 2026-07-24

- Strict TypeScript 7, Phaser 4, Vite, and modular DOM/CSS architecture.
- Version-6 track authoring metadata with lossless version-5 loading.
- Gesture simplification, normalized control spacing, bounded curve tangents,
  per-point curve mode/tension, and uniform center-path sampling.
- Cached `TrackGeometry` shared by editor rendering and race creation.
- Filled road-ribbon geometry instead of thick Phaser line joins.
- Spatially indexed crossings with contextual at-grade/bridge controls.
- Continuous bridge approaches, shadows, supports, sidewalls, layered vehicle
  rendering, elevation-aware contacts, and elevated-road containment.
- Configurable start line/direction with matching grid preview and race slots.
- Ordered sector gates that prevent start-line shortcut laps.
- Structural geometry diagnostics with explicit undoable repairs. Deliberately
  sharp or needle-like turns remain valid creator choices.
- Interrupted editor gestures are recoverable through undo/redo.
- Editor camera zoom and position survive tool, surface, selection, and history
  updates; Phaser scenes restart only for actual mode transitions.

## Follow-up backlog

- Split Phaser into a separately loaded Vite chunk; the production build is
  valid but currently reports a roughly 1.5 MB minified entry chunk.
- Add richer diagnostic focus/highlighting and additional discrete bridge
  or terrain levels only if stacked roads or multi-level terrain become product
  requirements. Version 8 intentionally supports one hill level, one relative
  overpass level, and flat water.
- Profile very large hand-drawn tracks and tune the geometry-cache capacity
  from production telemetry.

## Shipped on 2026-07-27

- Version-7 section elevation: every authored point owns the ground/overhead
  state of its outgoing road section.
- Elevation brush with gesture-level undo/redo and crossing shortcuts backed by
  the same section data.
- Automatic eased ramps and wrapped elevated-run derivation shared by editor,
  rendering, crossings, race depth, and physics.
- Continuous curved bridge shadows, supports, decks, markings, and side walls.
- Height-derived at-grade/overpass classification and long-deck containment.
- Repository-boundary migration from version-6 crossing elevation to stable
  section elevation.
- Audio-only per-car gearboxes: Yellow 5-speed, Blue 6-speed, Green 7-speed,
  and Red 8-speed, with progressively longer gears and shift hysteresis.
- Explicit continuous-audio lifecycle: pause, quit, restart, finish, channel
  disable, and teardown now fade engine and road sound immediately.
- Layered old-school engine synthesis with a low cylinder pulse, filtered
  mechanical noise, mild saturation, and noise-based road texture.
- Physical vehicle vertical state with suspension loading, speed-dependent
  bridge takeoff, gravity, airborne tire unloading, and landing feedback.
- Absolute-height collision separation and bridge walls that contain grounded
  cars while allowing sufficiently high airborne cars to clear the rail.
- Height-derived 9 a.m. bridge and vehicle shadows, ramp side faces, and
  separate lower/upper vehicle presentation.
- Deterministic track-wide lamp posts with denser bridge placement, day
  shadows, and split night shade/additive light passes.
- Central `vehiclePhysicsConfig.ts` authority for global tire/integration
  tuning, per-car chassis and performance, surfaces, terrain, suspension,
  gravity, jumps, and landing behavior.
- Contact-aware lateral stabilization makes normal road handling feel planted
  after steering release while deliberately retaining more slip during active
  steering and trail-braking.
- Closer race-camera framing with centralized initial, fixed, straight,
  high-speed, corner, clamp, and smoothing values.
- Shared day/night tree presentation on dedicated editor and race scenery
  layers below the road ribbon.

## Shipped on 2026-07-28

- Version-5/6 elevation compatibility is isolated to repository decoding;
  `TrackPoint.elevation` is now the only runtime bridge-authoring model.
- The continuous section bridge renderer is the sole authority for ramps,
  shadows, supports, decks, markings, walls, and elevated crossings.
- Editor mutations share one partial-snapshot patch path while preserving
  history limits, gesture coalescing, undo, and redo.

## Shipped on 2026-07-29

- Version-8 tracks persist a bounded, normalized sparse terrain grid: implicit
  base grass, one authored hill level, and mutually exclusive flat water.
- Repository decoding migrates version-7 `ground`/`overhead` section elevation
  to explicit `surface`/`overpass` structure intent, with current structure data
  taking precedence over legacy fields.
- One cached `TerrainSurface` compiler owns contours, material lookup, natural
  hill slopes, road-adjacent deformation, and world-coordinate terrain height.
- One composed `RoadSurface` authority adds the continuous relative structure
  profile to local terrain for crossings, rendering, physics, AI, barriers,
  shadows, lamps, diagnostics, and recovery.
- The editor paints Raise, Lower, Water, and Ground with centralized
  small/medium/large world-space brushes, immediate preview, cancellation
  safety, and one shared gesture-level undo/redo transaction.
- Overpasses render as solid continuous structures above local terrain, with
  receiving-terrain shadows and faces, dry-ground pillars, absolute-height
  containment, and safe over-water decks.
- Editor chrome is split into focused palette, context, history/frame, and
  selection builders while retaining one responsive desktop/mobile DOM and
  action path, 44-pixel targets, and safe-area-aware two-row controls.
- Player water contact is lethal, publishes one explicit `water` outcome,
  tears down continuous audio through the shared result lifecycle, and never
  records a lap-time score; AI water contact uses deterministic dry-road
  recovery.
- Live editor diagnostics report surface roads and scenery in water and offer
  explicit undoable repairs without silently changing authored content.
- Additional terrain heights, arbitrary structure levels, tunnels, and
  water-specific bridge supports remain future product work rather than hidden
  version-8 capabilities.
