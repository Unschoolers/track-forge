# Section Road Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace crossing-local bridges with paintable ground/overhead road sections that form continuous curved bridges with automatic ramps, walls, shadows, and supports.

**Architecture:** Authored `TrackPoint` objects own the elevation of their outgoing section. `elevationProfile.ts` derives stable elevated runs and continuous height from the resampled path; editor, crossing, renderer, race, and storage code consume that single profile instead of maintaining crossing-specific elevation state.

**Tech Stack:** Phaser 4 RC, strict TypeScript 7, Vite 7, Vitest, DOM UI, Biome

## Global Constraints

- `ground` is the default and `overhead` is the only raised level.
- Elevation is stored on authored sections, never generated sample indexes.
- Adjacent overhead sections form one run, including across a closed-loop seam.
- Ramps are automatic, symmetric when shortened, and use eased continuous height.
- Elevated walls become solid only after the deck clears the ground.
- Equal crossing heights form a junction; unequal heights form an overpass.
- Existing crossing elevation data is migration input only.
- Editor painting participates in gesture-level undo/redo.
- All public and shared shapes remain strict-TypeScript compatible.

---

### Task 1: Section elevation model and path metadata

**Files:**
- Modify: `src/domain/model.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `src/domain/editor/editorGeometry.ts`
- Test: `tests/domain/trackGeometry.test.ts`

**Interfaces:**
- Produces: `RoadElevation`, `TrackPoint.elevation`, `RoadPathPoint.sectionId`, and `RoadPathPoint.elevation`.
- Consumes: existing stable `TrackPoint.id` metadata.

- [ ] **Step 1: Write the failing path-metadata test**

Add a closed four-section track whose second point has
`elevation: 'overhead'`; assert every sample with that point's source segment
has the same `sectionId` and elevation, while omitted values normalize to
`ground`.

```ts
const points: readonly TrackPoint[] = [
  { id: 'a', x: 0, y: 0, surface: 'street' },
  {
    id: 'b',
    x: 160,
    y: 0,
    surface: 'street',
    elevation: 'overhead',
  },
  { id: 'c', x: 160, y: 160, surface: 'street' },
  { id: 'd', x: 0, y: 160, surface: 'street' },
  { id: 'a', x: 0, y: 0, surface: 'street' },
]
const path = buildRoadPath(points)
expect(path.points.filter((point) => point.segment === 1)).toSatisfy(
  (samples: readonly RoadPathPoint[]) =>
    samples.every(
      (sample) =>
        sample.sectionId === 'b' && sample.elevation === 'overhead',
    ),
)
expect(path.points.filter((point) => point.segment === 0))
  .toSatisfy((samples: readonly RoadPathPoint[]) =>
    samples.every((sample) => sample.elevation === 'ground'))
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- tests/domain/trackGeometry.test.ts`  
Expected: FAIL because `elevation` and `sectionId` are absent.

- [ ] **Step 3: Add the types and propagate authoring metadata**

```ts
export const ROAD_ELEVATIONS = ['ground', 'overhead'] as const
export type RoadElevation = (typeof ROAD_ELEVATIONS)[number]

export interface TrackPoint extends Vector2 {
  readonly surface: SurfaceId
  readonly id?: string
  readonly curve?: CurveMode
  readonly tension?: number
  readonly elevation?: RoadElevation
}

export interface RoadPathPoint extends Vector2 {
  readonly surface: SurfaceId
  readonly distance: number
  readonly segment: number
  readonly sectionId: string
  readonly elevation: RoadElevation
}
```

Use `startControl.point.id ?? \`section-${startControl.sourceIndex}\`` and
`startControl.point.elevation ?? 'ground'` for every generated sample.
`resampleByDistance` copies both fields from its starting sample.
Ensure draw finalization, loop normalization, and inserted points preserve or
default this metadata without copying an overhead state onto an unrelated new
section.

- [ ] **Step 4: Run the focused test and strict typecheck**

Run: `npm run test -- tests/domain/trackGeometry.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit the independently usable metadata change**

```powershell
git add src/domain/model.ts src/domain/track/pathBuilder.ts src/domain/editor/editorGeometry.ts tests/domain/trackGeometry.test.ts
git commit -m "feat: attach elevation to authored road sections"
```

### Task 2: Elevated runs and continuous height profile

**Files:**
- Rewrite: `src/domain/track/elevationProfile.ts`
- Modify: `src/domain/config.ts`
- Test: `tests/domain/trackGeometry.test.ts`

**Interfaces:**
- Consumes: `RoadPathPoint.sectionId` and `RoadPathPoint.elevation`.
- Produces:

```ts
export interface ElevatedRun {
  readonly id: string
  readonly startDistance: number
  readonly endDistance: number
  readonly length: number
  readonly rampLength: number
  readonly wraps: boolean
}

export interface TrackElevationContext {
  readonly height: number
  readonly runId: string | null
  readonly upper: boolean
}

export function buildElevatedRuns(path: RoadPath): readonly ElevatedRun[]
export function elevationAt(
  path: RoadPath,
  pathIndex: number,
  position?: Vector2,
): TrackElevationContext
```

- [ ] **Step 1: Write failing run/profile tests**

Cover:

```ts
expect(buildElevatedRuns(longBridgePath)).toHaveLength(1)
expect(elevationAt(longBridgePath, rampStart).height).toBeCloseTo(0)
expect(elevationAt(longBridgePath, deckMiddle).height).toBeCloseTo(1)
expect(elevationAt(longBridgePath, rampEnd).height).toBeCloseTo(0)
expect(buildElevatedRuns(wrappedBridgePath)[0]?.wraps).toBe(true)
expect(shortRunProfile.every(({ height }) => height >= 0 && height <= 1))
  .toBe(true)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npm run test -- tests/domain/trackGeometry.test.ts`  
Expected: FAIL because section runs are not derived.

- [ ] **Step 3: Implement run grouping and height**

Add named geometry configuration:

```ts
bridgeRampLength: ROAD_GEOMETRY.surfaceWidth * 1.35,
bridgeWallClearance: 0.18,
bridgePillarSpacing: ROAD_GEOMETRY.surfaceWidth * 1.6,
```

Group consecutive overhead samples by `sectionId`, merge the first and last
groups when a closed path is overhead across its seam, calculate physical
distance intervals, and cap each ramp at `run.length / 2`.

Use quintic smoothstep for a zero-slope transition:

```ts
function smootherstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}
```

Calculate distance within a wrapped or ordinary run, apply `smootherstep` on
the ramp-in, return `1` on the deck, and mirror it on the ramp-out.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm run test -- tests/domain/trackGeometry.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit the elevation authority**

```powershell
git add src/domain/config.ts src/domain/track/elevationProfile.ts tests/domain/trackGeometry.test.ts
git commit -m "feat: derive continuous elevated road runs"
```

### Task 3: Elevation painting and crossing shortcuts

**Files:**
- Modify: `src/domain/editor/editorGeometry.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/application/appState.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/styles/components.css`
- Test: `tests/domain/editorCommands.test.ts`
- Test: `tests/phaser/editorInput.test.ts`
- Test: `tests/ui/uiHost.test.ts`

**Interfaces:**
- Consumes: section elevation metadata from Task 1.
- Produces:

```ts
export type EditorTool =
  | 'draw'
  | 'select'
  | 'start'
  | 'paint'
  | 'elevation'
  | 'pan'
  | 'tree'
  | 'erase'

export type EditorElevationBrush = 'ground' | 'overhead'

export type EditorCommand =
  | {
      readonly type: 'paint-section-elevation'
      readonly index: number
      readonly elevation: RoadElevation
    }
  | {
      readonly type: 'set-crossing-sections'
      readonly firstSegment: number
      readonly secondSegment: number
      readonly upperSegment: number | null
    }
```

- [ ] **Step 1: Write failing editor/input/UI tests**

Assert that dragging the Elevation tool paints several nearest segments as one
gesture, `undo` restores all of them in one step, `redo` reapplies them, and the
editor chrome exposes Ground/Overhead choices only while that tool is active.
Assert crossing choices write the two owning point elevations and no longer
append a crossing-specific entry.

- [ ] **Step 2: Run the three suites and confirm RED**

Run:
`npm run test -- tests/domain/editorCommands.test.ts tests/phaser/editorInput.test.ts tests/ui/uiHost.test.ts`  
Expected: FAIL because the tool and commands do not exist.

- [ ] **Step 3: Implement the reducer and input gesture**

For `paint-section-elevation`, replace only the selected point:

```ts
const current = state.points[command.index]
if (!current || (current.elevation ?? 'ground') === command.elevation) {
  return state
}
const points = [...state.points]
points[command.index] = { ...current, elevation: command.elevation }
return changed(state, {
  points,
  trees: state.trees,
  elevations: state.elevations,
})
```

The input controller uses `nearestSegmentIndex` on both pointer-down and
pointer-move. Existing `begin-gesture`/`end-gesture` semantics make a drag one
undo item.

`set-crossing-sections` writes the selected branch to `overhead` and the other
to `ground`; `At grade` writes both to `ground`.

- [ ] **Step 4: Add the elevation tool UI**

Add a distinct bridge icon to the tool rail and an accessible two-choice
context bar:

```ts
const elevation = element('footer', 'elevation-bar')
elevation.append(
  button('GROUND', 'elevation-ground', () => actions.elevation('ground')),
  button('OVERHEAD', 'elevation-overhead', () => actions.elevation('overhead')),
)
```

Keep it responsive using the same mobile safe-area and active-button patterns
as the surface bar. Crossing controls dispatch `set-crossing-sections`.

- [ ] **Step 5: Run focused suites and typecheck**

Run:
`npm run test -- tests/domain/editorCommands.test.ts tests/phaser/editorInput.test.ts tests/ui/uiHost.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit the complete authoring interaction**

```powershell
git add src/domain/editor src/application/appState.ts src/phaser/input/editorInput.ts src/ui/screens/editorChrome.ts src/styles/components.css tests/domain/editorCommands.test.ts tests/phaser/editorInput.test.ts tests/ui/uiHost.test.ts
git commit -m "feat: paint ground and overhead road sections"
```

### Task 4: Height-aware crossing classification

**Files:**
- Modify: `src/domain/track/crossings.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `src/phaser/rendering/crossingRenderer.ts`
- Test: `tests/domain/crossings.test.ts`
- Test: `tests/phaser/trackPresentation.test.ts`

**Interfaces:**
- Consumes: `elevationAt(path, pathIndex, position)`.
- Produces:

```ts
export interface TrackCrossing {
  // existing geometry
  readonly firstHeight: number
  readonly secondHeight: number
  readonly upperPathIndex: number | null
}
```

- [ ] **Step 1: Write failing crossing tests**

Assert ground/ground branches produce one `junction`, ground/deck produces no
junction and identifies the deck branch, and two branches whose height
difference is below `0.08` remain at grade.

- [ ] **Step 2: Run tests and confirm RED**

Run:
`npm run test -- tests/domain/crossings.test.ts tests/phaser/trackPresentation.test.ts`  
Expected: FAIL because crossings still read `TrackElevation`.

- [ ] **Step 3: Separate planar detection from height classification**

Detect the intersection and its path indexes first. After the path object
exists, classify each crossing by sampling both branches at the intersection.
Use `Math.abs(firstHeight - secondHeight) < 0.08` as the at-grade threshold.
Remove `TrackElevation` parameters from new path-building call sites.

The crossing renderer retains only polygonal at-grade junction primitives;
long bridge presentation moves to Task 5.

- [ ] **Step 4: Run focused tests and typecheck**

Run:
`npm run test -- tests/domain/crossings.test.ts tests/phaser/trackPresentation.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit derived crossing semantics**

```powershell
git add src/domain/track/crossings.ts src/domain/track/pathBuilder.ts src/phaser/rendering/crossingRenderer.ts tests/domain/crossings.test.ts tests/phaser/trackPresentation.test.ts
git commit -m "feat: derive crossings from road height"
```

### Task 5: Curved bridge presentation

**Files:**
- Create: `src/phaser/rendering/bridgeRenderer.ts`
- Modify: `src/phaser/rendering/roadRibbonRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Modify: `src/phaser/rendering/crossingRenderer.ts`
- Test: `tests/phaser/trackPresentation.test.ts`

**Interfaces:**
- Consumes: `buildElevatedRuns`, `elevationAt`, and `TrackGeometry.ribbon`.
- Produces:

```ts
export type BridgePrimitive =
  | { readonly kind: 'shadow'; readonly polygon: readonly Vector2[] }
  | { readonly kind: 'pillar'; readonly start: Vector2; readonly end: Vector2 }
  | { readonly kind: 'edge' | 'surface'; readonly polygon: readonly Vector2[] }
  | { readonly kind: 'marking'; readonly start: Vector2; readonly end: Vector2 }
  | { readonly kind: 'wall'; readonly start: Vector2; readonly end: Vector2 }

export function buildBridgePresentation(
  geometry: TrackGeometry,
): readonly BridgePrimitive[]
```

- [ ] **Step 1: Write failing presentation tests**

Build a multi-section curved bridge and assert:

- shadow polygons cover the full run;
- pillars are separated by the configured world-space spacing;
- no pillar lies in a ramp;
- both wall sides span every above-clearance sample pair;
- primitives are returned in shadow, pillar, deck, marking, wall pass order.

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts`  
Expected: FAIL because `bridgeRenderer.ts` does not exist.

- [ ] **Step 3: Build bridge primitives from ribbon samples**

For each elevated sample pair, reuse the ribbon's `left`, `right`, `edgeLeft`,
and `edgeRight` vertices. Offset shadow vertices by a fixed `{ x: 9, y: 11 }`.
Emit pillars only where both heights are `1`, interpolating a cross-road line
at `bridgePillarSpacing`. Emit walls only where both heights exceed
`bridgeWallClearance`.

- [ ] **Step 4: Render ordered bridge passes**

Render underlay shadows and pillars before the ground road. Render elevated
edge/surface/markings after ground and at-grade junctions. Render walls last.
Filter elevated pairs from the ordinary road ribbon once their height exceeds
`0.01` so there are no duplicated outlines.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit the curved bridge renderer**

```powershell
git add src/phaser/rendering/bridgeRenderer.ts src/phaser/rendering/roadRibbonRenderer.ts src/phaser/rendering/trackRenderer.ts src/phaser/rendering/crossingRenderer.ts tests/phaser/trackPresentation.test.ts
git commit -m "feat: render continuous curved bridges"
```

### Task 6: Continuous bridge-wall physics and level separation

**Files:**
- Rewrite: `src/domain/race/bridgeBarriers.ts`
- Modify: `src/domain/race/collisions.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Modify: `src/phaser/rendering/vehicleRenderer.ts`
- Test: `tests/domain/raceSimulation.test.ts`
- Test: `tests/domain/vehiclePhysics.test.ts`

**Interfaces:**
- Consumes: continuous `elevationAt` height and local path tangent/normal.
- Produces: existing `BridgeBarrierFrame`, with contacts keyed by run and side.

- [ ] **Step 1: Write failing race tests**

Assert a vehicle leaving either side of a long curved elevated run is projected
inside, emits one impact per contact, and loses speed. Assert vehicles on
different heights do not collide at a crossing while same-height vehicles do.

- [ ] **Step 2: Run tests and confirm RED**

Run:
`npm run test -- tests/domain/raceSimulation.test.ts tests/domain/vehiclePhysics.test.ts`  
Expected: FAIL because barrier solving is crossing-local.

- [ ] **Step 3: Resolve walls against the local path frame**

For each previously elevated vehicle, find its nearest local path sample,
derive tangent/normal from neighboring samples, compute lateral displacement,
and clamp to:

```ts
const lateralLimit =
  ROAD_GEOMETRY.surfaceWidth / 2 - VEHICLE_HALF_WIDTH
```

Only activate when `elevationAt(...).height >=
ROAD_GEOMETRY.bridgeWallClearance`. Key contacts as
`barrier:${vehicle.id}:${runId}:${side}` and preserve the current reflection,
speed loss, damage, and event behavior.

- [ ] **Step 4: Gate cross-level interactions**

Before vehicle-to-vehicle collision resolution, compare sampled heights and
skip pairs whose difference is at least `0.08`. Set vehicle render depth from
height so upper vehicles remain above deck and lower traffic.

- [ ] **Step 5: Run focused suites and typecheck**

Run:
`npm run test -- tests/domain/raceSimulation.test.ts tests/domain/vehiclePhysics.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit continuous bridge behavior**

```powershell
git add src/domain/race/bridgeBarriers.ts src/domain/race/collisions.ts src/domain/race/raceEngine.ts src/phaser/rendering/vehicleRenderer.ts tests/domain/raceSimulation.test.ts tests/domain/vehiclePhysics.test.ts
git commit -m "feat: enforce continuous bridge walls"
```

### Task 7: Persistence migration and final integration

**Files:**
- Modify: `src/infrastructure/storage/trackRepository.ts`
- Modify: `src/application/library/trackLibraryService.ts`
- Modify: `src/domain/model.ts`
- Modify: `src/domain/track/trackDiagnostics.ts`
- Test: `tests/infrastructure/storage.test.ts`
- Test: `tests/application/trackLibraryService.test.ts`
- Modify: `docs/refactorplan.md`

**Interfaces:**
- Consumes: `TrackPoint.elevation`.
- Produces: schema version `7` tracks without crossing-specific elevation state.

- [ ] **Step 1: Write failing storage migration tests**

Assert:

```ts
expect(repository.find(legacyId)?.points[legacyUpperSegment]?.elevation)
  .toBe('overhead')
expect(repository.find(legacyId)?.version).toBe(7)
expect(repository.find(legacyId)?.elevations).toEqual([])
```

Also assert unknown point elevation values normalize to `ground`.

- [ ] **Step 2: Run storage suites and confirm RED**

Run:
`npm run test -- tests/infrastructure/storage.test.ts tests/application/trackLibraryService.test.ts`  
Expected: FAIL because schema v7 and migration do not exist.

- [ ] **Step 3: Decode, normalize, and migrate**

Add:

```ts
function decodeRoadElevation(value: unknown): RoadElevation {
  return value === 'overhead' ? 'overhead' : 'ground'
}
```

Decode every point with this value. For version 6 inputs, map each valid legacy
`upperSegment` to its point index and mark that point overhead. Return version
7 with `elevations: []`. Saving always writes the normalized v7 shape.

Remove stale-elevation diagnostics; section elevation is stable through point
movement and resampling.

- [ ] **Step 4: Update refactor documentation**

Record that bridge elevation is authored per outgoing control-point section,
crossings derive their topology from continuous height, and v6 crossing-local
metadata is migrated at the repository boundary.

- [ ] **Step 5: Run all verification gates**

Run: `npm run verify`  
Expected: 0 failed tests, strict typecheck success, Biome success, Vite build
success.

Run: `git diff --check`  
Expected: no whitespace errors.

- [ ] **Step 6: Perform a browser acceptance pass**

Run: `npm run dev` and verify:

1. paint three adjacent sections overhead;
2. observe one long bridge with two ramps;
3. undo once and see the whole drag revert;
4. redo once and see it return;
5. drive up the ramp and collide with both bridge walls;
6. drive through a crossing and confirm upper/lower vehicles remain separated;
7. reload the saved track and confirm the elevated stretch persists;
8. verify editor zoom remains unchanged while switching elevation tools;
9. verify day and night shadows, lights, and vehicle depth.

- [ ] **Step 7: Commit the integrated feature**

```powershell
git add src/infrastructure/storage/trackRepository.ts src/application/library/trackLibraryService.ts src/domain/model.ts src/domain/track/trackDiagnostics.ts tests/infrastructure/storage.test.ts tests/application/trackLibraryService.test.ts docs/refactorplan.md
git commit -m "feat: migrate tracks to section elevation"
```
