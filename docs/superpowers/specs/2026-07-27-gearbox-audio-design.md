# Gearbox Audio Design

**Date:** 2026-07-27  
**Status:** Approved

## Goal

Replace the continuously rising engine drone with distinct audio-only gears
whose pitch rises, drops on an upshift, and rises again without changing
vehicle physics.

## Transmission Character

Each car has a gearbox matching its existing role:

- Yellow: 5 long, low-rev gears.
- Blue: 6 balanced gears.
- Green: 7 close, responsive gears.
- Red: 8 high-performance gears.

Gear spans grow progressively wider with vehicle speed. The first gear is
shortest and the highest gear is longest. This produces the audible rhythm of
a car accelerating through increasingly long gears while retaining full use of
the normalized `0..1` speed range.

## Tone Model

A pure domain helper accepts the car id, normalized speed, throttle, and
previous gear. It returns:

- current zero-based gear;
- normalized rev position within the gear;
- engine frequency;
- normalized load/volume;
- whether an upshift or downshift occurred.

Pitch starts low in each gear, climbs toward the shift point, then drops at the
next gear. Each car receives a modest base-pitch and rev-range variation so the
four transmissions are recognizable without becoming shrill.

Small asymmetric hysteresis keeps the selected gear stable when speed hovers
near a boundary. Upshifts happen slightly above the boundary and downshifts
slightly below it. Large speed changes may cross several gears immediately.

Throttle changes load and volume, not gear selection. Braking is represented by
the existing zero-throttle input and a lower loaded tone.

### Top-Gear Tone

The highest gear keeps its existing speed range. Only its audible rev curve is
compressed: each car receives a top-gear rev ceiling between 80% and 85% of
the normal redline sweep.

This models a road car whose maximum speed is limited by load and aerodynamic
drag rather than sitting indefinitely at the engine's redline. The tone still
rises continuously across the final gear, but it finishes below the pitch
reached immediately before earlier upshifts. Gear selection, acceleration, and
top speed remain unchanged.

The ceiling belongs to the per-car gearbox profile so each transmission keeps
its existing character without adding conditionals to the Web Audio adapter.

## Integration

The engine feedback event includes the player's `CarId`. The race session
continues to calculate normalized speed from that car's existing maximum speed.
The Web Audio adapter retains only the previous audio gear and feeds each event
through the pure gearbox helper.

The oscillator remains continuous. Frequency automation creates the rev rise
and shift drop without spawning an oscillator per update. A short smoothing
constant keeps changes audible but avoids clicks.

## Non-Goals

- No acceleration, engine-braking, traction, top-speed, or AI changes.
- No changes to gear counts or speed boundaries.
- No manual transmission or player shift controls.
- No sampled engine assets.
- No separate gearbox selection in the UI.

## Verification

- Domain tests cover gear counts, progressively wider bands, pitch drop at
  upshifts, hysteresis, clamping, per-car character, and the reduced top-gear
  pitch ceiling.
- Adapter tests verify that the player's car id reaches the tone sink.
- Race-session tests verify that engine feedback contains the active player car.
- `npm run verify` and `git diff --check` remain the final gates.
