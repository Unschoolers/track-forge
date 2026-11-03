# TrackForge Phaser 4 Migration Design

## Goal

Replace the standalone `trackforge.html` runtime with a complete Phaser 4,
TypeScript 7, Vite application while preserving the editor, race, AI, storage,
audio, responsive controls, and visual identity.

## Design principles

- Use strict TypeScript 7 with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, and no unchecked casts.
- Keep the domain independent of Phaser, the DOM, Web Audio, and localStorage.
- Apply dependency inversion through small ports, constructor injection, and one
  explicit composition root.
- Give each module one responsibility. Prefer pure functions for geometry,
  simulation, validation, scoring, and state transitions.
- Keep Phaser scenes thin: translate input, call use cases, and render snapshots.
- Keep DOM controllers thin: render view models and emit typed commands.
- Preserve the original tuning and browser-storage data where practical.
- Support touch, mouse, keyboard, phones, tablets, and desktop from one logic path.

## Boundaries

```text
domain <- application <- adapters
                       <- Phaser scenes/renderers
                       <- DOM UI
                       <- composition root
```

The domain contains tracks, geometry, editor operations, vehicles, race
simulation, AI, scores, and validation. Application services coordinate use
cases through `TrackStore`, `ScoreStore`, `PreferencesStore`, `Clock`,
`RandomSource`, `AudioPort`, and `HapticsPort`. Infrastructure adapters implement
those ports. `createApplication()` is the only place that constructs concrete
dependencies.

## User-visible parity

The migrated app includes home, track library, create/rename/delete, the complete
editor toolset and undo/redo, four vehicles, three surfaces, three difficulties,
day/night, AI overtaking, collisions and damage, lap/rank tracking, pause/restart,
results and high scores, keyboard/touch controls, audio, haptics, dynamic zoom,
particles, lighting, and responsive modular HTML/CSS UI.

## Reliability

External data is normalized at adapter boundaries. Malformed storage records are
ignored safely. Incomplete tracks remain editable but cannot start a race.
Repeated transitions are idempotent, and scenes/controllers dispose all
listeners and timers. Audio and haptics degrade without affecting gameplay.

## Verification

Vitest covers pure domain behavior and adapter contracts. jsdom tests DOM
controllers. Phaser integration is exercised through thin scene tests and a
production smoke test. The merge gate is test, strict typecheck, lint, and Vite
production build.

