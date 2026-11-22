# Testing guidelines — value over volume

**Goal:** detect consequential regressions with high-signal tests while keeping feedback fast and maintenance reasonable. **Unit tests > integration tests > UI/browser tests**, both as the default choice for a new regression and as the relative share of the suite. Hundreds or thousands of inexpensive, independently valuable unit tests are welcome. Do not chase a smaller test count or a coverage percentage.

## Keep/add a test only when it has a job

Before keeping or writing a test, answer:

1. **Contract:** What observable gameplay, editor, storage, UI or protocol behavior must hold?
2. **Regression:** What plausible code defect would break it? Include an actual past bug when possible.
3. **Oracle:** Would the test fail on that defect? Does it check a meaningful output/invariant, not just that a function exists?
4. **Uniqueness:** Is the same regression caught better by a faster or more direct test?
5. **Cost:** Is its execution/setup/flakiness proportionate to the risk?

If the answer is unclear, improve the assertion, or consolidate/remove the test only after checking that its distinct regression remains protected. A high-value test may be long or slow; justify why.

## Testing proportions and cost

**Target shape (guideline, not quota): roughly 80% unit/component contracts, 15% integration/scenario tests, and 5% UI/end-to-end smoke tests.** Actual proportions follow risk and capability boundaries; do not delete a useful integration or browser test to hit the ratio.

- **Unit tests (largest share):** small, deterministic domain functions, application state transitions, validation, codecs, policies, UI/Phaser components via narrow fakes. Cheap enough to run frequently and in large numbers. Hundreds+ are fine, provided each distinct test checks meaningful behavior or an edge.
- **Integration tests (smaller share):** several real modules collaborating, e.g. race session + engine + storage, export/import migrations, seeded AI runs on representative tracks. Assert outcomes across boundaries; avoid repeatedly recreating the same expensive world.
- **UI/browser tests (smallest share):** a handful of true user-journey checks for native touch concurrency, canvas interactions, load/scene transitions, visual layering, focus, and production startup. Prefer component-level DOM tests for ordinary labels, buttons, and state wiring.

The levels describe **scope**, not just folders: `tests/ui` can contain cheap component tests, while a full race simulation under `tests/domain` may be an integration test. Track **wall-clock runtime and flakiness** separately from test count. Unit tests are very cheap, not literally free; pathological fixture setup or simulation loops can still dominate CI.

## Preferred test pyramid for this repo

| Level | Primary purpose | Current location |
| --- | --- | --- |
| Domain/contract | Deterministic race physics, gates, geometry, editing, normalization, scores | `tests/domain`, `tests/application` |
| Component/adapter | Phaser input/camera/rendering decisions, UI events and storage/native adapter contracts | `tests/phaser`, `tests/ui`, `tests/infrastructure` |
| Deterministic scenario | Realistic track/vehicle progress, reverse hairpins, recoveries, AI balance | `qa/lanes` and selected `tests/domain` |
| Browser touch smoke | Real multi-touch, focus, scene transitions, asset loading, presentation integration | `qa/browser` |
| Production/native smoke | Release loading, native API/signature/update/install boundaries | `qa/production`, Android tests, release verification |
| Device performance/feel | Android GPU, steering feel, haptics and real touch ergonomics | Manual/profiled device protocol |

**Prefer unit/component tests over integration tests, and integration tests over Playwright.** Use Playwright only for browser-level interactions impossible to prove at the narrower boundary, or one representative end-to-end journey. A browser test is not a replacement for failing fast on a domain invariant.

## Separate vehicle feel from AI race balancing

Car-handling contracts (currently `carHandlingIdentity.test.ts` and `carSpeedIdentity.test.ts`) step an isolated, typed player vehicle through the real physics adapter and deterministic surface contexts. Their setup must not call `createRace` or `RaceSession`: those also initialize AI opponents, grid placement and difficulty, which are unrelated to braking, steering, grip and acceleration. Keep authored track fixture integrity assertions distinct from those vehicle outputs.

AI race-balance scenarios (currently `emileHardRace.test.ts` and `qa/lanes`) intentionally exercise a whole race: opponent behavior, seeds, difficulty ordering, finish times and recoveries. A car-physics regression should fail in the narrow car contract; race-balance tests should fail only when AI/race player-visible behavior changes. Preserve both sets of assertions; this separation is not permission to loosen a threshold or tune a car until an unrelated scenario turns green.

### AI race pace assertions

Keep the narrow handling/speed contracts independent of race balancing. For seeded
AI integration scenarios, assert results players notice: opponents finish,
do not loop or repeatedly recover, maintain a competitive field, and preserve
**Hard → Medium → Easy** race ordering with a meaningful gap. Express recorded
ghost comparisons relative to the ghost time, not fractional-second constants
specific to one tuning revision. Broad competitiveness floors are useful safety
rails, not a demand that every car finish within one percent of another.
Do not relax the recovery/error limits or skip a failing race to make CI green.

## Build tests around risk and edges

Each feature should cover a happy path **plus the edges that would matter if broken**. Representative edge families:

- **Track geometry:** closed/open routes, reverse, diagonal checkpoint crossing, overlapping road elevations, first/last segment, short/long paths, imported degenerate coordinates.
- **Terrain/ramps:** support transitions without phantom jumps, landing/contact, elevated roads over water, hills, steep approaches, water recovery.
- **AI:** independent rival catch-up by actual progress gap, no boost when close/ahead, speed and grip differences between cars, difficulty ordering, reverse hairpins, no loop/timeout/recovery storm.
- **Editor:** undo/redo of full gesture, cancellation while two-finger panning, invalid placement rejected with feedback, camera preservation, large-track incremental redraw.
- **Multiplayer:** invalid/stale/duplicate packets, peer disconnect mid-stage, all slots and identity, packet bounds, race countdown synchronization, late callbacks.
- **Persistence/update:** malformed and legacy tracks, export/import roundtrip, migration idempotency, failed storage writes, APK version/signing compatibility.
- **Lifecycle:** pause/resume/quit, background/foreground, cleanup on mode switch, repeat races without leaked listeners or inputs.

Do **not** blindly cartesian-product every car/track/difficulty/mode. Choose representative equivalence classes, targeted boundary cases, and a small, documented integration matrix.

## Design and reuse

- Name a test for the behavior it proves: “reverse hairpin finishes without path jump,” not “calls runLaneCheck.”
- Build reusable **valid** fixtures in `tests/fixtures`, then override only inputs relevant to the case. Use real track JSON for reproduction cases, small synthetic tracks for isolated properties.
- Use deterministic fake clock, seeded or injected random source, and fixed-step simulation when appropriate. Timeouts and sleeps are not correctness oracles.
- Parameterize genuinely different cases when the contract is identical; keep distinct tests when their failure diagnosis or contracts differ.
- Assert final outcomes and invariants. Avoid mirroring every intermediate private state, implementation call counts, snapshots of enormous DOM trees, or arbitrary tunable constants. Exact protocol bytes are an exception where encoding is the public contract.
- For every scenario requiring a helper, ask if it is shared **behavioral setup** or just duplicated trivial syntax. Extract the former; don't over-abstract the latter.
- Be careful with `requireFixture`: an invalid fixture should fail loudly, not be silently replaced with a fallback.
- No global mutable setup shared across tests. Clean up subscriptions, touch contacts, storage, Phaser objects and fake timers.

Example of a strong, narrow contract:

```ts
it('rejects malformed nearby pose packets', () => {
  expect(decodePose(new Uint8Array([Packet.Pose]))).toBeNull()
})
```

This is better than a browser race proving merely that a nearby UI opened. Add valid roundtrip and out-of-order cases separately only when they protect different failure modes.

## Consolidation and deletion rules

1. Inventory current tests by **feature contract and scope** (unit / integration / UI), not filename. Mark each **unique**, **overlapping**, **implementation-coupled**, **flaky**, or **obsolete**.
2. Preserve numerous cheap unit tests when their cases are independently useful. Map each proposed deletion to the remaining assertion that catches the same regression. **Never delete a unique edge case just to improve totals.**
3. Prioritize consolidating expensive integration/browser setups over shaving tiny unit tests. Combine overlapping setup/simulations, use focused matrix cases and keep readable assertions. One giant “does everything” test has poor diagnostics and should not replace several distinct behaviors.
4. Remove tests of internal tuning values only if the meaningful boundary behavior is covered elsewhere. Config validation can be valuable when it prevents a real build/runtime failure.
5. Record what was removed, why, what now protects it, and before/after duration. Keep changes isolated from production refactors where possible.
6. Introduce a deliberate defect (or mutation) for risky consolidated cases when feasible; if no test fails, its oracle is too weak.

## Running and interpreting checks

```sh
npm test -- tests/domain/aiCatchUp.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run verify
npm run qa:mobile
npm run qa:mobile:production
npm run qa:lanes
```

Use narrow `vitest run` first, then relevant suite(s). Browser and lane suites are specialized, not all part of `npm test`. Native Android checks run in the native CI job when required (see `.github/workflows/build.yml`). A pass in Chromium does not establish Android GPU performance or real-world steering feel.

If a check fails, reproduce, diagnose, and fix its **cause**. Never use `skip`, raise thresholds, silently catch errors, or weaken an assertion solely to turn CI green. If a test is flaky, preserve evidence, isolate the nondeterminism, and explain the replacement oracle before removal.

## PR proof for a test refactor

Include: affected contracts; removed/consolidated tests and preserved edge cases; exact commands and results; suite runtime comparison (same machine/runner); and remaining verification gaps. The unit of success is **regressions caught per maintenance minute and CI minute**, not a smaller green number. A refactor that retains or grows the unit suite while reducing expensive browser/integration runs can be an improvement.
