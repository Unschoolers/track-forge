# TrackForge Priority Fixes and Android Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix the five audited bugs and ship downloadable Android APKs on successful builds.
**Architecture:** Preserve the current modular Phaser game. Fix application/domain invariants with regression tests, then package its Vite assets with Capacitor and GitHub Actions.
**Tech Stack:** Phaser 4, TypeScript, Vitest, Vite, Capacitor Android, GitHub Actions.
**Spec:** docs/superpowers/specs/2026-11-03-priority-fixes-android-design.md

## Global Constraints
- Execute the five bug fixes sequentially with a separate implementer subagent per bug and focused independent review before moving on.
- Keep Phaser 4, TypeScript and Vite; no game engine migration or unrelated feature work.
- Add meaningful failing regression tests before behavior changes; never weaken existing tests to hide a regression.
- Do not commit generated dist output, dependencies, local Android SDK/JDK paths, APKs, or private signing keys.
- Merge only after the complete test suite, typecheck, lint, production build, and Android CI succeed.
- Keep existing saved track formats and browser behavior compatible.

## Review Focus
- Saving immediately before rename/navigation/reload preserves edits; deletion never resurrects a track (Task 1).
- Actual results-to-editor state transition leaves no blocking modal or active race (Task 2).
- Reverse AI/recovery/camera direction works away from the default start (Task 3).
- Low frame rates and a countdown crossed mid-frame preserve simulated time; pause/restart clear residual time (Task 4).
- Cars straddling the start line and relocated/reversed starts rank by travel direction (Task 5).
- Android loads local bundled assets offline, is signed/installable, and failed verification never uploads a success APK (Task 6).

### Task 1: Preserve pending editor saves
**Files:** src/application/appController.ts; src/application/library/trackLibraryService.ts if needed; src/main.ts lifecycle hooks; tests/application/appController.test.ts.
**Interfaces:** Keep AppCommand behavior compatible. A public synchronous flushPendingEditorSave(): boolean may be added for lifecycle events.
**Requirements:** Reproduce edit -> rename/select/create/destroy before the 120 ms debounce fires. Persist the latest draft before library reads or replacements and on normal lifecycle teardown. Keep a failed pending save retryable and show a truthful notice. Explicit deletion cancels pending writes for the deleted track so it cannot be resurrected. Consider preferences while a draft is pending so a stale callback cannot overwrite newer track metadata.
- [ ] Add focused failing tests for rename, switching tracks/creating a track, teardown, failed writes, and deleting the current track with a pending edit.
- [ ] Run focused tests and record expected failures.
- [ ] Implement minimal pending-draft flushing/cancellation and appropriate pagehide/visibility lifecycle integration.
- [ ] Run focused tests, full npm test -- --maxWorkers=2, npm run typecheck and npm run lint.
- [ ] Self-review and commit only task files. Write the required report with red/green evidence.

### Task 2: Make results-to-editor navigation usable
**Files:** src/application/appController.ts; tests/application/appController.test.ts; tests/ui/raceFlow.test.ts if a real flow test is useful.
**Interfaces:** Existing open-editor AppCommand and results Edit Track action remain public contracts.
**Requirements:** A finished race -> results -> open-editor must end with mode editor, overlay none, and paused false. Stop/silence the race session as appropriate. Preserve current track, pending saved content and editor history. Retry and home must keep working.
- [ ] Add an actual state-transition regression that fails on the current implementation, not merely an assertion that a mocked dispatch was invoked.
- [ ] Run it to prove failure, implement the minimal transition fix, then confirm the regression passes.
- [ ] Run full npm test -- --maxWorkers=2, typecheck and lint.
- [ ] Self-review, commit task files and write report.

### Task 3: Make reverse races consistent
**Files:** src/domain/race/raceFactory.ts; src/domain/race/ai/aiDriver.ts; src/domain/race/ai/traffic.ts; src/domain/race/trackContext.ts; src/domain/race/raceEngine.ts; src/application/race/raceSession.ts; focused domain/application tests.
**Interfaces:** Optional reversed = false parameters may be appended to stepAiVehicle, getTrafficState, and buildRaceCameraHints. Use existing TrackResetTarget.reversed for resetVehicleToTrack. Ranking remains Task 5.
**Requirements:** Reverse grid tangents face reverse travel; pathIndex matches actual placement. AI pursues decreasing authored indices and detects traffic ahead in that direction. All manual/automatic recovery uses race.reversed. Camera looks along the active travel direction. Keep authored road tangent/grade canonical for physical gravity. Normal-direction behavior remains compatible.
- [ ] Add failing tests for reverse spawn facing, reverse AI travel and traffic, manual/automatic reset direction, and camera lookahead with a moved start.
- [ ] Confirm failures, implement the direction propagation and grid correction.
- [ ] Run focused tests and full npm test -- --maxWorkers=2, typecheck and lint.
- [ ] Self-review, commit and report. Document any appended signatures for later tasks.

### Task 4: Preserve time across low frame rates
**Files:** src/application/race/raceSession.ts; src/phaser/scenes/RaceScene.ts; an optional small domain/application fixed-step helper; tests/application/raceSession.test.ts; focused simulation tests.
**Interfaces:** RaceSessionPort.advance(deltaSeconds, input) remains the frame-delta boundary. RaceScene supplies its actual non-negative frame delta. Domain stepRace receives bounded fixed simulation steps.
**Requirements:** Carry fractional time between frames, consume countdown overflow, and simulate normal 10/20/30/60/120 Hz frame sequences consistently rather than truncating every frame to 33 ms. Bound catch-up for pathological/background deltas; ignore non-finite/negative deltas safely. Clear carried time on start/restart and pause/resume. Stop stepping and record a score only once after a terminal outcome. Avoid publishing UI/feedback once per physics substep where one per frame suffices.
- [ ] Add failing real-session tests comparing equal real durations across frame rates, countdown overflow, pause/restart remainder handling, invalid deltas and terminal-event persistence.
- [ ] Record failures, implement a small fixed-step accumulator and remove per-frame time loss.
- [ ] Run focused tests and full npm test -- --maxWorkers=2, typecheck and lint.
- [ ] Self-review, commit and report any deliberate catch-up limit.

### Task 5: Rank by race-relative progress
**Files:** src/domain/race/ranking.ts; src/application/race/raceSession.ts ranking call sites; tests/domain/raceSimulation.test.ts; tests/application/raceSession.test.ts if needed.
**Interfaces:** Extend raceProgress and rankVehicles with optional startPathIndex = 0 and reversed = false parameters or one small explicit race-progress context. Wire all session call sites.
**Requirements:** A vehicle just beyond the first start crossing outranks one still behind the grid line. Correct ordering for relocated starts that cross the authored path seam and for reverse travel. Completed laps and finish times take precedence; ties preserve grid order. Do not change checkpoint or finish eligibility rules.
- [ ] Add failing regression tests for initial start-line straddling, moved start across the path seam, reversed progress, finished ordering and ties.
- [ ] Record failures; implement normalized directed progress and wire race context.
- [ ] Run focused tests and full npm test -- --maxWorkers=2, typecheck and lint.
- [ ] Self-review, commit and write report.

### Task 6: Build and distribute Android APKs
**Files:** package.json and package-lock.json; capacitor.config.json; android/ native project excluding generated/local files; .github/workflows/build.yml; README.md; .gitignore; Android build helpers if needed.
**Interfaces:** The production Vite dist is the Android webDir. Add npm commands for Android sync and APK build as appropriate. GitHub Actions exposes a uniquely named debug APK per successful build.
**Requirements:** Use compatible pinned Capacitor 8 packages, Java 21 and Android API 36. Reuse prior Android package identity if retrieved by the coordinator; otherwise io.trackforge.app is the fallback. Bundle local production assets with no dev server/external runtime dependency. Wire Android app backgrounding to existing save/pause lifecycle if browser events are insufficient. CI triggers on push, pull_request and workflow_dispatch; verification gates packaging; use minimum permissions; upload APK with unique run/commit metadata and a direct artifact link in the job summary; keep artifacts for 30 days. Use increasing version codes. Do not commit private signing material. For routine downloadable debug builds a persistent CI debug keystore cache is acceptable, but document cache loss/first-install identity limits and support a supplied signing secret without requiring it. The coordinator will supply any recoverable existing app ID/signing requirements before dispatch.
- [ ] Inspect the installed/generated Capacitor template and official requirements. Generate the small native Android wrapper and scripts.
- [ ] Add focused behavioral tests for any hand-written runtime helpers; do not add tests that only restate generated configuration.
- [ ] Add CI verification + signed debug APK packaging/upload and clear download/build/install documentation.
- [ ] Run complete npm test -- --maxWorkers=2, typecheck, lint, production build, Capacitor sync, and an Android assembleDebug if the SDK is available; report exact limitations otherwise.
- [ ] Self-review, commit, and report. The coordinator must obtain a successful GitHub Android build and APK before final merge/delivery.
