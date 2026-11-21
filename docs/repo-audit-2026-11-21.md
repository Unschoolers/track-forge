# Repo-wide engineering audit — 2026-11-21

**Basis:** inspected the complete `main` repository file tree at commit `5367b61c1453dad5444fafb6523c6a09ce42dee7`, existing docs/workflows, and representative source/test/adapter files. This is a **static review**, not a local benchmark or executed test run. Treat findings as prioritization hypotheses until profiling or a focused review confirms them.

## Snapshot

- 446 tracked blobs, including 185 files under `src/` (assets included).
- 111 Vitest `tests/**/*.test.ts` files, 15 `qa/browser/*.spec.mjs` browser specs, and 4 native Java test files.
- Current docs cover gameplay QA, AI lane checks, race performance, historical refactoring/parity, and dated designs. No repository-wide normative engineering or testing guide was present before this change.
- Tooling: strict TypeScript, Vitest, Playwright, Biome, Vite, Phaser, Capacitor, native Android Gradle.
- CI has web build and JavaScript verification jobs; Android build is conditional; signing/release is protected and main-only.

**These counts are inventory, not evidence of overtesting or poor quality.** Hundreds of valuable unit tests are welcome. The audit should prioritize expensive integration/browser duplication, fixture maintenance and weak assertions—not unit-test count. Count and file length alone should never trigger deletion.

## Risk-ranked opportunities (proposals, not completed fixes)

| Priority | Observation and path | Why investigate | First safe move |
| --- | --- | --- | --- |
| P1 | `src/application/appController.ts` (~34 KB), `src/application/race/raceSession.ts` (~27 KB), `src/ui/uiHost.ts` (~23 KB) coordinate many concerns | Changes can span many modes and lifecycle edges | Map command/event responsibility; move cohesive decisions into existing domain/application modules without changing external contracts |
| P1 | `src/domain/race/raceEngine.ts` (~28 KB) is central to physics, AI, gates and recovery | A change may break diagonal checkpoints, ramps, reverse AI or finish | Keep deterministic fixed-tick contract suite; extract a focused rule only with an exact regression |
| P1 | `src/application/multiplayer/nearbyRace.ts` (~30 KB) handles staged state and network events | Out-of-order/disconnect/malformed data risks | Add focused protocol/state transition matrix; avoid broad browser setup |
| P1 | `tests/application/appController.test.ts`, `tests/application/raceSession.test.ts`, `tests/ui/raceFlow.test.ts` each have broad setups | Expensive maintenance and overlapping behavior are plausible | Inventory assertions by contract; consolidate setup, not distinct behavioral outcomes |
| P2 | `tests/domain/aiRaceIntegration.test.ts` has two 600-frame stability/recovery scenarios with overlapping path-distance checks | Similar work can obscure distinct normal/wrecked-player coverage | Share a deterministic run helper and assert each scenario's unique invariant; do not drop normal-player coverage |
| P2 | `tests/domain/aiOfficialPace.test.ts` loops 24 car/track combinations per difficulty and `tests/domain/aiHardPace.test.ts` has focused hairpin cases | Wide deterministic runs may be slow; overlap needs measured proof | Time each case; retain broad median as scheduled/relevant gate if not needed per-change, keep targeted hairpin regression |
| P2 | 15 browser specs plus a separate production smoke | Browser runs are higher cost and may duplicate component cases | Map to real browser-only capabilities: multi-touch, scene transition, rendering, startup. Remove redundant UI wiring coverage only after unit replacement |
| P2 | `src/phaser/scenes/EditorScene.ts`, `src/phaser/input/editorInput.ts`, `src/domain/track/trackGeometryCache.ts` | Editor pointer movement and large terrain have caused expensive redraws | Keep render-invalidation contract tests and profile representative large tracks before altering caches |
| P2 | `src/domain/race/raceEngine.ts` imports `RandomSource` from `application/ports/random.ts` | Inverted domain → application dependency | Move random port to domain-neutral boundary in a dedicated refactor; preserve public type imports during migration |
| P3 | `src/styles/components.css` (~20 KB) plus specialized stylesheets | Shared controls could accumulate CSS duplication | Standardize on `styles/tokens.css`; review selector ownership before extracting components |
| P3 | `src/domain/race/vehiclePhysicsConfig.ts` and many exact-configuration assertions | Tuning tests may resist intentional balancing | Prefer behavioral car/surface parity and capability tests; retain exact assertions only for compatibility/protocol constraints |

## Hot paths to protect during refactoring

1. **Geometry truth and cache invalidation:** `TrackGeometryService` is shared. Test editor move/undo and camera persistence; ensure terrain/structure changes invalidate correctly.
2. **Fixed-step race lifecycle:** stable simulation, checkpoint gating, recovery and landing. AI scenarios must preserve physical route direction and variation across tracks and cars.
3. **Inbound data:** `trackCodec`, `trackValidation`, `raceWire`, `trackTransfer` and native callbacks must reject malformed or oversized inputs without runaway work.
4. **Network/release identity:** packet layout, 4-player lifecycle and Android signature/version updates are compatibility contracts, not optional UI details.
5. **Mobile tactile experience:** two-finger cancel, simultaneous steering and braking, responsive editor, no ramp flicker, no hidden player identity.

## Recommended sequence

**A.** Adopt the new docs as a change-review checklist. **B.** Classify suites by unit/integration/UI scope and inventory high-maintenance cases by *distinct contract*. **C.** Retain or expand cheap edge-case unit tests; consolidate one proven expensive integration/UI duplication or one shared fixture per PR, while preserving strong negative/edge cases. **D.** Simplify orchestration at stable boundaries only after test coverage demonstrates its contract. **E.** Measure CI duration and runtime/performance before claiming savings.

## Verification gap

No source tests, browser runs, Android builds or runtime profiling were executed for this static audit. The audit does not declare any particular test redundant or production file defective solely from size. The next implementation PR should record baseline command durations and actual failures.

## Implementation follow-up: AI integration test consolidation

The fourth scenario in `tests/domain/aiRaceIntegration.test.ts` was named *recovers opponents pushed beyond the drivable verge*, but neither vehicle was displaced before 600 simulated frames. It only rechecked normal AI distance-to-road, already exercised more strongly by the neighboring long-run stability scenario. Deleted that redundant 600-frame loop **without weakening any assertion**.

The actual off-road recovery contract remains in `tests/domain/aiRecoveryEvents.test.ts`: it explicitly teleports an AI rival to (4000,4000), steps real physics, asserts an `off-road` recovery event at the pre-reset position, and checks the recovered car returns near the track. Water and bridge recovery have their own independent edge cases.

Baseline CI (`main` run 44876316014) reported `aiRaceIntegration.test.ts` **4 tests, 331 ms**. Follow-up PR #125 CI (same GitHub workflow class, run 44876916175) reported **3 tests, 21 ms**, with **112/112 test files passing**. The prior main-branch run 44876316014 reported **4 tests, 331 ms**. These are runner observations rather than a controlled same-host benchmark. This removal is based on redundant behavior, not a test-count target.

## Implemented responsibility slices (2026-11-21)

- **PR #131 / RaceEngine:** 708 → 490 lines; per-vehicle integration, arcade checkpoint gates and authored/fallback recovery now have distinct domain owners. Existing recovery exports remain compatible. Full test/build, deterministic AI lane QA and mobile QA passed.
- **PR #132 / RaceSession:** 683 → 544 lines; score/result recording and sound/haptic feedback policies extracted while the session retains lifecycle and fixed-tick scheduling. Focused score-failure, nearby/water and feedback tests; full CI and mobile QA passed.
- **PR #133 / NearbyRace:** 647 → 565 lines; adaptive pose transmission, relay and late-send cancellation extracted from the multiplayer lobby; unchanged 19-byte pose format. Targeted 30/60 Hz, spoof, stale-packet and reset tests; full CI and mobile QA passed.

These fix the specifically observed *mixed responsibility* findings. **File size alone is not a residual defect**; orchestration is a legitimate reason for remaining lines. Further splitting needs a concrete independent change reason, an invariant to protect, and before/after evidence; do not invent abstractions just to shrink files.
