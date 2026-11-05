# Mobile gameplay fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Make mobile driving controllable and remove six verified gameplay defects.
**Architecture:** Preserve the domain/application/Phaser/DOM boundaries. Apply one reviewed task at a time on the isolated gameplay branch.
**Tech Stack:** Phaser 4, TypeScript 7, Vitest 3, Vite 7, Capacitor 8.6.0.
**Spec:** docs/superpowers/specs/2026-11-04-mobile-gameplay-fixes-design.md

## Global Constraints
- Keep Phaser 4, TypeScript 7, Capacitor 8.6.0 and the existing dependencies; add no packages.
- Preserve saved tracks, preferences, score formats, application origin and Android signing/distribution configuration.
- Keep automatic acceleration and keyboard driving. Brake cuts drive torque.
- A touch begins at neutral; relative horizontal motion steers with a small dead zone and visible feedback. A separate brake touch must work concurrently.
- Touch cancellation, capture loss, focus loss and scene transitions must release controls safely.
- Preserve direction-aware lap gates/rankings and safe forward/reverse recovery.
- Completed opponents retain finish times/results without blocking or damaging racers still driving.
- Use meaningful regression tests for the reported bugs. Do not weaken unrelated tests.
- Work only in this isolated branch, commit each task, and do not push; the coordinator publishes to main after review.


## Review Focus
- Overlapping steering/brake touches, capture loss and finger handoff must not latch or misreport steering: Task 1.
- Deliberate braking versus genuine acceleration against an obstruction: Task 2.
- Crossings with different heights and close route indices, ordinary ramps, off-road/water and reverse travel: Task 3.
- Nonblocking lateral/vertical traffic versus a genuine closing obstacle: Task 4.
- Finished opponents near an unfinished racer, and mobile recovery across countdown/pause/results: Tasks 5 and 6.

### Task 1: Floating mobile steering
**Files:** src/ui/screens/raceHud.ts, src/phaser/input/raceInput.ts, src/phaser/scenes/RaceScene.ts, src/styles/components.css and layout.css; add a focused steering-gesture helper under src/phaser/input if useful; tests/phaser/raceInput.test.ts and tests/ui/raceFlow.test.ts plus a focused helper test if added.
**Interfaces:** Preserve RaceControlsPort beginSteering/updateSteering normalized inputs and keyboard controls. Task 6 will extend the HUD actions separately after this task.
- [ ] RED: Prove off-centre touchdown is neutral, horizontal movement reaches opposite locks with a 48 CSS-pixel range/0.08 dead zone, the knob reflects actual steering, capture loss clears steering/braking, overlapping steering fingers hand off deterministically, and a real brake works alongside steering without treating any second finger as brake. Existing two-touch-braking tests may be updated because this is an intentional explicit-brake design change.
- [ ] Implement the accepted relative control on both DOM pad and canvas fallback. Use consistent normalization; handle viewport resize/scale conversion, release/cancel/capture-loss/focus/shutdown; protect game gestures with touch-action while preserving modal scrolling.
- [ ] GREEN: Run focused input/HUD/gesture tests and typecheck; self-review; commit as a standalone fix and write report. Do not add a control-mode settings screen.

### Task 2: Intentional braking and automatic recovery
**Files:** src/domain/race/raceEngine.ts, tests/domain/raceSimulation.test.ts or a focused recovery test.
**Interfaces:** Consume DriverInput.braking and throttle as now; preserve resetVehicleToTrack and forward/reverse behavior.
- [ ] RED: On a running race after elapsed 2, place a stationary player 20 world units off centre on the road, hold braking=true/throttle=1 for 90 steps at 1/60. Position/heading must not snap and stuckDuration must not accumulate. Keep coverage that a genuinely stuck accelerating player can recover.
- [ ] Gate stuck accumulation on a real request to move, excluding intentional braking. Keep the existing recovery thresholds and no timing/scoring changes.
- [ ] GREEN: Run relevant recovery/race tests, self-review, commit and write report.

### Task 3: Correct road level and branch at crossings
**Files:** src/domain/race/trackContext.ts and a focused domain topology test; change pathBuilder/roadSurface/vertical dynamics only if necessary for the root cause.
**Interfaces:** Preserve getVehicleStepContext signature or update its real callers coherently; keep gradeForTravel and reset/water safety semantics.
- [ ] RED: Reproduce the race-ready nine-point crossing fixture from /workspace/scratch/1ac2fcb1a435/audit-next/physics/repro.ts. It has a 2,164-unit closed route and lower/upper crossings at path indices 16/89. At lane 0, straight lower-road travel currently snaps z=0 ->24 ->0 at frames 30/33. Pin correct branch and support across lane offsets and reverse travel, with deck travel retained.
- [ ] Implement compatible route/support selection, avoiding 2D-nearest jumps to unrelated branches. Cover a close crossing whose branches fall in the search window, ordinary ramp entry/exit, and reacquisition after leaving the road. Inspect existing crossing, water and vertical-dynamics tests.
- [ ] GREEN: Run focused topology, crossing, water, reverse and vertical tests; self-review, commit and write report. Explain the continuity rule and its limits.

### Task 4: AI reacts to blocking traffic
**Files:** src/domain/race/ai/traffic.ts, src/domain/race/ai/aiDriver.ts if needed, tests/domain/aiDriver.test.ts and/or aiRaceIntegration.test.ts, reverseRace.test.ts as needed.
**Interfaces:** TrafficState.nearby retains useful competitor observations for lane planning; ahead represents an actual relevant obstruction. Preserve metre-based forwardDistance and reverse direction.
- [ ] RED: On the starter track, two on-road cars have 18 units forward path gap, lane positions -20/+20, world gap about 44.5. The AI must not emergency-brake merely for this other-lane car. Same-lane closing traffic must still brake; cars on another height/branch and clearly off-road must not be phantom obstacles; reverse/wrapped gaps remain correct.
- [ ] Implement a collision-relevant traffic corridor with sensible vehicle clearance, retaining nearby cars for pass planning. No rubber-banding or difficulty retuning.
- [ ] GREEN: Run focused AI and reverse tests; self-review, commit and write report.

### Task 5: Clear finished opponents from active racing
**Files:** src/domain/race/collisions.ts, src/domain/race/ai/traffic.ts, src/phaser/scenes/RaceScene.ts and focused tests/domain/raceSimulation.test.ts, aiDriver.test.ts or rendering tests as relevant.
**Interfaces:** Preserve RaceVehicle.finishedAt, rankVehicles and result standings. Task 4 traffic changes are already present.
- [ ] RED: A finished rival within collision distance must not produce player damage/impulse or block unfinished AI. A real unfinished rival must still collide and obstruct appropriately. Verify a completed opponent is not drawn as a stationary roadblock while the player continues.
- [ ] Exclude finishers from active collision/traffic interactions and hide finished opponent presentation consistently (vehicle, shadow, lights) during the active race. Keep finish times/standing data untouched; preserve the player finish flow.
- [ ] GREEN: Run focused domain/rendering/result tests; self-review, commit and write report.

### Task 6: Mobile car recovery
**Files:** src/ui/screens/raceHud.ts, src/ui/uiHost.ts, src/application/race/raceSession.ts, src/styles/components.css/layout.css as needed; tests/ui/raceFlow.test.ts and tests/application/raceSession.test.ts.
**Interfaces:** Reuse RaceSessionPort.resetPlayer(); HUD actions may gain recover():void. Task 1 controls are already present. No new recovery penalty or persistence shape.
- [ ] RED: An accessible RECOVER action invokes the shared reset during active unpaused racing and clears held input. It is disabled/ineffective in countdown, pause and finished states. Direct keyboard/shared-session resets obey the same lifecycle guards and keep progress/damage intact.
- [ ] Wire the touch action to existing recovery; preserve R-key semantics. Arrange it without overlapping steering/brake at small portrait/landscape dimensions, using existing touch target conventions.
- [ ] GREEN: Run focused HUD/session tests, self-review, commit and write report.

### Task 7: Android immersive fullscreen
**Files:** android/app/src/main/java/io/trackforge/app/MainActivity.java; native theme/manifest only if required.
**Interfaces:** Preserve Capacitor BridgeActivity lifecycle and trackforge:pause; existing AndroidX core 1.17.0, min24/target36.
- [ ] Use WindowCompat/WindowInsetsControllerCompat to hide systemBars with BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE on create/resume/focus regain. Keep keyboard, safe areas and orientation usable; no browser fullscreen prompt or new plugin/dependency.
- [ ] Review lifecycle/super calls against installed Capacitor and official Android documentation. Validate native compilation through the Android build; avoid source-text tests that mirror the implementation. Report physical-device verification limits.
- [ ] Commit the native change separately and write task-7-report.md.

## Integration
- [ ] Review spec compliance and quality for each task before proceeding.
- [ ] Run full tests, typecheck, lint, production build and Capacitor sync once on integrated changes.
- [ ] Review the whole branch independently; resolve material findings.
- [ ] Publish the reviewed tree to main with an expected-head guard, wait for full Android/release CI, download the APK and verify signature/metadata.
