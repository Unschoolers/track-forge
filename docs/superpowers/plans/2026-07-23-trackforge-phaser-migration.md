# TrackForge Phaser 4 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete TrackForge game as a strict TypeScript 7, Phaser 4, Vite application with modular HTML/CSS UI.

**Architecture:** Pure domain modules sit behind application use cases. Phaser, DOM, storage, audio, haptics, clock, and randomness are adapters injected at one composition root. Scenes and UI controllers consume immutable snapshots and typed commands.

**Tech Stack:** TypeScript 7, Phaser 4, Vite, Vitest, jsdom, Biome.

## Global Constraints

- Use TypeScript 7.x with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`.
- Domain code may not import Phaser, DOM types, localStorage, Web Audio, or navigator APIs.
- Use constructor injection and narrow ports; do not introduce a global service locator.
- Preserve the original constants and observable gameplay behavior.
- Keep mobile, tablet, and desktop behavior on one code path.
- Every behavioral change follows red-green-refactor.

---

### Task 1: Toolchain and composition boundary

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `biome.json`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/app/createApplication.ts`
- Test: `tests/app/createApplication.test.ts`

**Interfaces:**
- Produces: `createApplication(dependencies: ApplicationDependencies): TrackForgeApplication`
- Produces: `TrackForgeApplication.start(): void` and `destroy(): void`

- [ ] Write `createApplication.test.ts` with fake scene and UI hosts; assert `start`
  mounts UI then starts `home`, and `destroy` disposes both exactly once.
- [ ] Run `npm test -- tests/app/createApplication.test.ts`; expect failure because
  `createApplication` does not exist.
- [ ] Add the strict TypeScript 7/Vite/Vitest toolchain and implement the composition
  contract with injected `SceneHost` and `UiHost` ports.
- [ ] Run the focused test, `npm run typecheck`, and `npm run build`; expect all pass.
- [ ] Commit with `git commit -m "build: establish strict TypeScript application shell"`.

### Task 2: Domain contracts, constants, and validation

**Files:**
- Create: `src/domain/model.ts`
- Create: `src/domain/config.ts`
- Create: `src/domain/track/trackValidation.ts`
- Create: `src/domain/track/starterTrack.ts`
- Test: `tests/domain/trackValidation.test.ts`

**Interfaces:**
- Produces: `Track`, `TrackPoint`, `Tree`, `SurfaceId`, `CarId`,
  `DifficultyId`, `LightingMode`, and branded `TrackId`.
- Produces: `validateTrack(track: Track): TrackValidationResult`
- Produces: `createStarterTrack(id: TrackId, now: number): Track`

- [ ] Test finite-coordinate validation, minimum nine points, closed-loop distance
  below 74, recognized surfaces, and deterministic starter-track creation.
- [ ] Run the focused test; expect missing-module failure.
- [ ] Move the exact road, car, surface, terrain, difficulty, and overtaking values
  from `trackforge.html` into readonly typed records and implement validation.
- [ ] Run focused tests and typecheck; expect pass with no non-null assertions.
- [ ] Commit with `git commit -m "feat: add typed track domain"`.

### Task 3: Safe storage adapters and legacy migration

**Files:**
- Create: `src/application/ports/storage.ts`
- Create: `src/infrastructure/storage/browserStorage.ts`
- Create: `src/infrastructure/storage/trackRepository.ts`
- Create: `src/infrastructure/storage/scoreRepository.ts`
- Create: `src/infrastructure/storage/preferencesRepository.ts`
- Test: `tests/infrastructure/storage.test.ts`

**Interfaces:**
- Produces: `KeyValueStore`, `TrackStore`, `ScoreStore`, `PreferencesStore`
- Produces: `BrowserTrackRepository.list/find/save/remove`
- Consumes: normalized domain contracts from Task 2.

- [ ] Write contract tests using an in-memory `KeyValueStore`; cover malformed JSON,
  version-1/v2 legacy keys, invalid coordinates, duplicate names, scores, and
  storage exceptions.
- [ ] Run the focused test; expect missing-adapter failure.
- [ ] Implement decoding with type guards and normalization at the boundary; preserve
  recovered tracks and write versioned v2 records.
- [ ] Run focused tests and typecheck; expect pass.
- [ ] Commit with `git commit -m "feat: add resilient browser persistence"`.

### Task 4: Geometry and editor aggregate

**Files:**
- Create: `src/domain/geometry/math.ts`
- Create: `src/domain/track/pathBuilder.ts`
- Create: `src/domain/editor/editorState.ts`
- Create: `src/domain/editor/editorCommands.ts`
- Test: `tests/domain/pathBuilder.test.ts`
- Test: `tests/domain/editorCommands.test.ts`

**Interfaces:**
- Produces: `buildRoadPath(points): RoadPath`
- Produces: `reduceEditor(state, command): EditorState`
- Produces commands for draw, move, paint, tree, erase, clear, undo, redo, expand.

- [ ] Test Catmull-Rom rebuilding, adaptive subdivision, nearest path/point,
  loop normalization, mixed-surface painting, bounded history, and undo/redo.
- [ ] Run focused tests; expect missing-module failure.
- [ ] Port `catmull` through `eraseAt` and snapshot/restore behavior as pure functions;
  return new state instead of mutating global state.
- [ ] Run both focused suites and typecheck; expect pass.
- [ ] Commit with `git commit -m "feat: add deterministic track editor domain"`.

### Task 5: Application store and typed commands

**Files:**
- Create: `src/application/appState.ts`
- Create: `src/application/appController.ts`
- Create: `src/application/eventBus.ts`
- Test: `tests/application/appController.test.ts`

**Interfaces:**
- Produces: `AppSnapshot`, `AppCommand`, `AppEvent`
- Produces: `AppController.dispatch(command): void`
- Produces: `AppController.subscribe(listener): Unsubscribe`

- [ ] Test home/editor/race transitions, guarded race start, autosave debouncing,
  selection preferences, pause-on-hidden, and idempotent disposal with fake ports.
- [ ] Run focused test; expect missing-controller failure.
- [ ] Implement a synchronous typed command dispatcher plus injected scheduling and
  persistence ports; expose readonly snapshots.
- [ ] Run focused tests and typecheck; expect pass.
- [ ] Commit with `git commit -m "feat: add application state coordinator"`.

### Task 6: Modular UI shell and screens

**Files:**
- Create: `src/ui/dom.ts`
- Create: `src/ui/uiHost.ts`
- Create: `src/ui/screens/homeScreen.ts`
- Create: `src/ui/screens/editorChrome.ts`
- Create: `src/ui/screens/raceHud.ts`
- Create: `src/ui/modals/trackLibraryModal.ts`
- Create: `src/ui/modals/raceSetupModal.ts`
- Create: `src/ui/modals/optionsModal.ts`
- Create: `src/ui/modals/pauseModal.ts`
- Create: `src/ui/modals/resultsModal.ts`
- Create: `src/ui/toast.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/layout.css`
- Create: `src/styles/components.css`
- Test: `tests/ui/uiHost.test.ts`

**Interfaces:**
- Consumes: `AppSnapshot` and `(command: AppCommand) => void`
- Produces: `DomUiHost.mount/update/destroy`

- [ ] In jsdom, test semantic buttons/dialogs, screen visibility, focus restoration,
  active editor tools, race HUD rendering, and command emission.
- [ ] Run the focused test; expect missing-host failure.
- [ ] Extract all body markup and CSS from `trackforge.html` into focused renderers and
  theme-aware styles; use safe DOM construction for track names.
- [ ] Run UI tests, typecheck, and lint; expect pass.
- [ ] Commit with `git commit -m "feat: add modular responsive game UI"`.

### Task 7: Phaser editor scene and renderers

**Files:**
- Create: `src/phaser/sceneHost.ts`
- Create: `src/phaser/scenes/BootScene.ts`
- Create: `src/phaser/scenes/EditorScene.ts`
- Create: `src/phaser/rendering/trackRenderer.ts`
- Create: `src/phaser/rendering/editorRenderer.ts`
- Create: `src/phaser/input/editorInput.ts`
- Test: `tests/phaser/editorInput.test.ts`

**Interfaces:**
- Consumes: editor snapshots and dispatches `AppCommand`.
- Produces: `PhaserSceneHost.start(mode)` and `destroy()`.

- [ ] Test pointer-to-world commands, pan/zoom clamping, pointer cancellation, and
  teardown using a fake camera/input surface.
- [ ] Run focused test; expect missing-input adapter failure.
- [ ] Port grid, trees, road edges, surfaces, stripes, curbs, editor handles, camera
  fit/rotation, and tool gestures into thin scene/rendering adapters.
- [ ] Run focused tests, typecheck, and build; manually verify starter circuit editing.
- [ ] Commit with `git commit -m "feat: deliver Phaser track editor"`.

### Task 8: Race simulation and vehicle physics

**Files:**
- Create: `src/domain/race/raceState.ts`
- Create: `src/domain/race/raceFactory.ts`
- Create: `src/domain/race/vehiclePhysics.ts`
- Create: `src/domain/race/progress.ts`
- Create: `src/domain/race/collisions.ts`
- Test: `tests/domain/raceSimulation.test.ts`

**Interfaces:**
- Produces: `createRace(options, dependencies): RaceState`
- Produces: `stepPlayer`, `updateProgress`, `solveCollisions`
- Consumes: injected `Clock` and `RandomSource`.

- [ ] Test roster/grid creation, surface modifiers, steering/braking, off-road drag,
  checkpoint/lap progression, finish order, collision separation, damage, and wreck.
- [ ] Run focused test; expect missing-race modules.
- [ ] Port `makeCar`, `drivePlayer`, progress, damage, and collision behavior without
  Phaser dependencies and with seeded randomness in tests.
- [ ] Run focused tests and typecheck; expect pass.
- [ ] Commit with `git commit -m "feat: add deterministic race simulation"`.

### Task 9: Overtaking AI

**Files:**
- Create: `src/domain/race/ai/traffic.ts`
- Create: `src/domain/race/ai/lanePlanner.ts`
- Create: `src/domain/race/ai/aiDriver.ts`
- Test: `tests/domain/aiDriver.test.ts`

**Interfaces:**
- Produces: `getTrafficState`, `scorePassingLane`, `choosePassingLane`,
  `stepAiVehicle`.

- [ ] Test follow distance, blocked-lane rejection, safe passing selection,
  emergency collision avoidance, pass completion, difficulty reaction, mistakes,
  and hard-mode mirror rival.
- [ ] Run focused test; expect missing-AI failure.
- [ ] Port the overtaking state machine and AI steering/braking calculations, passing
  all tuning through readonly difficulty configuration.
- [ ] Run focused tests and typecheck; expect pass.
- [ ] Commit with `git commit -m "feat: port committed overtaking AI"`.

### Task 10: Race scene, vehicles, lighting, and effects

**Files:**
- Create: `src/phaser/scenes/RaceScene.ts`
- Create: `src/phaser/rendering/vehicleRenderer.ts`
- Create: `src/phaser/rendering/raceEffectsRenderer.ts`
- Create: `src/phaser/rendering/nightRenderer.ts`
- Create: `src/phaser/input/raceInput.ts`
- Test: `tests/phaser/raceInput.test.ts`

**Interfaces:**
- Consumes: race snapshots and dispatches control/pause commands.
- Produces: keyboard, steering-pad, brake, and multitouch control state.

- [ ] Test keyboard/touch equivalence, two-touch braking, lost-pointer cleanup,
  visibility pause, and listener disposal.
- [ ] Run focused test; expect missing-input adapter failure.
- [ ] Port the four vehicle bodies, tires/lights/damage, dust/skids/smoke/sparks,
  speed streaks, camera shake/dynamic zoom, night mask, glows, and race rendering.
- [ ] Run focused tests, typecheck, and build; manually verify day/night races.
- [ ] Commit with `git commit -m "feat: deliver Phaser race presentation"`.

### Task 11: Audio, haptics, and complete flow

**Files:**
- Create: `src/application/ports/feedback.ts`
- Create: `src/infrastructure/feedback/webAudioAdapter.ts`
- Create: `src/infrastructure/feedback/hapticsAdapter.ts`
- Modify: `src/app/createApplication.ts`
- Test: `tests/infrastructure/feedback.test.ts`
- Test: `tests/e2e/applicationFlow.test.ts`

**Interfaces:**
- Produces: `AudioPort`, `HapticsPort`, `WebAudioAdapter`, `HapticsAdapter`
- Consumes domain/app events for surface, curb, collision, finish, and UI feedback.

- [ ] Test disabled/unavailable feedback, gesture-gated audio initialization, event
  mapping, and home→edit→save→setup→race→results→retry flow with fakes.
- [ ] Run focused tests; expect missing-feedback adapters.
- [ ] Port synthesized engine/noise/UI/impact/finish audio and vibration patterns;
  wire all screens and scene transitions through the composition root.
- [ ] Run focused tests, all tests, typecheck, lint, and build; expect pass.
- [ ] Commit with `git commit -m "feat: complete TrackForge gameplay flow"`.

### Task 12: Cutover and parity verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-23-trackforge-phaser-migration-design.md`
- Preserve as reference until parity is confirmed: `trackforge.html`

**Interfaces:**
- Consumes all prior tasks.
- Produces a Vite-only production runtime and documented controls.

- [ ] Add a smoke test that loads `dist/index.html` assets and asserts the bundle does
  not reference or execute `trackforge.html`.
- [ ] Run it first and confirm failure while any legacy runtime dependency remains.
- [ ] Remove remaining legacy runtime references, document setup/controls/storage
  migration, and record a parity checklist for every original screen and control.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
  `git diff --check`; expect zero failures.
- [ ] Commit with `git commit -m "chore: complete Phaser 4 migration"`.
