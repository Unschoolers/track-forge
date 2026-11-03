# Track Geometry and Race Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one cached, editable track geometry model that drives smooth ribbon rendering, real bridge elevation, reliable racing topology, and actionable editor diagnostics.

**Architecture:** Introduce a pure `TrackGeometry` builder and injected cache service, then migrate rendering and simulation consumers to it. Persist stable authoring metadata at the repository boundary and keep Phaser/UI code as adapters over domain commands and geometry.

**Tech Stack:** TypeScript strict mode, Phaser 4, Vite, Vitest, modular HTML/CSS.

## Global Constraints

- Continue inline on the current `main` checkout and preserve unrelated working-tree changes.
- Maintain strict TypeScript compatibility and normalize persisted input.
- Keep geometry, race rules, rendering, and UI responsibilities in focused modules.
- Existing version-5 tracks must load without losing authored content.
- No silent automatic repair of creator geometry.
- Run focused tests while iterating and `npm run verify` before completion.

---

### Task 1: Versioned authoring metadata

**Files:**
- Modify: `src/domain/model.ts`
- Modify: `src/infrastructure/storage/trackRepository.ts`
- Modify: `src/domain/track/starterTrack.ts`
- Modify: `src/application/library/trackLibraryService.ts`
- Test: `tests/infrastructure/storage.test.ts`

**Interfaces:**
- Produces: `TrackPoint.id`, `TrackPoint.curve`, `TrackPoint.tension`,
  `Track.start`, `TrackStart`, and version-6 normalized tracks.

- [ ] Add tests proving version-5 tracks receive deterministic point ids,
  smooth/default tension, and a forward start at distance ratio zero.
- [ ] Run `npm run test -- tests/infrastructure/storage.test.ts` and confirm the
  new expectations fail.
- [ ] Add the version-6 types and decode functions. Clamp tension to `0..1`,
  reject invalid start ratios, and generate ids for new points at the command
  boundary.
- [ ] Update starter/new-track factories to populate the fields explicitly.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Cached derived track geometry

**Files:**
- Create: `src/domain/track/trackGeometry.ts`
- Create: `src/domain/track/trackGeometryService.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `src/domain/track/crossings.ts`
- Test: `tests/domain/trackGeometry.test.ts`

**Interfaces:**
- Produces: `buildTrackGeometry(track): TrackGeometry`,
  `TrackGeometryService.get(track): TrackGeometry`, ribbon boundary samples,
  stable crossings, elevation samples, start line, and sector gates.

- [ ] Test cache identity for an unchanged track, invalidation for changed
  points/elevations/start, near-uniform samples, and stable crossing keys.
- [ ] Run the focused test and confirm missing interfaces fail.
- [ ] Extract path creation from crossing detection, add arc-length resampling,
  and build left/right ribbon boundaries from centered normals.
- [ ] Add a uniform-grid segment candidate index in `crossings.ts`; preserve
  exact narrow-phase intersection behavior.
- [ ] Implement an immutable signature cache with no Phaser dependency.
- [ ] Re-run the focused tests and typecheck.

### Task 3: Filled ribbon renderer

**Files:**
- Create: `src/phaser/rendering/roadRibbonRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Modify: `src/phaser/rendering/curbRenderer.ts`
- Delete after migration: `src/phaser/rendering/roadRuns.ts`
- Test: `tests/phaser/trackPresentation.test.ts`

**Interfaces:**
- Consumes: `TrackGeometry.ribbon`.
- Produces: `renderRoadRibbon(graphics, geometry, night)`.

- [ ] Add rendering-contract tests that assert filled surface polygons are used
  and each adjacent ribbon sample shares boundary vertices.
- [ ] Confirm the tests fail against line-stroke rendering.
- [ ] Render edge and surface quads in distance order, grouped by surface, with
  overlap sufficient to prevent hairline gaps.
- [ ] Move curbs and center markings to geometry normals/distances.
- [ ] Re-run focused presentation tests.

### Task 4: Continuous bridge height and layered rendering

**Files:**
- Create: `src/domain/track/elevationProfile.ts`
- Modify: `src/phaser/rendering/crossingRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Test: `tests/domain/crossings.test.ts`
- Test: `tests/phaser/renderingContracts.test.ts`

**Interfaces:**
- Produces: `elevationAtPathIndex(geometry, index): TrackElevationContext`.
- Produces: separate `renderTrackBase`, `renderBridgeDecks`, and
  `renderBridgeWalls` passes.

- [ ] Test zero height outside approaches, monotonic ramps, full deck height,
  and correct upper/lower branch classification.
- [ ] Implement a smoothstep ramp profile using crossing deck and approach
  extents.
- [ ] Split crossing drawing into shadow/support, deck, and sidewall passes.
- [ ] In `RaceScene`, draw base road, lower cars, deck, upper cars, then walls
  and effects.
- [ ] Re-run crossing and rendering tests.

### Task 5: Elevation-aware vehicle simulation

**Files:**
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/race/raceFactory.ts`
- Modify: `src/domain/race/trackContext.ts`
- Modify: `src/domain/race/collisions.ts`
- Modify: `src/domain/race/bridgeBarriers.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Modify: `src/domain/race/ai/aiDriver.ts`
- Test: `tests/domain/raceSimulation.test.ts`
- Test: `tests/domain/aiRaceIntegration.test.ts`

**Interfaces:**
- Consumes: `TrackGeometry` and its elevation profile.
- Produces: `RaceVehicle.pathDistance`, `RaceVehicle.elevation`, and
  branch-continuous nearest-path tracking.

- [ ] Test that vehicles on different levels do not contact, elevated cars hit
  sidewalls, recovery remains on the active branch, and AI does not switch
  branches at a crossing.
- [ ] Add local distance-window projection with direction continuity and a
  guarded global fallback for recovery.
- [ ] Filter car contacts by elevation separation and apply bridge barriers
  from the shared height profile.
- [ ] Migrate AI look-ahead, surface, and recovery to geometry distance.
- [ ] Re-run focused race and AI tests.

### Task 6: Sector-gated laps and direction

**Files:**
- Modify: `src/domain/race/progress.ts`
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/race/ranking.ts`
- Modify: `src/domain/race/raceFactory.ts`
- Test: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Produces: `RaceVehicle.nextSector`, directed `pathDistance`, and validated lap
  completion.

- [ ] Test ordered gates, skipped gates, reverse start-line traversal,
  wrap-around, and configured reverse racing.
- [ ] Resolve three gates at quarter-lap distances from the configured start.
- [ ] Advance sectors only through swept directed distance; increment a lap
  only when all sectors precede a forward start-line crossing.
- [ ] Rank unfinished cars by validated lap, sector, and directed distance.
- [ ] Re-run race tests.

### Task 7: Curve authoring controls

**Files:**
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/domain/editor/editorGeometry.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/phaser/rendering/editorRenderer.ts`
- Modify: `src/application/appState.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/styles/components.css`
- Test: `tests/domain/editorCommands.test.ts`
- Test: `tests/phaser/editorInput.test.ts`
- Test: `tests/ui/uiHost.test.ts`

**Interfaces:**
- Produces: selected point state and commands `set-point-curve`,
  `set-point-tension`, and `insert-point`.

- [ ] Test point selection, bounded tension updates, corner preservation,
  midpoint insertion, and undo/redo.
- [ ] Add command reducers that preserve stable ids and immutable history.
- [ ] Add contextual point controls and selected tangent/radius preview.
- [ ] Make pointer selection choose crossings first only inside their polygon;
  otherwise choose the nearest control point.
- [ ] Re-run editor and UI tests.

### Task 8: Editable start line and grid

**Files:**
- Modify: `src/domain/editor/editorGeometry.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/phaser/rendering/curbRenderer.ts`
- Modify: `src/phaser/rendering/editorRenderer.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Test: `tests/domain/editorCommands.test.ts`
- Test: `tests/phaser/editorInput.test.ts`

**Interfaces:**
- Produces: `set-track-start` and `reverse-track-direction` commands.

- [ ] Test nearest-path start placement, ratio normalization, direction
  reversal, persistence, and start-grid lane offsets.
- [ ] Add a start tool and contextual direction control.
- [ ] Render the start line and translucent grid preview at the resolved
  position/tangent.
- [ ] Use the same resolved slots in `raceFactory.ts`.
- [ ] Re-run focused editor and race tests.

### Task 9: Geometry diagnostics and explicit repairs

**Files:**
- Create: `src/domain/track/trackDiagnostics.ts`
- Modify: `src/domain/track/trackValidation.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/styles/components.css`
- Test: `tests/domain/trackValidation.test.ts`
- Test: `tests/domain/editorCommands.test.ts`

**Interfaces:**
- Produces: typed `TrackDiagnostic` values and `apply-track-repair` commands.

- [ ] Test shallow crossing, ramp overlap, start-at-crossing, and tree-on-road
  diagnostics with stable affected ids. Never flag turn sharpness.
- [ ] Implement pure analyzers over `TrackGeometry`.
- [ ] Add explicit repairs for smoothing a point, flattening a bridge, moving
  the start to the nearest safe distance, and removing/moving scenery.
- [ ] Render a severity-sorted diagnostic panel with focus and repair actions.
- [ ] Re-run focused validation/editor tests.

### Task 10: Composition, verification, and visual audit

**Files:**
- Modify: `src/main.ts`
- Modify: `src/phaser/sceneHost.ts`
- Modify: `docs/refactorplan.md`

**Interfaces:**
- Consumes: `TrackGeometryService`.
- Produces: one application-scoped geometry service injected into editor and
  race adapters.

- [ ] Wire one geometry service through the composition root.
- [ ] Search for remaining direct `buildRoadPath` calls outside track geometry
  tests/domain internals and migrate them.
- [ ] Run `npm run verify`; require strict typecheck, lint, all tests, and Vite
  build to pass.
- [ ] Run `git diff --check`.
- [ ] Launch with `npm run dev -- --host 127.0.0.1`, inspect a tight-turn track,
  a flat crossing, and both elevated branch choices at desktop and mobile
  viewport sizes.
- [ ] Record shipped work and remaining follow-ups in `docs/refactorplan.md`.
