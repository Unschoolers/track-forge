# Arcade Ghost Race Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Save usable Arcade ghosts with recoveries and let players explicitly choose solo Ghost Race or normal AI racing.

**Architecture:** Extend RaceSession and the existing ghost store. Race setup queries availability from the session for the selected configuration; a persisted raceMode flows through AppController. Renderer consumes explicit replay cuts.

**Tech Stack:** TypeScript, Web Storage, Phaser, DOM UI, Vitest and Playwright.

**Spec:** docs/superpowers/specs/2026-11-06-arcade-ghost-race-design.md

## Global Constraints
- Ghost Race remains visible but disabled without a matching replay.
- No new dependencies or hosted services; preserve fastest replay per existing key.
- Arcade recoveries must not invalidate completed recordings; Simulation clean-run behavior remains.

## Review Focus
- Recovery discontinuities must not interpolate across the map.
- Long races must stay recordable with bounded memory.
- Car/lap/handling changes must recompute availability and safely fall back.
- Ghost Race must remove AI and retain its original target after a new best.
- Storage failures must not erase the old ghost or imply a successful save.

### Task 1: Recording and storage
- [x] Add failing tests for Arcade recovery/manual reset, cut interpolation, long recording, mode selection and quota retry.
- [x] Add optional GhostFrame.cut; bounded compaction and strict persisted validation; retry by evicting older combinations.
- [x] Update RaceSession recording, ghost availability query and explicit normal/ghost setup mode.
- [x] Run ghost and session tests, confirming red then green.

### Task 2: Setup, HUD and results
- [x] Add failing DOM/preferences tests for visible disabled Ghost Race and matching target selection.
- [x] Persist raceMode, wire controller/start/query UI, add solo ghost target HUD and finish copy/save status.
- [x] Run focused tests, confirming red then green.

### Task 3: Integration and delivery
- [x] Add browser regression for disabled button, saved-ghost selection, solo race and normal race.
- [ ] Run npm run verify and independent review; address findings.
- [ ] Open PR, wait for mobile/Android CI, merge and verify main matches the tested tree.

### Added request: downhill ramp speed
- [x] Reproduce forced braking for every car on descending ramps in both directions and both handling modes.
- [x] Use signed grade in the actual race direction; only approaching climbs receive the automatic 110-unit speed limit.
- [x] Run tests/domain/arcadeAssists.test.ts, including existing uphill braking coverage.

## Review fixes
- Repeated recoveries at the same elapsed time retain the original pre-cut position.
- Compaction retains cut timestamps instead of shifting them onto later samples. If cuts themselves exceed the frame budget, retained cuts still prevent interpolation across skipped recoveries.
- Descending cars bypass ramp anticipation even if another climb is nearby.
- A failed attempt to save a faster replay displays an explicit failure while retaining the previous replay.

All four findings have failing-then-passing regressions. The first whole-suite run passed 547 tests; the final expanded suite is verified before delivery. Browser/mobile/native behavior is verified by PR CI; audio remains a separate agreed follow-up direction.
