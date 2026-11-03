# Gearbox Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each car a five-to-eight-speed audio-only transmission with progressively longer gears and audible pitch drops on shifts.

**Architecture:** A pure domain module owns gearbox profiles, boundaries, hysteresis, and tone calculation. Race feedback adds the player's car id, while the Web Audio sink retains the previous audio gear and renders the calculated frequency/load without changing physics.

**Tech Stack:** strict TypeScript 7, Web Audio API, Vitest

## Global Constraints

- Yellow has 5 gears, Blue 6, Green 7, and Red 8.
- Every successive gear covers a wider normalized speed range.
- Gear selection uses asymmetric hysteresis.
- The feature is audio-only and cannot change physics, AI, or controls.
- Existing continuous oscillators are reused; shifts must not spawn new engine oscillators.

---

### Task 1: Pure gearbox tone model

**Files:**
- Create: `src/domain/audio/gearbox.ts`
- Create: `tests/domain/gearbox.test.ts`

**Interfaces:**
- Consumes: `CarId` and normalized `speedRatio`/`throttle`.
- Produces:

```ts
export interface GearboxTone {
  readonly gear: number
  readonly gearCount: number
  readonly revRatio: number
  readonly frequency: number
  readonly load: number
  readonly shift: 'none' | 'up' | 'down'
}

export function gearboxBoundaries(car: CarId): readonly number[]
export function calculateGearboxTone(
  car: CarId,
  speedRatio: number,
  throttle: number,
  previousGear?: number,
): GearboxTone
```

- [ ] **Step 1: Write the failing tests**

```ts
expect(gearboxBoundaries('yellow')).toHaveLength(6)
expect(gearboxBoundaries('blue')).toHaveLength(7)
expect(gearboxBoundaries('green')).toHaveLength(8)
expect(gearboxBoundaries('red')).toHaveLength(9)

for (const car of CAR_IDS) {
  const boundaries = gearboxBoundaries(car)
  const widths = boundaries.slice(1).map(
    (boundary, index) => boundary - (boundaries[index] ?? 0),
  )
  expect(widths.every((width, index) =>
    index === 0 || width > (widths[index - 1] ?? 0))).toBe(true)
}

const firstShift = gearboxBoundaries('blue')[1] ?? 0
const before = calculateGearboxTone('blue', firstShift - 0.001, 1)
const after = calculateGearboxTone(
  'blue',
  firstShift + 0.013,
  1,
  before.gear,
)
expect(after.gear).toBe(before.gear + 1)
expect(after.frequency).toBeLessThan(before.frequency)

const held = calculateGearboxTone('blue', firstShift + 0.006, 1, 0)
expect(held.gear).toBe(0)
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- tests/domain/gearbox.test.ts`  
Expected: FAIL because `gearbox.ts` does not exist.

- [ ] **Step 3: Implement progressive boundaries and tone**

Use per-car profiles:

```ts
const GEARBOX_PROFILES = {
  yellow: { gears: 5, growth: 1.2, idle: 54, sweep: 104 },
  blue: { gears: 6, growth: 1.17, idle: 58, sweep: 116 },
  green: { gears: 7, growth: 1.14, idle: 62, sweep: 124 },
  red: { gears: 8, growth: 1.12, idle: 68, sweep: 138 },
} as const satisfies Record<CarId, GearboxProfile>
```

Generate positive weights `growth ** index`, normalize their cumulative sum to
`0..1`, and include exact boundaries `0` and `1`. Select the natural gear from
speed, then retain `previousGear` while speed remains no more than `0.012`
above its upper boundary or `0.018` below its lower boundary. Clamp all
external inputs.

Calculate:

```ts
const revRatio = (speed - lower) / (upper - lower)
const frequency = idle + sweep * (0.28 + revRatio * 0.72)
const load = 0.22 + clampedThrottle * 0.78
```

Return a shift direction by comparing selected and previous gear.

- [ ] **Step 4: Run focused test and typecheck**

Run: `npm run test -- tests/domain/gearbox.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit the pure model**

```powershell
git add src/domain/audio/gearbox.ts tests/domain/gearbox.test.ts
git commit -m "feat: model per-car audio gearboxes"
```

### Task 2: Feedback and Web Audio integration

**Files:**
- Modify: `src/application/ports/feedback.ts`
- Modify: `src/application/race/raceSession.ts`
- Modify: `src/infrastructure/feedback/webAudioAdapter.ts`
- Modify: `tests/application/raceSession.test.ts`
- Modify: `tests/infrastructure/feedback.test.ts`

**Interfaces:**
- Consumes: `calculateGearboxTone(car, speedRatio, throttle, previousGear)`.
- Changes:

```ts
type EngineFeedbackEvent = {
  readonly type: 'engine'
  readonly car: CarId
  readonly speedRatio: number
  readonly throttle: number
}

interface ToneSink {
  setEngine(car: CarId, speedRatio: number, throttle: number): void
}
```

- [ ] **Step 1: Write failing integration tests**

Update the adapter expectation:

```ts
audio.handle({
  type: 'engine',
  car: 'green',
  speedRatio: 0.7,
  throttle: 1,
})
expect(sink.setEngine).toHaveBeenCalledWith('green', 0.7, 1)
```

In the race-session test, step a session using a red player car and assert:

```ts
expect(feedback.handle).toHaveBeenCalledWith(
  expect.objectContaining({ type: 'engine', car: 'red' }),
)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:
`npm run test -- tests/infrastructure/feedback.test.ts tests/application/raceSession.test.ts`  
Expected: FAIL because engine feedback has no car id.

- [ ] **Step 3: Carry car identity through feedback**

Add `car: player.car` in `RaceSession.routeFeedback`. Extend the typed engine
event and `ToneSink.setEngine` signature with `CarId`.

- [ ] **Step 4: Render the gearbox tone**

In `BrowserToneSink`, retain:

```ts
private engineGear: number | undefined
```

Then:

```ts
const tone = calculateGearboxTone(
  car,
  speedRatio,
  throttle,
  this.engineGear,
)
this.engineGear = tone.gear
this.engine.frequency.setTargetAtTime(
  tone.frequency,
  context.currentTime,
  tone.shift === 'none' ? 0.035 : 0.018,
)
this.engineGain.gain.setTargetAtTime(
  0.01 + tone.load * 0.038,
  context.currentTime,
  0.05,
)
```

Reset `engineGear` in `destroy()`.

- [ ] **Step 5: Run focused and complete verification**

Run:
`npm run test -- tests/domain/gearbox.test.ts tests/infrastructure/feedback.test.ts tests/application/raceSession.test.ts`  
Expected: PASS.

Run: `npm run verify`  
Expected: all tests, strict typecheck, Biome, and Vite build pass.

Run: `git diff --check`  
Expected: no whitespace errors.

- [ ] **Step 6: Browser audio acceptance**

Run `npm run dev`, race once with each car, and verify:

1. pitch rises and drops through exactly 5/6/7/8 gears;
2. later gears last longer;
3. steady speed near a boundary does not chatter;
4. braking reduces load without selecting a physically different gear;
5. toggling audio off silences the oscillator;
6. driving feel and lap pace are unchanged.

- [ ] **Step 7: Commit the integration**

```powershell
git add src/application/ports/feedback.ts src/application/race/raceSession.ts src/infrastructure/feedback/webAudioAdapter.ts tests/application/raceSession.test.ts tests/infrastructure/feedback.test.ts
git commit -m "feat: render stepped gearbox engine audio"
```
