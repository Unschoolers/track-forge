# TrackForge Legacy-to-Phaser Parity Audit

**Audit date:** 2026-07-24  
**Reference runtime:** `trackforge.html`  
**Migrated runtime:** `index.html` plus `src/`

## Executive summary

The migration has a good technical foundation: Phaser 4 and Vite are running,
TypeScript 7 is strict, responsibilities are split into domain, application,
infrastructure, Phaser, and DOM UI modules, and the current automated checks
pass. It is not yet a feature-complete migration.

Only the application shell, basic mode transitions, core data types, starter
track, and a small subset of editor/race behavior are complete. Every
user-facing gameplay area still has material parity gaps. Several features have
typed helpers or adapters, but those pieces are not connected to the runtime.

The most urgent issue is backward compatibility: the legacy game stores tracks
in `trackforge-library-v1` and scores in `trackforge-highscores-v1`, while the
migrated repositories read only the new `-v2` keys. Starting the migrated game
therefore hides an existing user's tracks and records and creates a new starter
track instead.

## Status legend

- **Complete:** the migrated runtime exposes equivalent behavior.
- **Partial:** some domain or UI pieces exist, but the complete user flow does
  not.
- **Missing:** no usable migrated behavior exists.
- **Broken:** the runtime exposes a control or flow that cannot produce the
  intended result.

## Parity matrix

| Area | Legacy behavior | Migrated state | Status | Priority |
| --- | --- | --- | --- | --- |
| Toolchain and structure | Single HTML/CSS/Canvas/JS runtime | Phaser 4, strict TypeScript 7, Vite, modular CSS/UI, DI-oriented ports | Complete | — |
| Home | Current track, best time, Race, Editor, Options | Current track and point count, Race and Editor only | Partial | P1 |
| Track library | List, readiness, best time, select, create, rename, delete | Repository supports list/find/save/remove; no library UI or commands | Partial | P0 |
| Legacy track migration | Reads `trackforge-library-v1`, then older autosave/manual keys | Reads `trackforge-library-v2`; recovery checks only autosave/manual keys | Broken | P0 |
| Legacy score migration | Reads top-five records from `trackforge-highscores-v1` | Reads only `trackforge-highscores-v2`; legacy `date` shape is not decoded | Broken | P0 |
| Editor tools | Draw, select/move, paint, pan, tree, erase | Buttons render, but their handlers do nothing; scene always draws street | Broken | P0 |
| Editor surfaces | Street, dirt, ice, alternating mixed surface | Street/dirt/ice buttons render but do nothing; mixed is absent | Broken | P0 |
| Editor history | One undo entry per gesture, redo, bounded history | Reducer has undo/redo, but drag drawing creates an entry for every sampled point | Partial | P1 |
| Editor geometry | Straight-line smoothing, adaptive curves, closed-loop normalization, segment hit testing | Catmull-Rom path exists; adaptive straightening, loop normalization, and hit-testing commands are absent | Partial | P1 |
| Editor camera/tools | Pan, wheel zoom, buttons, fit, 2× expand, grid | Wheel zoom only; pan helper is not used; buttons, fit, expand, and grid are absent | Broken | P1 |
| Editor track actions | Save, clear, load, rename, choose, options, play | Undo, redo, home, and direct race are exposed; remaining flows are absent | Missing | P0 |
| Race setup | Choose race-ready track, four cars, three difficulties, day/night, car stats | Preferences exist in storage, but no setup UI is exposed | Missing | P0 |
| Countdown/start | Three-second countdown and synchronized start | Race begins immediately | Missing | P1 |
| Keyboard controls | A/D or arrows steer, S/down/space brake, R reset | Steering and braking work; reset is absent | Partial | P1 |
| Touch controls | Dedicated steering pad, brake button, two-touch braking | DOM controls render but have no listeners; any canvas touch steers | Broken | P0 |
| Player physics | Per-car and per-surface tuning, grass/off-road, lateral grip/slip, braking, damage effects | Forward-only scalar model with basic surface multipliers | Partial | P1 |
| Track progress | Wrapped nearest-path search, forward gates, laps, finish | Player uses a stale pre-movement nearest index; no checkpoint/gate validation | Broken | P0 |
| AI progress | AI cars complete laps and receive finish times | AI advances `pathIndex` to a look-ahead target and never calls progress logic | Broken | P0 |
| AI racing | Follow distance, collision avoidance, committed overtakes, lane hold/completion, mistakes, difficulty tuning | Lane scoring helpers exist but are never used by `stepAiVehicle`; only emergency braking is connected | Broken | P1 |
| Collisions/damage | Contact tracking, impact damage, sparks, smoke, wreck, reset | Basic separation and damage exist; no contact lifecycle, effects, or recovery | Partial | P1 |
| HUD | Live position, lap, elapsed time, damage, countdown | Hard-coded `1/4`, `1/3`, and `00:00.000`; no damage HUD | Broken | P0 |
| Pause/restart | Resume, restart, options, quit; auto-pause when hidden | Resume and quit only; no restart/options/visibility pause | Partial | P1 |
| Results/scores | Finish ordering, DNF/wreck, race scoreboard, top five, retry/edit | No terminal race flow or results screen; injected `ScoreStore` is unused | Missing | P0 |
| Track rendering | Surface edges/fills/stripes, generated curbs, start line, grid, trees | Surface fills and simple trees/points only | Partial | P1 |
| Vehicle rendering | Four distinct bodies, wheels, windows, lights, brake lights, damage | One generic rounded rectangle tinted per car | Partial | P2 |
| Effects | Dust, grass, skids, tire smoke, sparks, speed streaks, camera shake | None | Missing | P2 |
| Night mode | Darkness mask, moon falloff, per-car headlight cutouts, lamp/tail-light glow | Flat overlay plus one player triangle; race uses preference lighting rather than selected track lighting | Partial | P2 |
| Audio | Gesture-gated engine/noise loop, surface, curb, tire, impact, UI, finish | Tone adapter exists, lacks continuous engine/surface behavior, and is never constructed | Broken | P1 |
| Haptics | UI, curb, surface, impact, finish patterns | Adapter exists and is tested, but is never constructed | Broken | P1 |
| Responsive UI | Mobile-first shell, safe-area controls, desktop constrained viewport, all modal flows | Basic responsive shell exists; most screens/modals and usable touch bindings are absent | Partial | P1 |
| Accessibility/lifecycle | Labels, keyboard, visibility pause, modal focus | Basic labels exist; modal focus/return and visibility pause are absent | Partial | P1 |

## Evidence

### 1. Existing user data is not migrated

The reference runtime declares:

- `trackforge-library-v1` at `trackforge.html:712`
- `trackforge-highscores-v1` at `trackforge.html:713`

The migrated repositories declare:

- `trackforge-library-v2` in `src/infrastructure/storage/trackRepository.ts`
- `trackforge-highscores-v2` in `src/infrastructure/storage/scoreRepository.ts`

`BrowserTrackRepository.recoverLegacy()` checks only
`trackforge-autosave-v2` and `trackforge-manual-v2`. The original v1 library is
never inspected. The original score shape also uses `date`, while the v2
decoder requires `recordedAt`.

### 2. Editor controls are rendered but not connected

`src/ui/screens/editorChrome.ts` assigns `() => undefined` to every tool and
surface button. `src/phaser/scenes/EditorScene.ts` independently handles every
pointer gesture as `add-point` with a hard-coded `street` surface.

`src/phaser/input/editorInput.ts` contains the beginning of a reusable input
controller, but `EditorScene` never constructs it. Its select, paint, and erase
branches are also empty.

### 3. The race cannot reach a complete result

`src/ui/screens/raceHud.ts` renders hard-coded position, lap, and time values.
`RaceScene` keeps `RaceState` private, so the DOM HUD cannot receive live race
telemetry.

The player calls `nearestPathPoint()` before movement and passes that old index
to `updateProgress()`. AI cars do not call `updateProgress()` at all.
`stepAiVehicle()` instead sets `pathIndex` to its look-ahead target on every
frame. There is no code that observes `finishedAt`, records the score, ranks the
cars, or displays results. `AppController` receives a `ScoreStore` dependency
but never uses it.

### 4. Overtaking helpers are dead code

`scorePassingLane()` and `choosePassingLane()` exist in
`src/domain/race/ai/lanePlanner.ts`, but `src/domain/race/ai/aiDriver.ts` does
not import or call either function. The race state has no passing phase,
target-lane hold timer, cooldown, or completion state equivalent to the legacy
implementation.

### 5. Feedback adapters are dead code

`WebAudioAdapter` and `HapticsAdapter` have focused tests, but `src/main.ts`
does not construct either adapter and no application or race event is routed to
them. Passing their unit tests therefore does not mean audio or haptics work in
the game.

### 6. Presentation is a deliberate simplification, not parity

The legacy renderer contains generated curbs, surface stripes, start line,
skids, particles, speed streaks, four separate car body functions, damage
overlays, headlight cutouts, and lamp glows. The migrated renderers currently
draw:

- road edge and surface strokes;
- simple tree circles and editor point circles;
- one rounded-rectangle car silhouette;
- one flat darkness rectangle and headlight triangle.

## Root cause

The original migration plan described full parity, but most tasks were closed
after establishing a representative typed slice instead of satisfying their
complete acceptance criteria. This produced three recurring failure modes:

1. **Surface without behavior:** controls and screens render but emit no command.
2. **Domain without integration:** helpers and adapters pass unit tests but are
   not used by the actual scenes or composition root.
3. **Private runtime state:** `RaceScene` owns live race state, preventing the
   application, HUD, score repository, results UI, and feedback adapters from
   observing race events.

## Recovery order

1. Protect existing user data and establish executable parity tests.
2. Restore a complete edit/save/load/setup/race/results loop.
3. Make race simulation authoritative and observable.
4. Restore physics, progress, AI, feedback, and lifecycle behavior.
5. Restore visual/effect fidelity.
6. Remove the legacy file from active acceptance only after every parity row has
   an automated or documented manual check.

