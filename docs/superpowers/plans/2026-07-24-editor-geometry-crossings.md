# Editor Geometry and Crossings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make drawn roads smooth and economical, render real at-grade junctions, support contextual overpasses with crashable sides, and align the full starting grid to the start line.

**Architecture:** Keep stroke cleanup, crossing detection, bridge geometry, and barrier resolution as pure domain modules. Persist only the user's elevation choice; derive intersection and render geometry from the road path. Phaser renders prepared primitives, while the DOM editor chrome exposes the contextual choice through typed application/editor commands.

**Tech Stack:** TypeScript 7, Phaser 4, Vite 7, Vitest 3, jsdom, Biome.

## Global Constraints

- Keep strict TypeScript compatibility and explicit public shapes.
- Keep domain modules free of Phaser and DOM APIs.
- Preserve existing tracks by decoding missing elevation data as `[]`.
- Make every editor gesture one undo history entry.
- Default every crossing to a connected at-grade junction.
- Use the existing Select tool for crossing selection.
- Treat bridge sides as physical collision barriers.
- Implement each behavioral slice test-first.

---

### Task 1: Finalize freehand strokes and stabilize turns

**Files:**
- Modify: `src/domain/editor/editorGeometry.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `tests/domain/editorGeometry.test.ts`
- Modify: `tests/domain/editorCommands.test.ts`
- Modify: `tests/phaser/editorInput.test.ts`

**Interfaces:**
- Produces `finalizeDrawGesture(points, startIndex, zoom): readonly TrackPoint[]`.
- Adds `EditorCommand` variant `{ type: 'finalize-draw'; startIndex: number; zoom: number }`.
- `buildRoadPath()` keeps samples finite, forward-progressing, and bounded by normalized control spacing.

- [ ] **Step 1: Write failing tests**

Add tests proving a noisy straight 40-sample gesture becomes at most four
control points, a meaningful bend is retained, zoom changes screen tolerance
without changing world intent, and a clustered right-angle input produces
finite path samples without backward tangent reversals.

- [ ] **Step 2: Run the red tests**

Run:

```powershell
npm test -- tests/domain/editorGeometry.test.ts tests/domain/editorCommands.test.ts tests/phaser/editorInput.test.ts
```

Expected: FAIL because `finalizeDrawGesture` and `finalize-draw` do not exist.

- [ ] **Step 3: Implement stroke finalization**

Track the point count at pointer-down. On pointer-up dispatch
`finalize-draw` before `normalize-loop`. Simplify only the new suffix with a
zoom-aware Ramer-Douglas-Peucker pass, preserve heading changes above the
configured corner threshold, and normalize remaining gap lengths.

- [ ] **Step 4: Implement bounded path interpolation**

Replace the per-segment uniform Catmull-Rom blend with chord-length-aware
tangents capped to a fraction of neighboring chord lengths. Keep existing
surface and source-segment metadata on every sample.

- [ ] **Step 5: Run focused tests**

Run the command from Step 2 and `npm run typecheck`.

---

### Task 2: Derive and persist crossings

**Files:**
- Create: `src/domain/track/crossings.ts`
- Modify: `src/domain/model.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/infrastructure/storage/trackRepository.ts`
- Modify: `src/domain/track/starterTrack.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/application/race/raceSession.ts`
- Create: `tests/domain/crossings.test.ts`
- Modify: `tests/infrastructure/storage.test.ts`
- Modify: `tests/domain/editorCommands.test.ts`

**Interfaces:**
- Produces `TrackElevation`, `TrackCrossing`, `detectTrackCrossings(path, elevations)`, and `crossingKey(firstSegment, secondSegment)`.
- Editor state carries `elevations`.
- Adds editor command:

```ts
{
  readonly type: 'set-crossing-elevation'
  readonly firstSegment: number
  readonly secondSegment: number
  readonly upperSegment: number | null
}
```

- [ ] **Step 1: Write failing crossing and migration tests**

Cover perpendicular and skewed intersections, adjacency rejection,
near-parallel rejection, deduplication by source pair, default at-grade state,
both upper-branch choices, clearing to at grade, undo/redo, and decoding an old
track with `elevations: []`.

- [ ] **Step 2: Run the red tests**

Run:

```powershell
npm test -- tests/domain/crossings.test.ts tests/domain/editorCommands.test.ts tests/infrastructure/storage.test.ts
```

Expected: FAIL on missing types, detector, and command.

- [ ] **Step 3: Implement pure crossing detection**

Intersect non-adjacent sampled segments, group hits by ordered source-segment
pair, calculate branch tangents and the strip-intersection quadrilateral, then
apply a matching persisted elevation entry.

- [ ] **Step 4: Thread elevation state through storage and application**

Decode and normalize elevation entries, initialize old tracks with `[]`, carry
them through editor snapshots and saves, and pass them into race path creation.

- [ ] **Step 5: Run focused tests and typecheck**

Run the command from Step 2 and `npm run typecheck`.

---

### Task 3: Add contextual junction selection and presentation

**Files:**
- Modify: `src/application/appState.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Modify: `src/phaser/rendering/editorRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Create: `src/phaser/rendering/crossingRenderer.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/styles/components.css`
- Modify: `tests/phaser/editorInput.test.ts`
- Modify: `tests/phaser/trackPresentation.test.ts`
- Modify: `tests/ui/uiHost.test.ts`

**Interfaces:**
- `EditorUiState.selectedCrossing` stores a crossing key or `null`.
- Adds application command `{ type: 'select-editor-crossing'; key: string | null }`.
- Produces renderer-neutral `buildCrossingPresentation(path)` primitives for junction polygons, bridge shadows, supports, deck, markings, and sides.

- [ ] **Step 1: Write failing input, UI, and presentation tests**

Assert Select chooses a nearby crossing, ordinary point dragging still wins
when closer, the contextual panel renders only for a live selection, each
button emits the correct command, a flat junction produces a non-circular
quadrilateral, and an overpass produces ordered shadow/support/deck/side
primitives.

- [ ] **Step 2: Run the red tests**

Run:

```powershell
npm test -- tests/phaser/editorInput.test.ts tests/phaser/trackPresentation.test.ts tests/ui/uiHost.test.ts
```

Expected: FAIL because selection and presentation primitives are missing.

- [ ] **Step 3: Implement contextual selection and controls**

Detect crossing proximity in `EditorInputController`, route selection through
the application state, and render a semantic three-button contextual panel in
`editorChrome.ts`.

- [ ] **Step 4: Implement crossing layers**

Patch at-grade crossings after the base road to erase internal edges and
markings. For raised crossings draw shadow, supports, upper deck, center mark,
and side barriers in explicit order.

- [ ] **Step 5: Run focused tests, lint, and typecheck**

Run the command from Step 2, `npm run lint`, and `npm run typecheck`.

---

### Task 4: Enforce bridge-side collisions

**Files:**
- Create: `src/domain/race/bridgeBarriers.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Modify: `src/domain/race/collisions.ts`
- Modify: `src/application/race/raceSession.ts`
- Create: `tests/domain/bridgeBarriers.test.ts`
- Modify: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Produces `solveBridgeBarrier(previous, moved, path): BridgeBarrierResult`.
- Adds race event `{ type: 'barrier-collision'; vehicleId: string; strength: number }`.

- [ ] **Step 1: Write failing barrier tests**

Cover entry on the upper branch, free travel along the deck, projection inside
both side barriers, reflected lateral velocity, speed loss, one player damage
event per contact/cooldown, and no interaction for the lower branch.

- [ ] **Step 2: Run the red tests**

Run:

```powershell
npm test -- tests/domain/bridgeBarriers.test.ts tests/domain/raceSimulation.test.ts
```

Expected: FAIL because the barrier solver and event do not exist.

- [ ] **Step 3: Implement and integrate barrier resolution**

Resolve the upper-deck constraint immediately after vehicle movement and before
progress/vehicle collisions. Reuse the collision damage policy rather than
creating a second damage model. Route player barrier feedback through the
existing collision feedback event.

- [ ] **Step 4: Run focused tests and typecheck**

Run the command from Step 2 and `npm run typecheck`.

---

### Task 5: Align the starting grid and run final verification

**Files:**
- Modify: `src/domain/race/raceFactory.ts`
- Modify: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Produces `samplePathBehindStart(path, distance)` for world-space placement.

- [ ] **Step 1: Write the failing grid test**

Assert all four cars are within the configured longitudinal grid depth of the
start line, each `back` difference is measured in world units, and each lateral
offset matches its configured lane.

- [ ] **Step 2: Run the red test**

Run:

```powershell
npm test -- tests/domain/raceSimulation.test.ts
```

Expected: FAIL because `back` is currently treated as a sample count and lane
offset is ignored.

- [ ] **Step 3: Implement world-space grid placement**

Walk backward from the final path sample by accumulated distance, interpolate
within the containing sample pair, derive the tangent/normal, and apply the
lane offset.

- [ ] **Step 4: Run all verification gates**

Run:

```powershell
npm run verify
git diff --check
```

Expected: all tests, strict typecheck, lint, and production build pass with no
whitespace errors.

