# AI Lane Checker Implementation Plan

> Execute inline, with focused regression tests and a final independent review.

**Goal:** Batch actual AI races without graphics and inspect path failures as dots.
**Architecture:** Production recovery events; a QA monitor and seeded simulation;
a Node CLI loading TypeScript through installed Vite; static SVG/HTML and JSON.
**Tech stack:** Existing TypeScript, Vite, Vitest, Node 22+.
**Spec:** `docs/superpowers/specs/2026-11-05-ai-lane-checker-design.md`.

## Constraints and review focus

No new dependencies, no AI tuning, fixed 1/60 s timestep. Normal diagnostics do
not gate CI; strict mode does. Handle reverse wrap, crossing arms/height, finished
cars, malformed tracks/options, seeded repeatability, and hidden recoveries.

### Task 1: Recovery telemetry and monitor

- [x] Test recovery events with original location and reason, then add events.
- [x] Test lane/off-road/wrong-way/stall persistence, route wrap, invalid state,
  and finished-car exclusion, then implement `qa/lanes/monitor.ts`.
- [x] Run focused tests; expected all green.

### Task 2: Seeded simulation and batch CLI

- [x] Test deterministic output and real physics/progress, completion/timeout,
  solo/traffic separation and option validation before implementation.
- [x] Implement fixtures, runner and `qa:lanes`; accept existing saved track JSON.
- [x] Run repeatable batches; expected matching core JSON, faster than real time.

### Task 3: Reports and integration

- [x] Test report escaping and positional markers before report implementation.
- [x] Add HTML/SVG dot trails, JSON, documentation, ignore entries and optional
  GitHub QA workflow artifact upload.
- [x] Run full tests, typecheck, lint, build and a real batch. Review the report
  visually and publish the change as a reviewable repository branch/PR.

## Verification and review

- Baseline: 392 tests passed. Final suite: 432 tests across 55 files passed.
- Typecheck, lint, production build and git whitespace checks passed. The build
  retains the existing Phaser bundle-size warning.
- A 24-run real matrix covered three tracks, solo/traffic, forward/reverse and
  two seeds: 414 simulated seconds in 13.0 wall seconds (31.8×). All drivers
  finished, with genuine off-road recoveries and crossing path jumps recorded.
- Independent review found finish-frame omission, post-finish event pollution,
  unbounded imported geometry compilation, and origin-biased map bounds. Four
  reproductions failed before fixes and passed afterward; the full suite passed.
- Review choice: protect compilation with QA-only 2,000-control/10,000-curve-sample
  budgets; unusually large valid tracks must be split or budgets deliberately
  adjusted. Translate tracks without imposing an absolute-coordinate limit.
- Strict mode was exercised (exit 1 on findings). SVG geometry/dots were visually
  inspected via a static render. Chromium preview was unavailable because the
  browser download was blocked; report structure and escaping are tested.
