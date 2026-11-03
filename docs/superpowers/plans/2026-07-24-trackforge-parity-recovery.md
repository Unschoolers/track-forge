# TrackForge Phaser Parity Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore every user-visible capability in `trackforge.html` inside the
strict TypeScript 7, Phaser 4, Vite runtime without returning to global mutable
state or a monolithic scene.

**Architecture:** Keep simulation and editor behavior pure in `src/domain`,
coordinate workflows in focused application services, and inject the same
editor/race session ports into the Phaser and DOM adapters. Keep high-frequency
race telemetry outside `AppSnapshot` so the DOM HUD can update without
remounting the whole application on every frame. Treat `trackforge.html` as the
golden behavior reference until the final parity gate passes.

**Tech Stack:** TypeScript 7, Phaser 4, Vite 7, Vitest 3, jsdom, Biome.

## Global Constraints

- Keep `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, and `isolatedModules` enabled.
- Domain modules may not import Phaser, DOM, storage, audio, navigator, or
  timing APIs.
- Inject clocks, randomness, storage, feedback, and shared input controllers.
- Preserve all valid records from `trackforge-library-v1` and
  `trackforge-highscores-v1`; migrations must be idempotent.
- Keep pointer, keyboard, mobile, tablet, and desktop controls on one behavior
  path.
- Keep each gesture to one undo history entry.
- Keep simulation deterministic when supplied a fixed random source and delta
  sequence.
- Keep all visible controls semantic, labeled, focus-safe, and usable with
  keyboard or pointer input.
- Follow red-green-refactor for every behavioral slice.
- Run `npm run verify` and `git diff --check` before declaring parity complete.

---

## Target file structure

### Application

- `src/application/appState.ts` — low-frequency navigation, modal, library,
  editor UI, preferences, and final result state.
- `src/application/appController.ts` — command routing only; delegates library,
  editor, and race work.
- `src/application/library/trackLibraryService.ts` — create, rename, delete,
  select, duplicate-name validation, and score cleanup.
- `src/application/race/raceSession.ts` — owns the active deterministic race,
  live telemetry, pause/restart, terminal result, scoring, and race events.
- `src/application/ports/feedback.ts` — typed one-shot and continuous feedback
  events.
- `src/application/ports/input.ts` — shared race-control port consumed by both
  DOM controls and the Phaser scene.
- `src/application/ports/random.ts` — injected `RandomSource`.

### Domain

- `src/domain/editor/editorState.ts` — immutable editor aggregate and
  gesture-level history.
- `src/domain/editor/editorGeometry.ts` — point/segment/tree hit testing,
  smoothing, mixed-surface choice, loop normalization, and expansion.
- `src/domain/race/raceEngine.ts` — one pure authoritative race step and emitted
  domain events.
- `src/domain/race/ranking.ts` — stable position, finish order, DNF, and result
  construction.
- `src/domain/race/effects.ts` — pure effect descriptors with bounded lifetimes.
- `src/domain/race/ai/aiState.ts` — explicit follow/pass/rejoin state.

### UI

- `src/ui/uiHost.ts` — mounts one persistent shell and switches low-frequency
  screens without rebuilding live controls every frame.
- `src/ui/screens/homeScreen.ts`, `editorChrome.ts`, `raceHud.ts` — screen
  composition.
- `src/ui/modals/trackLibraryModal.ts`, `nameModal.ts`, `raceSetupModal.ts`,
  `optionsModal.ts`, `pauseModal.ts`, `resultsModal.ts` — focused dialog views.
- `src/ui/components/scoreboard.ts`, `carPicker.ts`, `toggleRow.ts` — reusable
  view components.
- `src/ui/dialogController.ts` — focus capture, escape handling, and focus
  restoration.
- `src/ui/toast.ts` — accessible transient notices.

### Phaser

- `src/phaser/scenes/EditorScene.ts` — editor input/camera adapter and render
  orchestration.
- `src/phaser/scenes/RaceScene.ts` — calls `RaceSession.advance()` and renders
  snapshots; owns no independent race state.
- `src/phaser/input/editorInput.ts` — complete tool gestures.
- `src/phaser/input/raceInput.ts` — shared keyboard and pointer control state.
- `src/phaser/rendering/trackRenderer.ts`, `curbRenderer.ts`,
  `vehicleRenderer.ts`, `raceEffectsRenderer.ts`, `nightRenderer.ts` — focused
  visual layers.

### Infrastructure

- `src/infrastructure/storage/storageKeys.ts` — every persisted identifier in
  one typed record.
- `src/infrastructure/storage/trackRepository.ts` and `scoreRepository.ts` —
  boundary validation plus idempotent v1/v2 merging.
- `src/infrastructure/feedback/webAudioAdapter.ts` — gesture-gated engine,
  surface, impact, UI, and finish audio.
- `src/infrastructure/feedback/hapticsAdapter.ts` — optional vibration patterns.

---

### Task 1: Protect legacy tracks, scores, and preferences

**Files:**
- Create: `src/infrastructure/storage/storageKeys.ts`
- Create: `tests/fixtures/legacyStorage.ts`
- Modify: `src/infrastructure/storage/trackRepository.ts`
- Modify: `src/infrastructure/storage/scoreRepository.ts`
- Modify: `src/infrastructure/storage/preferencesRepository.ts`
- Modify: `src/application/ports/storage.ts`
- Modify: `tests/infrastructure/storage.test.ts`

**Interfaces:**
- Produces:

```ts
export const STORAGE_KEYS = {
  tracks: 'trackforge-library-v2',
  legacyTracks: 'trackforge-library-v1',
  legacyAutosaves: ['trackforge-autosave-v2', 'trackforge-manual-v2'],
  scores: 'trackforge-highscores-v2',
  legacyScores: 'trackforge-highscores-v1',
  car: 'trackforge-last-car',
  difficulty: 'trackforge-difficulty',
  audio: 'trackforge-audio-enabled',
  haptics: 'trackforge-haptics-enabled',
  dynamicZoom: 'trackforge-dynamic-zoom',
} as const
```

- `BrowserTrackRepository.list()` returns an idempotent union of valid v1 and v2
  tracks, ordered by `updatedAt` descending.
- `BrowserScoreRepository.forTrack()` accepts legacy `{ time, car, difficulty,
  date }` and current `{ time, car, difficulty, recordedAt }` records, dedupes
  them, and keeps the fastest five.
- Decoders use the repository's injected `now()` rather than `Date.now()`.

- [ ] **Step 1: Add failing compatibility fixtures and tests**

```ts
export const legacyTrack = {
  id: 'legacy-harbor',
  name: 'Midnight Harbor',
  version: 5,
  points: [
    { x: 0, y: 0, surface: 'street' },
    { x: 100, y: 0, surface: 'dirt' },
  ],
  trees: [{ x: 25, y: 40 }],
  timeOfDay: 'night',
  createdAt: 100,
  updatedAt: 200,
} as const

export const legacyScore = {
  time: 42.5,
  car: 'green',
  difficulty: 'hard',
  date: 300,
} as const
```

Add tests that seed both v1 and an already-created v2 starter record, then
assert both tracks survive, the v1 track keeps night lighting, repeated
`list()` calls do not duplicate records, and the v1 score is returned with
`recordedAt: 300`.

- [ ] **Step 2: Run the focused test and confirm the data-loss failure**

Run:

```powershell
npm test -- tests/infrastructure/storage.test.ts
```

Expected: FAIL because the v1 library and score keys are ignored.

- [ ] **Step 3: Centralize keys and implement idempotent merging**

Move all key strings to `storageKeys.ts`. Decode v1 `timeOfDay` into `lighting`,
decode score `date` into `recordedAt`, merge by stable track id and score
identity, and persist the merged normalized value only when it differs from the
stored v2 value. Do not delete any v1 key.

- [ ] **Step 4: Verify storage compatibility**

Run:

```powershell
npm test -- tests/infrastructure/storage.test.ts
npm run typecheck
```

Expected: all storage tests pass and TypeScript reports zero errors.

- [ ] **Step 5: Commit**

```powershell
git add src/infrastructure/storage src/application/ports/storage.ts tests/fixtures/legacyStorage.ts tests/infrastructure/storage.test.ts
git commit -m "fix: preserve legacy TrackForge data"
```

---

### Task 2: Complete track-library application workflows

**Files:**
- Create: `src/application/library/trackLibraryService.ts`
- Create: `src/application/library/trackName.ts`
- Modify: `src/application/appState.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/application/ports/storage.ts`
- Modify: `tests/application/appController.test.ts`
- Create: `tests/application/trackLibraryService.test.ts`

**Interfaces:**
- Produces:

```ts
export type AppOverlay =
  | { readonly type: 'none' }
  | { readonly type: 'track-library'; readonly purpose: 'edit' | 'race' }
  | { readonly type: 'track-name'; readonly purpose: 'create' | 'rename' }
  | { readonly type: 'race-setup' }
  | { readonly type: 'options'; readonly returnTo: 'home' | 'editor' | 'race' }
  | { readonly type: 'pause' }
  | { readonly type: 'results' }

export type TrackNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string }

export interface TrackLibraryService {
  create(name: string): TrackNameResult
  rename(id: TrackId, name: string): TrackNameResult
  delete(id: TrackId): boolean
  select(id: TrackId): Track | undefined
}
```

- Adds typed commands `open-track-library`, `close-overlay`, `create-track`,
  `rename-track`, `delete-track`, `select-track-for-edit`, and
  `select-track-for-race`.
- Deleting a track deletes its score records and selects the next newest track.
- Names are whitespace-normalized, 1–32 characters, and case-insensitively
  unique.

- [ ] **Step 1: Write failing service and controller tests**

Test create, rename, duplicate rejection, delete with score cleanup, selecting
an incomplete track for edit, rejecting it for race, and opening the correct
overlay after each action.

- [ ] **Step 2: Confirm the commands do not exist**

Run:

```powershell
npm test -- tests/application/trackLibraryService.test.ts tests/application/appController.test.ts
```

Expected: FAIL on missing service and command variants.

- [ ] **Step 3: Implement the focused library service and delegate from the controller**

Keep name validation and persistence out of `AppController`. When a selected
track changes, rebuild `EditorState`, clear history/future, and use that track's
stored `lighting` as the race-setup default.

- [ ] **Step 4: Verify workflow state**

Run:

```powershell
npm test -- tests/application/trackLibraryService.test.ts tests/application/appController.test.ts
npm run typecheck
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/application tests/application
git commit -m "feat: restore track library workflows"
```

---

### Task 3: Restore the library, naming, setup, options, and menu UI

**Files:**
- Create: `src/ui/modals/trackLibraryModal.ts`
- Create: `src/ui/modals/nameModal.ts`
- Create: `src/ui/modals/raceSetupModal.ts`
- Create: `src/ui/modals/optionsModal.ts`
- Create: `src/ui/modals/pauseModal.ts`
- Create: `src/ui/components/carPicker.ts`
- Create: `src/ui/components/toggleRow.ts`
- Create: `src/ui/dialogController.ts`
- Create: `src/ui/toast.ts`
- Modify: `src/ui/screens/homeScreen.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/ui/uiHost.ts`
- Modify: `src/styles/components.css`
- Modify: `src/styles/layout.css`
- Create: `tests/ui/modalFlows.test.ts`
- Modify: `tests/ui/uiHost.test.ts`

**Interfaces:**
- Each modal consumes `AppSnapshot` plus narrow callbacks and returns one
  `HTMLElement`.
- `DialogController.open(dialog, restoreTarget)` focuses the first enabled
  control, traps Tab, closes on Escape when allowed, and restores focus.
- Home displays best time from `ScoreStore`, plus Race, Track Editor, and
  Options.

- [ ] **Step 1: Add failing jsdom flow tests**

Cover home → race library → setup → back, home → editor library → create name,
duplicate-name error text, rename, delete confirmation callback, options return
targets, pause menu actions, Escape, and focus restoration.

- [ ] **Step 2: Confirm the missing modal behavior**

Run:

```powershell
npm test -- tests/ui/uiHost.test.ts tests/ui/modalFlows.test.ts
```

Expected: FAIL because only three screen renderers exist.

- [ ] **Step 3: Build focused modal components and persistent shell rendering**

Use `textContent` through `src/ui/dom.ts` for track names. Expose car name,
role, description, four stat values, difficulty description, and day/night.
Add active and disabled state with `aria-pressed` and `aria-disabled`.

- [ ] **Step 4: Add responsive and focus-visible styling**

Keep safe-area padding. Use tokenized colors, a one-column phone layout, a
two-column tablet library/setup layout where space permits, and a constrained
desktop shell. Add `:focus-visible` outlines to every interactive component.

- [ ] **Step 5: Verify UI behavior**

Run:

```powershell
npm test -- tests/ui/uiHost.test.ts tests/ui/modalFlows.test.ts
npm run lint
npm run typecheck
```

Expected: all commands emit once, dialog tests pass, and no lint/type errors.

- [ ] **Step 6: Commit**

```powershell
git add src/ui src/styles tests/ui
git commit -m "feat: restore TrackForge navigation and dialogs"
```

---

### Task 4: Complete the editor aggregate and gesture semantics

**Files:**
- Create: `src/domain/editor/editorGeometry.ts`
- Modify: `src/domain/editor/editorState.ts`
- Modify: `src/domain/track/pathBuilder.ts`
- Modify: `src/domain/track/trackValidation.ts`
- Modify: `tests/domain/editorCommands.test.ts`
- Create: `tests/domain/editorGeometry.test.ts`
- Modify: `tests/domain/trackValidation.test.ts`

**Interfaces:**
- Produces:

```ts
export type EditorSurface = SurfaceId | 'mixed'

export type EditorCommand =
  | { readonly type: 'begin-gesture' }
  | { readonly type: 'add-point'; readonly point: TrackPoint }
  | { readonly type: 'move-point'; readonly index: number; readonly point: Vector2 }
  | { readonly type: 'paint-point'; readonly index: number; readonly surface: SurfaceId }
  | { readonly type: 'erase-point'; readonly index: number }
  | { readonly type: 'add-tree'; readonly tree: Tree }
  | { readonly type: 'erase-tree'; readonly index: number }
  | { readonly type: 'end-gesture' }
  | { readonly type: 'clear' }
  | { readonly type: 'expand'; readonly factor: 2 }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
```

- `begin-gesture` captures one pre-gesture snapshot. Mutations during the
  gesture do not append history. `end-gesture` appends that snapshot only when
  points or trees changed.
- Produces `nearestControlPoint`, `nearestTree`, `nearestSegmentIndex`,
  `appendDrawPoint`, `surfaceForIndex`, `normalizeClosedLoop`, and
  `expandAroundBoundsCenter`.
- `buildRoadPath` restores adaptive straightening and uses unique closed-loop
  samples plus explicit wrapped nearest searches.

- [ ] **Step 1: Write failing editor parity tests**

Test one history item for a 20-sample draw gesture, no history for a tap that
changes nothing, straight-drag point coalescing, alternating mixed surfaces,
select/move, segment painting, point/tree erasing, closed-end snapping, 2×
expansion around the bounds center, and undo/redo of each gesture.

- [ ] **Step 2: Confirm current reducer/path behavior fails**

Run:

```powershell
npm test -- tests/domain/editorCommands.test.ts tests/domain/editorGeometry.test.ts tests/domain/trackValidation.test.ts
```

Expected: FAIL on gesture history, smoothing, mixed surface, normalization, and
expansion cases.

- [ ] **Step 3: Implement immutable geometry and gesture history**

Port the legacy thresholds exactly:

```ts
export const EDITOR_LIMITS = {
  closeDistance: 74,
  minimumPoints: 9,
  minimumTrackLength: 900,
  historyLimit: 50,
  drawGapScreenPixels: 27,
  pointHitScreenPixels: 30,
  segmentHitScreenPixels: 44,
  treeHitScreenPixels: 24,
} as const
```

Pass zoom into hit-test/draw functions instead of reading camera globals.

- [ ] **Step 4: Verify editor domain parity**

Run:

```powershell
npm test -- tests/domain/editorCommands.test.ts tests/domain/editorGeometry.test.ts tests/domain/trackValidation.test.ts
npm run typecheck
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/editor src/domain/track tests/domain
git commit -m "feat: restore complete editor behavior"
```

---

### Task 5: Wire editor tools, camera actions, and track presentation

**Files:**
- Modify: `src/application/appState.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/ui/screens/editorChrome.ts`
- Modify: `src/phaser/input/editorInput.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Modify: `src/phaser/rendering/editorRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Create: `src/phaser/rendering/curbRenderer.ts`
- Modify: `tests/phaser/editorInput.test.ts`
- Create: `tests/phaser/editorCamera.test.ts`
- Modify: `tests/ui/uiHost.test.ts`

**Interfaces:**
- Adds:

```ts
export interface EditorUiState {
  readonly tool: EditorTool
  readonly surface: EditorSurface
  readonly grid: boolean
  readonly cameraRequest: {
    readonly sequence: number
    readonly action: 'zoom-in' | 'zoom-out' | 'fit'
  } | null
}
```

- Adds commands `set-editor-tool`, `set-editor-surface`,
  `toggle-editor-grid`, and `request-editor-camera`.
- `EditorScene` constructs `EditorInputController` with the live tool/surface
  selectors and applies each camera request sequence once.

- [ ] **Step 1: Extend failing input and UI tests**

Assert that every tool/surface button changes active state and emits its typed
command. Assert draw, select/move, paint, pan, tree, erase, pointer cancel,
wheel zoom, zoom buttons, fit, grid, expand, save, clear, load, and play each
reach the correct domain/application action.

- [ ] **Step 2: Confirm the inert controls**

Run:

```powershell
npm test -- tests/phaser/editorInput.test.ts tests/phaser/editorCamera.test.ts tests/ui/uiHost.test.ts
```

Expected: FAIL because tool and surface handlers currently call
`() => undefined` and `EditorScene` always draws street points.

- [ ] **Step 3: Connect the shared editor input controller**

Remove direct `add-point` handling from `EditorScene`. Convert Phaser pointer
coordinates through `camera.getWorldPoint()`, keep pointer capture/cancellation
consistent, and dispatch `begin-gesture`/`end-gesture` around mutating tools.

- [ ] **Step 4: Restore editor rendering**

Draw optional world grid, trees, surface-specific road edges/fills/stripes,
generated street curbs, the checkered start line, selected control-point
highlight, and status text from `validateTrack()`. Keep each layer in its
focused renderer.

- [ ] **Step 5: Verify the complete editor adapter**

Run:

```powershell
npm test -- tests/phaser/editorInput.test.ts tests/phaser/editorCamera.test.ts tests/ui/uiHost.test.ts
npm run typecheck
npm run build
```

Expected: focused tests, strict typecheck, and production build pass.

- [ ] **Step 6: Commit**

```powershell
git add src/application src/ui/screens/editorChrome.ts src/phaser tests/phaser tests/ui
git commit -m "feat: connect the full Phaser editor"
```

---

### Task 6: Make one authoritative, observable race session

**Files:**
- Create: `src/application/ports/random.ts`
- Create: `src/application/race/raceSession.ts`
- Create: `src/domain/race/raceEngine.ts`
- Create: `src/domain/race/ranking.ts`
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/race/raceFactory.ts`
- Modify: `src/domain/race/progress.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Modify: `src/phaser/sceneHost.ts`
- Modify: `src/main.ts`
- Create: `tests/application/raceSession.test.ts`
- Modify: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Produces:

```ts
export type RacePhase = 'countdown' | 'running' | 'finished'

export interface RaceTelemetry {
  readonly phase: RacePhase
  readonly countdown: number
  readonly elapsed: number
  readonly position: number
  readonly vehicleCount: number
  readonly lap: number
  readonly totalLaps: number
  readonly damage: number
  readonly damageLimit: number
}

export interface RaceResult {
  readonly trackId: TrackId
  readonly trackName: string
  readonly playerPlace: number
  readonly playerTime: number | null
  readonly playerWrecked: boolean
  readonly newRecord: boolean
  readonly standings: readonly RaceStanding[]
  readonly highScores: readonly ScoreEntry[]
}

export interface RaceSessionPort {
  start(track: Track, setup: RaceSetup): void
  restart(): void
  setPaused(paused: boolean): void
  advance(deltaSeconds: number, input: DriverInput): void
  snapshot(): RaceSessionSnapshot
  subscribe(listener: (snapshot: RaceSessionSnapshot) => void): Unsubscribe
  destroy(): void
}
```

- `stepRace(state, input, deltaSeconds, random)` moves every active vehicle,
  computes nearest path **after** movement, updates every vehicle's progress,
  solves collisions, ranks vehicles, and returns typed race events.
- `RaceScene` has no private `RaceState`; it advances and renders the injected
  session.

- [ ] **Step 1: Write failing authoritative-session tests**

Cover 3.7-second countdown, no movement during countdown/pause, post-movement
nearest-path updates, forward wrap only, all four cars receiving lap updates,
player finish, AI finish, wreck terminal state, stable ranking, one score write,
restart reset, and idempotent destroy.

- [ ] **Step 2: Reproduce current terminal-flow failures**

Run:

```powershell
npm test -- tests/domain/raceSimulation.test.ts tests/application/raceSession.test.ts
```

Expected: FAIL because no race session exists, AI progress is never updated, and
scores/results are never produced.

- [ ] **Step 3: Implement the pure engine and application session**

Use cumulative path distance for progress, a wrapped search window for nearest
samples, and forward start-line gates to reject backward lap increments.
Construct `RaceSession` in `main.ts` and inject the same instance into
`AppController`, `DomUiHost`, and `PhaserSceneHost`.

- [ ] **Step 4: Remove scene-owned race state**

Replace `RaceScene.race` with `raceSession.snapshot()`. Keep only Phaser
graphics and camera objects in the scene. On every frame, call
`advance(Math.min(0.033, delta / 1000), controls.snapshot())`.

- [ ] **Step 5: Verify race ownership and progress**

Run:

```powershell
npm test -- tests/domain/raceSimulation.test.ts tests/application/raceSession.test.ts
npm run typecheck
npm run build
```

Expected: all race lifecycle tests pass and the scene compiles without a local
race state.

- [ ] **Step 6: Commit**

```powershell
git add src/application/race src/application/ports/random.ts src/domain/race src/phaser src/main.ts tests/application/raceSession.test.ts tests/domain/raceSimulation.test.ts
git commit -m "feat: add authoritative race session"
```

---

### Task 7: Restore live HUD, touch controls, pause, results, and scores

**Files:**
- Create: `src/application/ports/input.ts`
- Modify: `src/phaser/input/raceInput.ts`
- Modify: `src/ui/screens/raceHud.ts`
- Create: `src/ui/modals/resultsModal.ts`
- Create: `src/ui/components/scoreboard.ts`
- Modify: `src/ui/modals/pauseModal.ts`
- Modify: `src/ui/uiHost.ts`
- Modify: `src/application/appController.ts`
- Modify: `src/main.ts`
- Modify: `src/styles/components.css`
- Modify: `src/styles/layout.css`
- Modify: `tests/phaser/raceInput.test.ts`
- Create: `tests/ui/raceFlow.test.ts`
- Modify: `tests/application/raceSession.test.ts`

**Interfaces:**
- `RaceInputController` implements:

```ts
export interface RaceControlsPort {
  snapshot(): DriverInput
  setKeyboard(key: string, pressed: boolean): void
  beginSteering(pointerId: number, normalizedSteering: number): void
  updateSteering(pointerId: number, normalizedSteering: number): void
  beginBrake(pointerId: number): void
  endPointer(pointerId: number): void
  reset(): void
}
```

- The DOM steering pad and brake button receive the shared
  `RaceControlsPort`; Phaser keyboard events use the same instance.
- `raceHud.ts` subscribes to `RaceSessionPort` and patches existing text/bar
  nodes rather than replacing the HUD.

- [ ] **Step 1: Write failing input and full race-flow tests**

Assert steering-pad drag/release, brake press/release, two simultaneous canvas
pointers, keyboard equivalence, reset with R, touch cancellation, live
position/lap/time/damage/countdown, visibility auto-pause, resume, restart,
options return to pause, quit, results standings, top five, retry, and edit.

- [ ] **Step 2: Confirm touch and HUD failures**

Run:

```powershell
npm test -- tests/phaser/raceInput.test.ts tests/ui/raceFlow.test.ts tests/application/raceSession.test.ts
```

Expected: FAIL because DOM controls are decorative and HUD values are static.

- [ ] **Step 3: Share one race input controller**

Construct it in `main.ts`. DOM pointer events call `beginSteering`,
`updateSteering`, `beginBrake`, and `endPointer`; Phaser handles keyboard and
optional two-touch canvas braking through the same port. Prevent default only
for active game-control gestures.

- [ ] **Step 4: Bind telemetry and terminal results**

Format elapsed seconds as `MM:SS.mmm`, display lap as
`min(lap + 1, totalLaps)/totalLaps`, update damage width and text, and show
countdown values `3`, `2`, `1`, `GO`. Render DNF/WRECKED and finish times from
`RaceResult`, never by recomputing standings in the DOM.

- [ ] **Step 5: Verify the complete playable loop**

Run:

```powershell
npm test -- tests/phaser/raceInput.test.ts tests/ui/raceFlow.test.ts tests/application/raceSession.test.ts
npm run typecheck
npm run lint
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/application src/phaser/input src/ui src/styles src/main.ts tests
git commit -m "feat: restore race controls HUD and results"
```

---

### Task 8: Restore vehicle, terrain, collision, damage, and camera behavior

**Files:**
- Modify: `src/domain/config.ts`
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/race/vehiclePhysics.ts`
- Modify: `src/domain/race/collisions.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Create: `src/domain/race/trackContext.ts`
- Modify: `src/application/race/raceSession.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Modify: `tests/domain/raceSimulation.test.ts`
- Create: `tests/domain/vehiclePhysics.test.ts`
- Create: `tests/phaser/raceCamera.test.ts`

**Interfaces:**
- Adds longitudinal/lateral velocity, slip, current surface, curb state,
  damage cooldown, stuck duration, and camera hints to typed race state.
- Produces:

```ts
export interface VehicleStepContext {
  readonly nearest: NearestPathPoint
  readonly onRoad: boolean
  readonly onCurb: boolean
  readonly surface: SurfaceId | 'grass'
  readonly tangent: Vector2
  readonly normal: Vector2
}

export type RaceDomainEvent =
  | { readonly type: 'surface-changed'; readonly vehicleId: string; readonly surface: SurfaceId | 'grass' }
  | { readonly type: 'curb-hit'; readonly vehicleId: string; readonly speed: number }
  | { readonly type: 'collision'; readonly leftId: string; readonly rightId: string; readonly strength: number }
  | { readonly type: 'vehicle-wrecked'; readonly vehicleId: string }
  | { readonly type: 'race-finished'; readonly result: RaceResult }
```

- [ ] **Step 1: Add failing physics and camera tests**

Test each car on street/dirt/ice/grass, lateral grip loss, braking, curb
detection, damage-limited player versus non-damage AI, collision cooldown,
wreck stop, player reset to nearest path, stuck recovery, camera smoothing,
curve-aware rotation, dynamic zoom, and disabled fixed zoom.

- [ ] **Step 2: Confirm the simplified model fails**

Run:

```powershell
npm test -- tests/domain/vehiclePhysics.test.ts tests/domain/raceSimulation.test.ts tests/phaser/raceCamera.test.ts
```

Expected: FAIL on off-road, lateral dynamics, recovery, and camera cases.

- [ ] **Step 3: Port the legacy physical context and integration**

Use per-car terrain modifiers from `config.ts`, separate longitudinal and
lateral velocities, apply surface grip and damage penalties, and derive curb
contact from road geometry. Keep all math pure and delta-bounded.

- [ ] **Step 4: Restore chase-camera behavior**

Move camera target calculation to a pure helper tested with snapshots. Phaser
applies the returned center, angle, zoom, and shake; it does not duplicate the
physics rules.

- [ ] **Step 5: Verify physics and camera**

Run:

```powershell
npm test -- tests/domain/vehiclePhysics.test.ts tests/domain/raceSimulation.test.ts tests/phaser/raceCamera.test.ts
npm run typecheck
```

Expected: focused suites pass.

- [ ] **Step 6: Commit**

```powershell
git add src/domain src/application/race src/phaser/scenes/RaceScene.ts tests/domain tests/phaser
git commit -m "feat: restore TrackForge driving physics"
```

---

### Task 9: Restore committed overtaking AI

**Files:**
- Create: `src/domain/race/ai/aiState.ts`
- Modify: `src/domain/race/raceState.ts`
- Modify: `src/domain/race/ai/traffic.ts`
- Modify: `src/domain/race/ai/lanePlanner.ts`
- Modify: `src/domain/race/ai/aiDriver.ts`
- Modify: `src/domain/race/raceEngine.ts`
- Modify: `tests/domain/aiDriver.test.ts`
- Create: `tests/domain/aiRaceIntegration.test.ts`

**Interfaces:**
- Produces:

```ts
export type AiPhase = 'follow' | 'passing' | 'rejoin'

export interface AiDriverState {
  readonly phase: AiPhase
  readonly baseLane: number
  readonly targetLane: number
  readonly passLane: number
  readonly holdRemaining: number
  readonly cooldownRemaining: number
  readonly clearTime: number
  readonly steer: number
  readonly mistakeOffset: number
  readonly mistakeRemaining: number
}
```

- `stepAiVehicle()` consumes and returns `AiDriverState`, calls
  `choosePassingLane()`, observes time-to-collision, holds a committed lane, and
  rejoins only after pass clearance/completion.
- Random mistakes use injected `RandomSource`.

- [ ] **Step 1: Expand failing AI tests**

Cover follow distance, emergency TTC braking, blocked-lane rejection, pass
start, committed hold, no lane oscillation, pass completion, rejoin cooldown,
curve braking, surface tuning, seeded mistakes, difficulty reaction, distinct
AI pace, and hard-mode mirror rival.

- [ ] **Step 2: Confirm dead lane-planner integration**

Run:

```powershell
npm test -- tests/domain/aiDriver.test.ts tests/domain/aiRaceIntegration.test.ts
```

Expected: FAIL because `stepAiVehicle()` never calls the lane planner and has no
persistent passing state.

- [ ] **Step 3: Port the overtaking state machine**

Use the constants already present in `AI_OVERTAKE`, calculate relative wrapped
track distance from cumulative progress, and retain state on each vehicle
instead of choosing a new lane independently each frame.

- [ ] **Step 4: Verify deterministic racing**

Run:

```powershell
npm test -- tests/domain/aiDriver.test.ts tests/domain/aiRaceIntegration.test.ts tests/domain/raceSimulation.test.ts
npm run typecheck
```

Expected: all AI and race integration tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/race tests/domain
git commit -m "feat: restore committed overtaking AI"
```

---

### Task 10: Restore race rendering, effects, cars, and lighting

**Files:**
- Create: `src/domain/race/effects.ts`
- Create: `src/phaser/rendering/curbRenderer.ts`
- Create: `src/phaser/rendering/raceEffectsRenderer.ts`
- Modify: `src/phaser/rendering/trackRenderer.ts`
- Modify: `src/phaser/rendering/vehicleRenderer.ts`
- Modify: `src/phaser/rendering/nightRenderer.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Create: `tests/domain/raceEffects.test.ts`
- Create: `tests/phaser/renderingContracts.test.ts`

**Interfaces:**
- `RaceEffectsState` contains bounded arrays of dust, grass, skid, tire-smoke,
  spark, and damage-smoke descriptors.
- Vehicle rendering dispatches to one renderer per `CarId`.
- Night rendering receives every vehicle's screen transform and emits darkness,
  headlight cutout, headlamp glow, and tail/brake glow layers.

- [ ] **Step 1: Add failing effect and renderer contract tests**

Test dust by dirt/grass, skid threshold, brake smoke, impact sparks, damage
smoke, maximum retained effect counts, expiry, four unique vehicle geometry
descriptors, start line, street curbs, surface stripes, and light anchors that
rotate with each car.

- [ ] **Step 2: Confirm the presentation simplifications**

Run:

```powershell
npm test -- tests/domain/raceEffects.test.ts tests/phaser/renderingContracts.test.ts
```

Expected: FAIL because effects and distinct car/light contracts do not exist.

- [ ] **Step 3: Implement pure effect lifetimes and focused renderers**

Generate effect descriptors in the domain from typed race events. Render them
in Phaser without feeding visual state back into simulation. Port the blue
hatch, red sport, green rally, and yellow truck geometry into separate pure
descriptor builders used by `vehicleRenderer.ts`.

- [ ] **Step 4: Restore night composition**

Use a render texture or blend-mode layer to cut two headlight cones per car
from the darkness mask. Draw halos and brake-light glows above the mask but
below vehicle bodies, matching each renderer's exact lamp anchors.

- [ ] **Step 5: Verify presentation contracts and build**

Run:

```powershell
npm test -- tests/domain/raceEffects.test.ts tests/phaser/renderingContracts.test.ts
npm run typecheck
npm run build
```

Expected: focused tests and production build pass.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/race/effects.ts src/phaser/rendering src/phaser/scenes/RaceScene.ts tests/domain/raceEffects.test.ts tests/phaser/renderingContracts.test.ts
git commit -m "feat: restore TrackForge race presentation"
```

---

### Task 11: Wire complete audio and haptic feedback

**Files:**
- Modify: `src/application/ports/feedback.ts`
- Create: `src/application/feedback/feedbackRouter.ts`
- Modify: `src/infrastructure/feedback/webAudioAdapter.ts`
- Modify: `src/infrastructure/feedback/hapticsAdapter.ts`
- Modify: `src/application/race/raceSession.ts`
- Modify: `src/ui/uiHost.ts`
- Modify: `src/main.ts`
- Modify: `tests/infrastructure/feedback.test.ts`
- Create: `tests/application/feedbackRouter.test.ts`

**Interfaces:**
- Produces:

```ts
export type FeedbackEvent =
  | { readonly type: 'ui'; readonly emphasis: 'normal' | 'confirm' | 'danger' }
  | { readonly type: 'engine'; readonly speedRatio: number; readonly throttle: number }
  | { readonly type: 'surface'; readonly surface: SurfaceId | 'grass'; readonly speedRatio: number }
  | { readonly type: 'tire-slip'; readonly strength: number }
  | { readonly type: 'curb'; readonly speed: number }
  | { readonly type: 'collision'; readonly strength: number }
  | { readonly type: 'finish'; readonly place: number; readonly newRecord: boolean }

export interface FeedbackPort {
  setEnabled(enabled: boolean): void
  handle(event: FeedbackEvent): void
  destroy(): void
}
```

- `FeedbackRouter` fans events to audio and haptics, rate-limits continuous
  curb/slip events, and updates enabled state from preferences.

- [ ] **Step 1: Add failing routing and continuous-audio tests**

Test no `AudioContext` before a user gesture, one context after unlock,
continuous engine frequency/gain changes, surface noise changes, slip, impact,
finish/new-record tones, UI emphasis, preference toggles, haptic patterns,
rate limiting, missing vibration support, and disposal.

- [ ] **Step 2: Confirm adapters are unconnected**

Run:

```powershell
npm test -- tests/infrastructure/feedback.test.ts tests/application/feedbackRouter.test.ts
```

Expected: FAIL because no router exists and current audio supports only a few
one-shot tones.

- [ ] **Step 3: Implement and inject the feedback router**

Construct audio and haptics in `main.ts`, inject the router into UI and
`RaceSession`, unlock audio from the first intentional pointer/key action, and
route domain events without importing browser APIs into domain/application
logic.

- [ ] **Step 4: Verify feedback behavior**

Run:

```powershell
npm test -- tests/infrastructure/feedback.test.ts tests/application/feedbackRouter.test.ts
npm run typecheck
```

Expected: all feedback tests pass with browser APIs mocked at adapter
boundaries.

- [ ] **Step 5: Commit**

```powershell
git add src/application/feedback src/application/ports/feedback.ts src/infrastructure/feedback src/application/race src/ui src/main.ts tests
git commit -m "feat: connect TrackForge audio and haptics"
```

---

### Task 12: Add executable parity gates and finish the cutover

**Files:**
- Create: `tests/e2e/legacyParity.test.ts`
- Create: `tests/e2e/applicationFlow.test.ts`
- Create: `tests/e2e/lifecycle.test.ts`
- Create: `docs/trackforge-manual-test-matrix.md`
- Modify: `docs/trackforge-parity-audit.md`
- Modify: `docs/superpowers/specs/2026-07-23-trackforge-phaser-migration-design.md`
- Modify: `README.md`
- Preserve until all gates pass: `trackforge.html`

**Interfaces:**
- `legacyParity.test.ts` asserts the inventory of required screens, commands,
  tools, cars, surfaces, difficulty modes, preference keys, score flow, and
  feedback event families.
- `applicationFlow.test.ts` drives create → draw → close → save → setup → race
  → finish → score → retry with fake ports and deterministic time/randomness.
- `lifecycle.test.ts` verifies no duplicate listeners, intervals, animation
  subscriptions, or writes after destroy/restart.

- [ ] **Step 1: Write the parity and lifecycle tests**

Encode every row in `docs/trackforge-parity-audit.md` as an automated assertion
where possible. Put purely visual checks—phone/tablet/desktop, day/night, four
car silhouettes, particles, focus order, touch ergonomics—into the manual test
matrix with explicit expected observations.

- [ ] **Step 2: Run the new gates and fix only concrete failures**

Run:

```powershell
npm test -- tests/e2e/legacyParity.test.ts tests/e2e/applicationFlow.test.ts tests/e2e/lifecycle.test.ts
```

Expected after Tasks 1–11: all three suites pass.

- [ ] **Step 3: Perform the manual matrix**

Run:

```powershell
npm run dev
```

Verify at 390×844, 820×1180, and 1440×900. Test mouse, keyboard, single-touch,
two-touch, pointer cancellation, hidden-tab pause, audio disabled/enabled,
haptics unavailable/enabled, day/night, all cars, all surfaces, all
difficulties, legacy data, and a complete three-lap result.

- [ ] **Step 4: Correct documentation and acceptance status**

Mark a parity row Complete only when its automated test and, where relevant,
manual observation pass. Update README controls and storage migration notes.
Keep `trackforge.html` as a source reference; the Vite runtime must not load it.

- [ ] **Step 5: Run the final repository gate**

Run:

```powershell
npm run verify
git diff --check
```

Expected: tests, strict TypeScript 7, Biome lint, Vite production build, and
whitespace validation all exit with code 0.

- [ ] **Step 6: Commit**

```powershell
git add tests/e2e docs README.md
git commit -m "test: certify TrackForge legacy parity"
```

---

## Delivery checkpoints

1. **Data-safe editor:** Tasks 1–5. Existing tracks reappear and every editor
   control works.
2. **Complete playable loop:** Tasks 6–7. A race starts, updates HUD, finishes,
   records a score, and reaches results on keyboard or touch.
3. **Gameplay parity:** Tasks 8–9. Physics, damage, recovery, and overtaking
   match the reference behavior.
4. **Presentation parity:** Tasks 10–11. Vehicles, effects, night lighting,
   audio, and haptics are restored.
5. **Certified cutover:** Task 12. Automated and manual parity gates are green.

## Self-review result

- Every parity-audit row maps to at least one task.
- Storage recovery precedes any feature that could write new data.
- Live race state has one owner and one typed subscription path.
- Phaser scenes remain adapters rather than alternate state stores.
- UI controls and scenes share injected input/session objects.
- Exact public types used by later tasks are defined in earlier tasks.
- No task requires disabling strict TypeScript or bypassing boundary validation.
- The final gate retains the legacy file as a golden reference without loading
  it in production.

