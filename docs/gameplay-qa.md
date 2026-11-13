# Mobile gameplay QA

The `test/gameplay-qa` change adds a **real-browser touch regression harness** to
Track Forge. Chromium uses a mobile viewport and CDP touch contacts, so the test
sends overlapping fingers to the actual Phaser canvas and the DOM brake button.

## Run locally

```sh
npm ci
npm install --no-save --package-lock=false @playwright/test@1.64.1
npx playwright install chromium
npm run qa:mobile
```

The separate `Mobile gameplay QA` GitHub workflow runs these scenarios on
every gameplay-code PR and uploads reports and failure screenshots for seven
days. The QA runner version is pinned in the workflow without changing the
existing Android dependency lockfile.

## First pass: what is actually tested

- Open a seeded track and pinch to zoom without adding or saving road points.
- Pan with two fingers, regardless of the selected editor tool.
- Start a normal arcade race and steer with the left touch while braking with
  the right touch. Releasing all touches clears both controls.
- Confirm real race time and player motion advance; sample animation-frame
  timings and attach `gameplay-metrics.json` to the browser report.
- Observe uncaught browser errors and retain screenshots/traces on failures.

Inspection is read-only via `?qa` on the **Vite development server only**.
The QA bridge is not present in production APKs.

## What this does not prove yet

The browser harness does not benchmark an actual Android GPU, confirm the
subjective quality of steering/drifting, or autonomously drive full races.
Those are follow-up stages: deterministic bot-driven race comparisons, then
occasional device-farm smoke tests using the assembled APK. Frame timings from
a shared CI machine are diagnostic, not a stable pass/fail FPS target.

Touch events are Chromium browser simulations, not physical finger hardware.

## Deterministic Arcade sector checks

`npm test -- tests/domain/arcadeSectorComparison.test.ts tests/domain/arcadeAssists.test.ts tests/domain/arcadeSpeedPlanner.test.ts tests/domain/rampDriving.test.ts` exercises fixed-step player steering and braking on street and ice hairpins, the capped assist, and straight ramps. The hairpin controller is a repeatable diagnostic, not a substitute for a human driver: compare entry and exit speed, sector time, off-road incidents, and recoveries before drawing conclusions about handling changes. Test Blue and Red on a signed APK with both steering layouts on a physical phone; distinguish a control-layout problem from the car's behavior before tuning physics.
