# Terrain Hills and Water Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first binary hill and flat-water editor backed by one reusable terrain/road-height pipeline, solid local-terrain overpasses, and fatal player water contact.

**Architecture:** Track v8 persists a normalized sparse terrain field and explicit road structures. `RoadPath` owns cached compiled terrain and composed road-surface profiles so editor rendering, race physics, AI, crossings, structures, and diagnostics consume the same height/material authority.

**Tech Stack:** TypeScript 7 strict mode, Phaser 4, Vite 7, Vitest 3, Biome, modular DOM/CSS

## Global Constraints

- Terrain has one hill level only; water is flat and has no depth.
- Cell size is 32 world units; level height is 24; natural slope run is 24; road-adjacent slope run is 96.
- Brush radii are 48, 96, and 160 world units.
- Persist at most 20,000 authored cells with row/column bounds from -2,048 through 2,048.
- Default ground cells are never persisted.
- Player water contact ends the race; AI water contact recovers.
- Existing v7 `ground`/`overhead` data must migrate to v8 `surface`/`overpass`.
- Mobile targets are at least 44 CSS pixels and respect safe-area insets.
- Reuse the existing geometry cache, editor gesture history, world lighting, and race-result lifecycle.
- Work on the current `main` checkout and preserve unrelated changes.

---

### Task 1: Sparse Terrain Domain and Brush Operations

**Files:**
- Create: `src/domain/terrain/terrainField.ts`
- Modify: `src/domain/model.ts`
- Modify: `src/domain/config.ts`
- Create: `tests/domain/terrainField.test.ts`

**Interfaces:**
- Produces: `TerrainKind`, `TerrainCell`, `TerrainMap`, `EMPTY_TERRAIN`, `normalizeTerrain`, `terrainCellKey`, `cellsInBrush`, and `paintTerrain`.
- Later tasks consume a normalized, deterministically sorted sparse terrain map.

- [ ] **Step 1: Write failing terrain-field tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  cellsInBrush,
  EMPTY_TERRAIN,
  normalizeTerrain,
  paintTerrain,
} from '@/domain/terrain/terrainField'

describe('terrain field', () => {
  it('normalizes bounds, kinds, duplicates, and deterministic order', () => {
    expect(normalizeTerrain({
      cellSize: 999,
      cells: [
        { column: 2, row: 1, kind: 'hill' },
        { column: 2, row: 1, kind: 'water' },
        { column: Number.NaN, row: 0, kind: 'hill' },
      ],
    })).toEqual({
      cellSize: 32,
      cells: [{ column: 2, row: 1, kind: 'water' }],
    })
  })

  it('paints circular raise, water, and ground brushes immutably', () => {
    const cells = cellsInBrush({ x: 16, y: 16 }, 48)
    const hill = paintTerrain(EMPTY_TERRAIN, cells, 'hill')
    const water = paintTerrain(hill, cells, 'water')
    const ground = paintTerrain(water, cells, 'ground')
    expect(hill.cells.every((cell) => cell.kind === 'hill')).toBe(true)
    expect(water.cells.every((cell) => cell.kind === 'water')).toBe(true)
    expect(ground).toEqual(EMPTY_TERRAIN)
  })
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- tests/domain/terrainField.test.ts`  
Expected: FAIL because `terrainField.ts` does not exist.

- [ ] **Step 3: Add terrain types and centralized constants**

Add to `model.ts`:

```ts
export const TERRAIN_KINDS = ['hill', 'water'] as const
export type TerrainKind = (typeof TERRAIN_KINDS)[number]
export type TerrainBrushKind = TerrainKind | 'ground'
export type RoadStructure = 'surface' | 'overpass'

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

Add the terrain and structure types without changing `Track` or `TrackPoint`
yet; the boundary migration happens atomically in Task 2 so this task remains
independently type-safe.

Add `WORLD_ELEVATION` and `TERRAIN_LIMITS` to `config.ts` with the exact values
from Global Constraints.

- [ ] **Step 4: Implement normalized brush operations**

`normalizeTerrain` must coerce integer coordinates, reject unknown kinds and
out-of-bounds cells, keep the last valid coordinate value, cap at 20,000, and
sort by row then column. `cellsInBrush` must test cell centers against the
world-space radius. `paintTerrain` must reuse unchanged objects and return the
original map for a no-op.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test -- tests/domain/terrainField.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/terrain/terrainField.ts src/domain/model.ts src/domain/config.ts tests/domain/terrainField.test.ts
git commit -m "feat: add sparse terrain domain"
```

---

### Task 2: Version-8 Persistence and Road-Structure Migration

**Files:**
- Modify: `src/infrastructure/storage/trackRepository.ts`
- Modify: `src/domain/track/starterTrack.ts`
- Modify: `src/application/library/trackLibraryService.ts`
- Modify: affected typed fixtures under `tests/`
- Modify: `tests/infrastructure/storage.test.ts`

**Interfaces:**
- Consumes: `normalizeTerrain` and v7 raw JSON.
- Produces: every repository `Track` as version 8 with normalized terrain and `structure`.

- [ ] **Step 1: Write the failing migration test**

Inject raw v7 JSON into the in-memory store:

```ts
storage.values.set('trackforge-library-v2', JSON.stringify([{
  ...createStarterTrack(asTrackId('terrain-migration'), 1),
  version: 7,
  terrain: undefined,
  points: [
    { x: 0, y: 0, surface: 'street', elevation: 'overhead' },
    { x: 100, y: 0, surface: 'street', elevation: 'ground' },
  ],
}]))

const migrated = repository.find(asTrackId('terrain-migration'))
expect(migrated).toMatchObject({ version: 8, terrain: { cellSize: 32, cells: [] } })
expect(migrated?.points[0]?.structure).toBe('overpass')
expect(migrated?.points[0]).not.toHaveProperty('elevation')
```

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- tests/infrastructure/storage.test.ts`  
Expected: FAIL because runtime tracks are still version 7 and expose elevation.

- [ ] **Step 3: Implement boundary migration**

Decode `structure` when it is `surface` or `overpass`. Otherwise migrate
`elevation === 'overhead'` to `overpass` and all other values to `surface`.
Normalize `item.terrain` through `normalizeTerrain`. Starter and newly created
tracks must use:

```ts
version: 8,
terrain: EMPTY_TERRAIN,
```

Remove all runtime `RoadElevation` and `elevation` property plumbing.
Change `Track.version` to `8`, add `terrain: TerrainMap`, and replace
`TrackPoint.elevation` with `structure?: RoadStructure`.

- [ ] **Step 4: Update typed fixtures and verify**

Run:

```powershell
npm run test -- tests/infrastructure/storage.test.ts tests/application/trackLibraryService.test.ts
npm run typecheck
```

Expected: PASS with no strict TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/infrastructure/storage/trackRepository.ts src/domain/model.ts src/domain/track/starterTrack.ts src/application/library/trackLibraryService.ts tests
git commit -m "feat: migrate tracks to terrain schema v8"
```

---

### Task 3: Compiled Terrain and Canonical Road Surface

**Files:**
- Create: `src/domain/terrain/terrainSurface.ts`
- Create: `src/domain/track/roadStructureProfile.ts`
- Create: `src/domain/track/roadSurface.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `src/domain/track/crossings.ts`
- Modify: `src/domain/track/trackGeometry.ts`
- Modify: `src/domain/track/trackGeometryService.ts`
- Delete: `src/domain/track/elevationProfile.ts`
- Create: `tests/domain/terrainSurface.test.ts`
- Modify: `tests/domain/trackGeometry.test.ts`
- Modify: `tests/domain/crossings.test.ts`

**Interfaces:**
- Produces: `TerrainSurface.heightAt(position)`, `materialAt(position)`, contour data, `RoadSurfaceProfile.at(pathIndex, position)`, and `gradeAt(pathIndex)`.
- `RoadPath` exposes readonly `terrainSurface` and `roadSurface`; all height consumers use them.

- [ ] **Step 1: Write failing composition tests**

```ts
it('composes terrain and overpass into three absolute levels', () => {
  const terrain = paintTerrain(
    EMPTY_TERRAIN,
    [{ column: 0, row: 0 }],
    'hill',
  )
  const geometry = buildTrackGeometry({
    points: [
      { x: 16, y: 16, surface: 'street', structure: 'overpass' },
      { x: 160, y: 16, surface: 'street', structure: 'surface' },
    ],
    terrain,
  })
  expect(geometry.path.terrainSurface.heightAt({ x: 16, y: 16 })).toBe(24)
  expect(geometry.path.roadSurface.at(0).height).toBe(48)
})

it('keeps road-adjacent terrain slopes gentler than natural slopes', () => {
  const surface = compileTerrainSurface(terrain, roadPath)
  expect(surface.gradeAt({ x: 16, y: 16 }, 'natural')).toBeCloseTo(1)
  expect(surface.gradeAt({ x: 16, y: 16 }, 'road')).toBeLessThan(0.27)
})
```

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- tests/domain/terrainSurface.test.ts tests/domain/trackGeometry.test.ts`  
Expected: FAIL because the compiled surface and composition do not exist.

- [ ] **Step 3: Implement cached terrain compilation**

Compile a coordinate lookup, merged hill/water masks, signed boundary distance,
road-distance lookup, and presentation contours. Height is:

```ts
const slopeRun = distanceToRoad <= ROAD_GEOMETRY.edgeWidth
  ? WORLD_ELEVATION.roadSlopeRun
  : WORLD_ELEVATION.naturalSlopeRun
const height = clamp(distanceInsideHill / slopeRun, 0, 1) *
  WORLD_ELEVATION.levelHeight
```

Water material lookup is independent of height and always returns height zero.
Cache by terrain and center-path identity with `WeakMap`.

- [ ] **Step 4: Extract and compose road structure**

Move run derivation and smootherstep from `elevationProfile.ts` into
`roadStructureProfile.ts`, replacing overhead checks with
`structure === 'overpass'`. `roadSurface.ts` returns:

```ts
export interface RoadSurfaceSample {
  readonly terrainHeight: number
  readonly structureHeight: number
  readonly height: number
  readonly grade: number
  readonly material: 'grass' | 'water'
  readonly structureRunId: string | null
}
```

Absolute height equals terrain height plus relative structure height.

- [ ] **Step 5: Make `RoadPath` the shared authority**

`buildRoadPath(points, terrain)` builds center samples, compiles terrain,
composes road surface, then detects crossings using absolute surface samples.
Update `TrackGeometry`, its cache signature, editor call sites, and tests.
Delete `elevationProfile.ts` and eliminate its imports.

- [ ] **Step 6: Verify the domain slice**

Run:

```powershell
npm run test -- tests/domain/terrainSurface.test.ts tests/domain/trackGeometry.test.ts tests/domain/crossings.test.ts tests/domain/vehicleVerticalDynamics.test.ts
npm run typecheck
```

Expected: PASS; `rg -n "RoadElevation|elevationAt|roadHeightAt|roadGradeAt" src`
returns no runtime compatibility plumbing.

- [ ] **Step 7: Commit**

```powershell
git add src/domain/terrain src/domain/track tests/domain
git commit -m "refactor: compose terrain and road surface height"
```

---

### Task 4: Terrain Editor State, Preview, and Input

**Files:**
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/domain/editor/editorGeometry.ts`
- Modify: `src/application/appState.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Create: `tests/domain/terrainEditor.test.ts`
- Modify: `tests/phaser/editorInput.test.ts`
- Modify: `tests/application/appController.test.ts`

**Interfaces:**
- Produces: Terrain in `EditorSnapshot`; command `paint-terrain`; UI state `terrainBrush`; `EditorInputController.terrainPreview()`.
- Consumes: `cellsInBrush` and `paintTerrain`.

- [ ] **Step 1: Write failing editor transaction tests**

```ts
it('commits a dragged terrain stroke as one undo step', () => {
  let state = reduceEditor(createEditorState([], [], undefined, EMPTY_TERRAIN), {
    type: 'begin-gesture',
  })
  state = reduceEditor(state, {
    type: 'paint-terrain',
    cells: [{ column: 0, row: 0 }, { column: 1, row: 0 }],
    kind: 'hill',
  })
  state = reduceEditor(state, { type: 'end-gesture' })
  expect(state.terrain.cells).toHaveLength(2)
  expect(state.history).toHaveLength(1)
  expect(reduceEditor(state, { type: 'undo' }).terrain).toEqual(EMPTY_TERRAIN)
})
```

Add input coverage asserting world-space brush cells do not change with zoom,
a second pointer cancels painting, and repeated samples do not dispatch
duplicate cells.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- tests/domain/terrainEditor.test.ts tests/phaser/editorInput.test.ts`  
Expected: FAIL because terrain commands and preview do not exist.

- [ ] **Step 3: Extend reusable editor snapshots**

Add `terrain` to `EditorSnapshot`, `createEditorState`, partial patch history,
controller persistence, track selection, clear, expand, undo, and redo.
`paint-terrain` calls the shared `paintTerrain` helper and returns the original
state for a no-op.

Preserve the existing positional arguments and append terrain:

```ts
createEditorState(
  points?: readonly TrackPoint[],
  trees?: readonly Tree[],
  start?: TrackStart,
  terrain?: TerrainMap,
): EditorState
```

- [ ] **Step 4: Add terrain and structure UI state**

Replace `editorUi.elevation` with:

```ts
readonly structure: RoadStructure
readonly terrainBrush: {
  readonly kind: TerrainBrushKind
  readonly radius: 48 | 96 | 160
}
```

Rename the editor tool `elevation` to `structure` and add `terrain`.

- [ ] **Step 5: Implement input preview and gesture commit**

During a terrain gesture, accumulate unique cells in an internal map and expose
the current world position, radius, cells, and brush kind through
`terrainPreview()`. Dispatch one `paint-terrain` batch before `end-gesture`.
Cancel the pending terrain batch when another pointer arrives.

- [ ] **Step 6: Verify editor behavior**

Run:

```powershell
npm run test -- tests/domain/terrainEditor.test.ts tests/domain/editorCommands.test.ts tests/phaser/editorInput.test.ts tests/application/appController.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/domain/editor src/application src/phaser/input src/phaser/scenes/EditorScene.ts tests/domain/terrainEditor.test.ts tests/phaser/editorInput.test.ts tests/application/appController.test.ts
git commit -m "feat: add undoable terrain editor input"
```

---

### Task 5: Terrain Presentation and Solid Structure Rendering

**Files:**
- Create: `src/phaser/rendering/terrainRenderer.ts`
- Modify: `src/phaser/rendering/bridgeRenderer.ts`
- Modify: `src/phaser/rendering/treeRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Modify: `src/phaser/rendering/lampPostRenderer.ts`
- Modify: `tests/phaser/trackPresentation.test.ts`
- Modify: `tests/phaser/renderingContracts.test.ts`

**Interfaces:**
- Produces: terrain primitives and render passes derived only from compiled `TerrainSurface`.
- Bridge presentation consumes absolute road samples and local receiving terrain.

- [ ] **Step 1: Write failing presentation tests**

Assert:

```ts
expect(buildTerrainPresentation(geometry).map(({ kind }) => kind))
  .toEqual(expect.arrayContaining([
    'water', 'shoreline', 'hill-shadow', 'hill-slope', 'hill-plateau',
  ]))
expect(buildTerrainPresentation(geometry).some(
  (primitive) => primitive.kind === 'cell-outline',
)).toBe(false)
```

Add an overpass-on-hill test asserting deck height 48, side faces terminate at
terrain height 24, and pillars terminate at local terrain.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts tests/phaser/renderingContracts.test.ts`  
Expected: FAIL because terrain primitives and local-terrain structure faces do not exist.

- [ ] **Step 3: Implement cached terrain primitives**

Build polygons from compiled merged contours. Render water texture and
shoreline, hill shadows through `projectSunShadow`, shaded slope faces,
plateaus, and editor brush preview. Do not render grid-cell borders.

- [ ] **Step 4: Refactor scene render ordering**

Create dedicated terrain graphics below scenery in editor and race scenes.
Render terrain, terrain-anchored trees, road base, structure underlay/deck/walls,
vehicles, lamps, effects, and night passes in that order.

- [ ] **Step 5: Make structures local-terrain aware**

Replace normalized-zero-ground calculations in bridge, lamp, tree, vehicle
shadow, and layer thresholds with composed absolute road samples and local
terrain samples. Use `WORLD_ELEVATION.levelHeight`, removing duplicate bridge
height constants.

- [ ] **Step 6: Verify rendering**

Run:

```powershell
npm run test -- tests/phaser/trackPresentation.test.ts tests/phaser/renderingContracts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/phaser/rendering src/phaser/scenes tests/phaser
git commit -m "feat: render terrain and solid local structures"
```

---

### Task 6: Mobile Editor Chrome Refactor

**Files:**
- Create: `src/ui/editor/editorToolPalette.ts`
- Create: `src/ui/editor/editorContextDock.ts`
- Create: `src/ui/editor/editorSelectionPanels.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/ui/uiHost.ts`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/components.css`
- Modify: `tests/ui/uiHost.test.ts`
- Create: `tests/ui/terrainEditorUi.test.ts`

**Interfaces:**
- Produces reusable editor chrome builders used by the one desktop/mobile DOM path.
- Context dock dispatches structure, terrain brush kind, terrain brush radius, and surface actions.

- [ ] **Step 1: Write failing mobile DOM tests**

```ts
expect(root.querySelector('[data-tool="terrain"]')).not.toBeNull()
expect(root.querySelectorAll('[data-terrain-brush]')).toHaveLength(4)
expect(root.querySelectorAll('[data-terrain-radius]')).toHaveLength(3)
expect(root.querySelector('[data-editor-context-dock]')).toHaveAttribute(
  'data-layout',
  'two-row',
)
```

Assert the Structure tool labels are `SURFACE` and `OVERPASS`, and style
contracts expose `min-height: 44px` or `min-block-size: 44px`.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- tests/ui/terrainEditorUi.test.ts tests/ui/uiHost.test.ts`  
Expected: FAIL because terrain controls and split builders do not exist.

- [ ] **Step 3: Split editor chrome by responsibility**

Move tool palette, contextual dock, and selection panels out of
`editorChrome.ts`. Keep `createEditorChrome` as orchestration only. Reuse a
segmented-button builder for surface, structure, terrain kind, and brush-size
choices.

- [ ] **Step 4: Implement responsive mobile dock**

Use a two-row safe-area-aware context dock below the canvas. Keep every target
at least 44px. Make the tool palette two columns on short/mobile viewports and
ensure history, track actions, diagnostics, and context controls do not overlap.

- [ ] **Step 5: Verify UI**

Run:

```powershell
npm run test -- tests/ui/terrainEditorUi.test.ts tests/ui/uiHost.test.ts tests/ui/modalFlows.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/ui src/styles tests/ui
git commit -m "refactor: build mobile terrain editor chrome"
```

---

### Task 7: Water Contact, Race Termination, and Diagnostics

**Files:**
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/race/trackContext.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Modify: `src/application/race/raceSession.ts`
- Modify: `src/ui/modals/resultsModal.ts`
- Modify: `src/domain/track/trackDiagnostics.ts`
- Modify: `src/domain/editor/editorState.ts`
- Create: `tests/domain/waterRace.test.ts`
- Modify: `tests/application/raceSession.test.ts`
- Modify: `tests/ui/raceFlow.test.ts`
- Modify: `tests/domain/trackValidation.test.ts`

**Interfaces:**
- Produces: `terrainMaterial` and `safeAboveWater` in vehicle context; race terminal reason/result outcome `water`.
- Surface-road water and tree-water diagnostics provide explicit repairs.

- [ ] **Step 1: Write failing water lifecycle tests**

```ts
it('ends the player race once without recording a score', () => {
  const result = stepRace(stateWithPlayerInWater, input, 1 / 60, random)
  expect(result.state.phase).toBe('finished')
  expect(result.events.filter((event) => event.type === 'race-finished'))
    .toEqual([{ type: 'race-finished', reason: 'water' }])
})

it('recovers an AI car from water without ending the race', () => {
  const result = stepRace(stateWithAiInWater, input, 1 / 60, random)
  expect(result.state.phase).toBe('running')
  expect(result.state.vehicles.find(({ player }) => !player)?.currentSurface)
    .not.toBe('water')
})
```

Add session coverage for one-shot feedback/audio teardown and no high-score
write. Add UI coverage for the `SUNK` result headline.

- [ ] **Step 2: Confirm RED**

Run: `npm run test -- tests/domain/waterRace.test.ts tests/application/raceSession.test.ts tests/ui/raceFlow.test.ts`  
Expected: FAIL because water is not a race material or terminal reason.

- [ ] **Step 3: Add water contact to the shared context**

Sample material from `path.terrainSurface`. A vehicle is safe above water only
when its structure sample is an overpass and its underside is above the deck
clearance. Surface road does not suppress water.

- [ ] **Step 4: Implement terminal and recovery behavior**

Extend `RaceEvent.race-finished.reason` and `RaceResult.outcome` with `water`.
End the player race immediately, publish once, silence continuous audio through
the existing result path, and do not record a score. Reset grounded AI water
contacts through `resetVehicleToTrack`.

- [ ] **Step 5: Add explicit editor diagnostics**

Report surface road over water and tree in water. Repairs convert affected road
sections to overpass or remove the tree through existing undoable editor
commands. Do not silently mutate authored content.

- [ ] **Step 6: Verify race and diagnostics**

Run:

```powershell
npm run test -- tests/domain/waterRace.test.ts tests/application/raceSession.test.ts tests/ui/raceFlow.test.ts tests/domain/trackValidation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/domain/race src/application/race src/domain/track/trackDiagnostics.ts src/domain/editor/editorState.ts src/ui/modals/resultsModal.ts tests
git commit -m "feat: end races on player water contact"
```

---

### Task 8: Full Verification, Refactor Audit, and Documentation

**Files:**
- Modify: `docs/refactorplan.md`

**Interfaces:**
- Produces a verified v8 terrain vertical slice with no parallel height systems.

- [ ] **Step 1: Update the refactor plan**

Record v8 sparse terrain, hill/water editor, composed surface authority,
local-terrain structures, mobile chrome refactor, and water race outcome as
shipped. Keep unrelated backlog entries intact.

- [ ] **Step 2: Run focused architecture searches**

Run:

```powershell
rg -n "RoadElevation|elevationAt|roadHeightAt|roadGradeAt|bridgeDeckHeight" src
rg -n "terrainHeight|materialAt" src
```

Expected: no obsolete runtime elevation names or duplicate physical height
constants; terrain sampling appears through canonical surface modules and their
consumers only.

- [ ] **Step 3: Run the full gate**

Run: `npm run verify`  
Expected: every Vitest file passes, strict TypeScript passes, Biome has no
findings, and Vite builds successfully.

- [ ] **Step 4: Run patch and production checks**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors and only intended terrain/editor/refactor files.

- [ ] **Step 5: Review behavior and reuse**

Inspect the final diff and confirm:

- one sparse terrain model;
- one compiled terrain cache;
- one composed road-surface authority;
- one editor gesture/history path;
- one desktop/mobile DOM path;
- one race-result teardown path.

- [ ] **Step 6: Commit**

```powershell
git add docs/refactorplan.md
git commit -m "docs: record terrain editor vertical slice"
```
