# Runtime Reuse Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete runtime elevation model and duplicate bridge renderer while reducing `src/` below 11,986 lines without changing behavior.

**Architecture:** Keep version 5/6 crossing-elevation decoding private to the track repository and expose only version 7 per-section elevation. Use one partial-patch editor mutation helper and one continuous bridge renderer; crossing rendering owns at-grade junctions only.

**Tech Stack:** TypeScript 7 strict mode, Phaser 4, Vite 7, Vitest 3, Biome

## Global Constraints

- Preserve legacy saved-track migration at the repository boundary.
- Preserve undo/redo, gesture coalescing, at-grade junctions, continuous bridge presentation, walls, shadows, and bridge physics.
- Do not change gameplay, lighting, camera, audio, or vehicle tuning behavior.
- Finish below the 11,986-line `src/` baseline, targeting at least 250 removed production lines.
- Work inline on the current `main` checkout and preserve unrelated working-tree changes.

---

### Task 1: Reusable Editor Snapshot Patches

**Files:**
- Modify: `src/domain/editor/editorState.ts`
- Test: `tests/domain/editorCommands.test.ts`

**Interfaces:**
- Consumes: `EditorState`, `EditorSnapshot`, and the existing history/gesture state.
- Produces: `patchEditorState(state: EditorState, patch: Partial<EditorSnapshot>): EditorState`; `reduceEditor` uses this helper for every content mutation.

- [ ] **Step 1: Write the failing partial-patch test**

Import `patchEditorState` and add a test proving a point-only patch preserves
tree, elevation, and start identities while recording history:

```ts
it('merges partial editor patches through one history path', () => {
  const initial = createEditorState(
    square,
    [{ x: 50, y: 150 }],
    [],
    { ratio: 0.25, reversed: true },
  )
  const points = initial.points.map((point, index) =>
    index === 0 ? { ...point, x: 12 } : point,
  )

  const next = patchEditorState(initial, { points })

  expect(next.points).toBe(points)
  expect(next.trees).toBe(initial.trees)
  expect(next.elevations).toBe(initial.elevations)
  expect(next.start).toBe(initial.start)
  expect(next.history).toHaveLength(1)
})
```

- [ ] **Step 2: Verify the new contract fails**

Run:

```powershell
npm run test -- tests/domain/editorCommands.test.ts
```

Expected: FAIL because `patchEditorState` is not exported.

- [ ] **Step 3: Implement the reusable patch helper**

Replace `changed` with:

```ts
export function patchEditorState(
  state: EditorState,
  patch: Partial<EditorSnapshot>,
): EditorState {
  const content: EditorSnapshot = { ...snapshot(state), ...patch }
  if (state.gestureStart) {
    return {
      ...content,
      history: state.history,
      future: [],
      gestureStart: state.gestureStart,
      gestureChanged: true,
    }
  }
  return {
    ...content,
    history: [...state.history, snapshot(state)].slice(-50),
    future: [],
    gestureStart: null,
    gestureChanged: false,
  }
}
```

Convert reducer branches to pass only changed fields, for example:

```ts
return patchEditorState(state, { points })
return patchEditorState(state, { trees })
return patchEditorState(state, { start })
return patchEditorState(state, { points: [], trees: [], elevations: [] })
```

Keep invalid-command early returns, undo, redo, and gesture-end behavior intact.

- [ ] **Step 4: Verify editor behavior**

Run:

```powershell
npm run test -- tests/domain/editorCommands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review the slice**

Run:

```powershell
git diff --check -- src/domain/editor/editorState.ts tests/domain/editorCommands.test.ts
```

Expected: no output. Do not commit the implementation because the current
working tree contains the user's ongoing game changes.

---

### Task 2: Make Version 7 Section Elevation the Only Runtime Model

**Files:**
- Modify: `src/domain/model.ts`
- Modify: `src/infrastructure/storage/trackRepository.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `src/domain/track/crossings.ts`
- Modify: `src/domain/track/trackGeometry.ts`
- Modify: `src/domain/track/trackGeometryService.ts`
- Modify: `src/domain/track/starterTrack.ts`
- Modify: `src/application/library/trackLibraryService.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/phaser/rendering/editorRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: affected fixtures and tests under `tests/`
- Test: `tests/infrastructure/storage.test.ts`
- Test: `tests/domain/crossings.test.ts`
- Test: `tests/domain/editorCommands.test.ts`

**Interfaces:**
- Consumes: `TrackPoint.elevation`, repository input as `unknown`, and `elevationAt(path, index, position)`.
- Produces: `Track` without `elevations`; `buildRoadPath(points)`; `detectTrackCrossings(path)`; legacy saves still decoded into overhead `TrackPoint` sections.

- [ ] **Step 1: Write the failing boundary assertion**

Update the repository migration test to assert runtime and stored version 7
tracks do not expose the legacy property:

```ts
const migrated = repository.find(track.id)
expect(migrated?.version).toBe(7)
expect(migrated).not.toHaveProperty('elevations')
expect(migrated?.points[8]?.elevation).toBe('overhead')
expect(migrated?.points[2]?.elevation).toBe('ground')
```

Keep the input record's version 6 `elevations` array in raw storage data so the
test continues to exercise compatibility decoding.

- [ ] **Step 2: Verify the boundary assertion fails**

Run:

```powershell
npm run test -- tests/infrastructure/storage.test.ts
```

Expected: FAIL because decoded tracks currently include `elevations: []`.

- [ ] **Step 3: Privatize legacy decoding**

Remove `TrackElevation` from `src/domain/model.ts` and remove
`Track.elevations`. In `trackRepository.ts`, introduce the private boundary
shape:

```ts
interface LegacyTrackElevation {
  readonly firstSegment: number
  readonly secondSegment: number
  readonly upperSegment: number
}
```

Make `decodeElevation` return `LegacyTrackElevation | undefined`, preserve the
existing validation, migrate old upper segments into `TrackPoint.elevation`,
and omit `elevations` from the returned version 7 `Track`.

- [ ] **Step 4: Remove legacy data plumbing**

Apply these exact interface changes:

```ts
createEditorState(
  points?: readonly TrackPoint[],
  trees?: readonly Tree[],
  start?: TrackStart,
): EditorState

buildRoadPath(points: readonly TrackPoint[]): RoadPath

detectTrackCrossings(
  path: Pick<RoadPath, 'points' | 'closed' | 'totalLength'>,
): readonly TrackCrossing[]
```

Remove `elevations` from editor snapshots/history and delete the
`set-crossing-elevation` command branch. Update every caller to use points,
trees, and start only. Remove `elevations` from geometry cache signatures,
starter tracks, newly created tracks, controller comparisons, UI render state,
and test fixtures.

In crossing detection, delete `elevationByKey` and `legacyUpperSegment`; retain
height-derived `upperSegment` and `upperPathIndex`.

- [ ] **Step 5: Update focused behavior tests**

Delete the obsolete editor test for `set-crossing-elevation`. Keep
`set-crossing-sections`, undo/redo, and gesture tests.

Replace crossing calls such as:

```ts
detectTrackCrossings(path, [])
```

with:

```ts
detectTrackCrossings(path)
```

Delete the persisted-upper-branch unit test from `crossings.test.ts`; the
repository migration test now owns that compatibility contract. Keep the
section-height classification test.

- [ ] **Step 6: Verify the canonical model**

Run:

```powershell
npm run test -- tests/infrastructure/storage.test.ts tests/domain/crossings.test.ts tests/domain/editorCommands.test.ts tests/application/trackLibraryService.test.ts tests/domain/trackGeometry.test.ts
npm run typecheck
```

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 7: Review the slice**

Run:

```powershell
rg -n "TrackElevation|\.elevations\b|elevations:" src
git diff --check
```

Expected: no legacy elevation references under `src/`, except raw input access
inside `trackRepository.ts`; no whitespace errors.

---

### Task 3: Make the Continuous Bridge Renderer Authoritative

**Files:**
- Modify: `src/phaser/rendering/crossingRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Test: `tests/phaser/trackPresentation.test.ts`

**Interfaces:**
- Consumes: `RoadPath.crossings`, `TrackCrossing.polygon`, and `TrackCrossing.upperSegment`.
- Produces: `buildCrossingPresentation(path)` with at-grade `junction` primitives only; `bridgeRenderer` remains the sole producer of bridge shadows, supports, surfaces, markings, and walls.

- [ ] **Step 1: Write the failing renderer-authority test**

Replace the legacy local-bridge presentation test with:

```ts
it('leaves elevated crossings to the continuous bridge renderer', () => {
  const elevatedPoints = crossingPoints.map((point, index) =>
    index === 2 ? { ...point, elevation: 'overhead' as const } : point,
  )

  expect(
    buildCrossingPresentation(buildRoadPath(elevatedPoints)),
  ).toEqual([])
  expect(
    buildBridgePresentation(
      buildTrackGeometry({
        ...track,
        points: elevatedPoints,
      }),
    ).some((primitive) => primitive.kind === 'surface'),
  ).toBe(true)
})
```

- [ ] **Step 2: Verify duplicate rendering is exposed**

Run:

```powershell
npm run test -- tests/phaser/trackPresentation.test.ts
```

Expected: FAIL because `crossingRenderer` still emits local bridge primitives.

- [ ] **Step 3: Delete the local bridge presentation path**

Reduce `JunctionPrimitive` to:

```ts
export interface JunctionPrimitive {
  readonly kind: 'junction'
  readonly polygon: readonly Vector2[]
  readonly surface: SurfaceId
}
```

Make `buildCrossingPresentation` return a junction only when
`crossing.upperSegment === null`. Delete bridge tangent/normal/line helpers,
bridge colors, pass filtering, and the exported `renderBridgeDecks` and
`renderBridgeWalls` functions. Keep the polygon fill used by
`renderCrossingUnderlay`.

- [ ] **Step 4: Remove duplicate track-renderer calls**

Remove local bridge imports and calls from `trackRenderer.ts`.
`renderTrackGeometry`, `renderTrackGeometryBridgeOverlay`, and their base
functions must use only `bridgeRenderer` for bridge layers.

Delete `renderTrackBridgeOverlay` if `rg` confirms it has no callers. Retain
`renderTrack` only if it is called; otherwise remove it and its now-unused
legacy arguments as part of the same slice.

- [ ] **Step 5: Verify presentation behavior**

Run:

```powershell
npm run test -- tests/phaser/trackPresentation.test.ts tests/domain/crossings.test.ts tests/phaser/raceScene.test.ts tests/phaser/editorScene.test.ts
npm run typecheck
```

Expected: all affected tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Review the slice**

Run:

```powershell
rg -n "renderBridgeDecks|renderBridgeWalls|bridgeHalfLength" src/phaser
git diff --check
```

Expected: no duplicate crossing-local bridge functions and no whitespace
errors.

---

### Task 4: Final Verification and LOC Gate

**Files:**
- Modify: `docs/refactorplan.md`

**Interfaces:**
- Consumes: all completed refactor slices.
- Produces: verified strict TypeScript/Vite build and a documented shipped reuse consolidation.

- [ ] **Step 1: Align the refactor plan**

Move the legacy `TrackElevation` removal item from backlog to shipped work and
record that v7 section elevation and the continuous bridge renderer are now the
only runtime authorities.

- [ ] **Step 2: Run the full project gate**

Run:

```powershell
npm run verify
```

Expected: all Vitest tests pass; TypeScript, Biome, and Vite build pass.

- [ ] **Step 3: Run patch hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; status contains only intended refactor changes
plus preserved pre-existing user changes.

- [ ] **Step 4: Enforce the production LOC budget**

Run:

```powershell
$files = rg --files src | Where-Object { $_ -match '\.(ts|css|html)$' }
$lines = (
  $files |
    ForEach-Object { (Get-Content $_ | Measure-Object -Line).Lines } |
    Measure-Object -Sum
).Sum
"files=$($files.Count) lines=$lines removed=$(11986 - $lines)"
```

Expected: `lines` is below 11,986; target `removed` is at least 250.

- [ ] **Step 5: Inspect the final reuse diff**

Run:

```powershell
git diff --stat
git diff -- src/domain/model.ts src/domain/editor/editorState.ts src/domain/track/crossings.ts src/phaser/rendering/crossingRenderer.ts src/phaser/rendering/trackRenderer.ts src/infrastructure/storage/trackRepository.ts docs/refactorplan.md
```

Expected: the diff shows deleted parallel elevation/rendering paths rather than
syntax compression, with no unrelated behavior changes.
