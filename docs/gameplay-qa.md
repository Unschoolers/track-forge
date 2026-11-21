# Mobile gameplay QA

The `test/gameplay-qa` change adds a **real-browser touch regression harness** to
Track Forge. Chromium uses a mobile viewport and CDP touch contacts, so the test
sends overlapping fingers to the actual Phaser canvas and the DOM brake button.

## Run locally

```sh
npm ci
npx playwright install chromium
npm run qa:mobile
npm run qa:mobile:production
```

The separate `Mobile gameplay QA` GitHub workflow runs these scenarios on
gameplay-code and dependency PRs and uploads reports and failure screenshots
for seven days. The development suite runs in four independent CI shards,
and the production smoke runs separately. Tests are assigned round-robin after
Playwright discovery to spread neighboring slow tests across shards. New tests
are included automatically, and each shard retains its own report.
Touch input, ramp rendering and performance sampling run in real time. `npm ci` installs the pinned
Playwright runner. The production smoke builds the game and starts a race
through the same UI players use.
Set `TRACKFORGE_CHROMIUM_EXECUTABLE` to a locally installed Chromium executable
to use it for either suite.

## First pass: what is actually tested

- Open a seeded track and pinch to zoom without adding or saving road points.
- Pan with two fingers, regardless of the selected editor tool.
- Start a normal arcade race and steer with the left touch while braking with
  the right touch. Releasing all touches clears both controls.
- Confirm real race time and player motion advance; sample animation-frame
  timings and attach `gameplay-metrics.json` to the browser report.
- Observe uncaught browser errors and retain screenshots/traces on failures.

The QA bridge is available via `?qa` on the **Vite development server only**.
Browser tests can advance an unattended race through the normal fixed-step
simulation. The point-to-point results test uses this for its three straight
runs. Several other tests use it for the countdown before observing real-time
input, rendering or recovery. The production smoke checks the actual countdown and game bundle.

## What this does not prove yet

The browser harness does not benchmark an actual Android GPU, confirm the
subjective quality of steering/drifting, or autonomously drive full races.
Those are follow-up stages: deterministic bot-driven race comparisons, then
occasional device-farm smoke tests using the assembled APK. Frame timings from
a shared CI machine are diagnostic, not a stable pass/fail FPS target.

Touch events are Chromium browser simulations, not physical finger hardware.

## Race performance

See the [race performance baseline](race-performance.md) for repeatable frame,
simulation and race entry measurements on Android and Chromium.

## Deterministic Arcade sector checks

`npm test -- tests/domain/arcadeSectorComparison.test.ts tests/domain/arcadeAssists.test.ts tests/domain/rampDriving.test.ts` exercises fixed-step player steering and manual braking on street and ice hairpins and straight ramps. Verify the player can approach a bend in both directions with full throttle and only applies the service brake in response to input. Compare entry and exit speed, sector time, off-road incidents, and recoveries. Test Blue and Red on a signed APK with both steering layouts on a physical phone.

## Performance sampling is opt-in on CI

`qa/browser/race-performance.spec.mjs` is a diagnostic benchmark rather than a
stable pass/fail gameplay contract. Regular CI browser shards exclude it, while
retaining the gameplay/scene/touch regressions and production startup smoke.
The test remains available locally as `npm run qa:mobile -- race-performance`.
To run it in a CI environment, set `TRACKFORGE_PERFORMANCE_QA=1` before the
same command. Continue recording physical Android results through
[race-performance.md](race-performance.md); CI host FPS is not an Android target.
