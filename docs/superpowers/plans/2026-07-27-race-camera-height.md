# Race Camera Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the race camera closer while preserving smooth speed-, curve-, and heading-aware behavior.

**Architecture:** Keep the pure `raceCamera.ts` state transition and expose its distance values through one readonly tuning record. Update behavior tests first, then replace embedded zoom constants without changing `RaceScene`.

**Tech Stack:** TypeScript 7 strict mode, Vitest, Phaser 4, Vite 7, Biome

## Global Constraints

- Keep speed/curve interpolation and asymmetric smoothing.
- Keep position following and road-aligned rotation unchanged.
- Use initial `1.2`, normal `1.2`, fastest straight `1.16`, corner `1.28`, fixed `1.18`, and clamp `1.14–1.3`.
- Do not add viewport-specific branches or a runtime camera UI.

---

### Task 1: Lock the closer camera behavior

**Files:**
- Modify: `tests/phaser/raceCamera.test.ts`
- Modify: `src/phaser/camera/raceCamera.ts`

**Interfaces:**
- Produces: exported readonly `RACE_CAMERA_TUNING`
- Preserves: `createRaceCamera` and `advanceRaceCamera`

- [ ] **Step 1: Write the failing expectations**

Change fixed zoom to expect `1.18`, sustained maximum-speed straight zoom to
expect at least `1.15`, and add:

```ts
expect(createRaceCamera({ x: 0, y: 0, angle: 0 }).zoom).toBe(1.2)
```

Add a settled straight/corner comparison:

```ts
expect(corner.zoom).toBeGreaterThan(straight.zoom)
expect(corner.zoom).toBeGreaterThanOrEqual(1.24)
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- tests/phaser/raceCamera.test.ts`

Expected: FAIL because the current initial, fixed, straight, and corner zooms
are lower.

- [ ] **Step 3: Add and consume the tuning record**

```ts
export const RACE_CAMERA_TUNING = {
  initialZoom: 1.2,
  normalStraightZoom: 1.2,
  fastestStraightZoom: 1.16,
  cornerZoom: 1.28,
  fixedZoom: 1.18,
  minimumZoom: 1.14,
  maximumZoom: 1.3,
  zoomInResponse: 1.65,
  zoomOutResponse: 0.78,
} as const
```

Use these values in `createRaceCamera`, target interpolation, smoothing, and
clamping. Preserve the current speed and curve thresholds.

- [ ] **Step 4: Run focused and full verification**

Run: `npm run test -- tests/phaser/raceCamera.test.ts`

Expected: PASS.

Run: `npm run verify`

Expected: all tests, strict TypeScript, Biome, and Vite build pass.

- [ ] **Step 5: Check patch hygiene**

Run: `git diff --check`

Expected: exit code 0; Windows line-ending notices are acceptable.
