# Testing guidelines — value over volume

**Goal:** detect consequential regressions quickly with the smallest maintainable suite that still covers important *distinct* behaviors. Do not set a fixed target for number of tests or percentage of deleted tests.

## Keep/add a test only when it has a job

Before keeping or writing a test, answer:

1. **Contract:** What observable gameplay, editor, storage, UI or protocol behavior must hold?
2. **Regression:** What plausible code defect would break it? Include an actual past bug when possible.
3. **Oracle:** Would the test fail on that defect? Does it check a meaningful output/invariant, not just that a function exists?
4. **Uniqueness:** Is the same regression caught better by a faster or more direct test?
5. **Cost:** Is its execution/setup/flakiness proportionate to the risk?

If the answer is unclear, improve the assertion or remove/consolidate the test. A high-value test may be long or slow; justify why.

## Preferred test pyramid for this repo

| Level | Primary purpose | Current location |
| --- | --- | --- |
| Domain/contract | Deterministic race physics, gates, geometry, editing, normalization, scores | `tests/domain`, `tests/application` |
| Component/adapter | Phaser input/camera/rendering decisions, UI events and storage/native adapter contracts | `tests/phaser`, `tests/ui`, `tests/infrastructure` |
| Deterministic scenario | Realistic track/vehicle progress, reverse hairpins, recoveries, AI balance | `qa/lanes` and selected `tests/domain` |
| Browser touch smoke | Real multi-touch, focus, scene transitions, asset loading, presentation integration | `qa/browser` |
| Production/native smoke | Release loading, native API/signature/update/install boundaries | `qa/production`, Android tests, release verification |
| Device performance/feel | Android GPU, steering feel, haptics and real touch ergonomics | Manual/profiled device protocol |

**Prefer component/contract tests over Playwright.** Use Playwright only for browser-level interactions impossible to prove at the narrower boundary, or one representative end-to-end journey. A browser test is not a replacement for failing fast on a domain invariant.

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

1. Inventory current tests by **feature contract**, not filename. Mark each **unique**, **overlapping**, **implementation-coupled**, **flaky**, or **obsolete**.
2. Map each proposed deletion to the remaining assertion that catches the same regression. **Never delete a unique edge case just to improve totals.**
3. Combine overlapping setup/simulations, use focused matrix cases and keep readable assertions. One giant “does everything” test has poor diagnostics and should not replace several distinct behaviors.
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

Include: affected contracts; removed/consolidated tests and preserved edge cases; exact commands and results; suite runtime comparison (same machine/runner); and remaining verification gaps. The unit of success is **regressions caught per maintenance minute**, not a smaller green number.
