# Architecture and invariants

This is an overview of **observed main-branch code as of 2026-11-21**, not a promise that every dependency is already perfect.

## Runtime composition

```text
index / src/boot.ts
       ↓ dynamic import
src/main.ts (composition root: dependencies, lifecycle, capabilities)
       ├── src/app/createApplication.ts (host lifetime)
       ├── src/application/ (commands, state, editor/race sessions, nearby)
       ├── src/infrastructure/ (storage, Android, sound, export, QA)
       ├── src/phaser/ (scene host, input, camera, drawing)
       └── src/ui/ (DOM controls, modal/screen composition)
                  ↓
               src/domain/ (track, terrain, race, AI, physics, validation)
```

**Intended dependency direction:** domain rules should be independent of browser/Phaser/DOM/Android; application orchestrates domain behavior through narrow ports; infrastructure and UI/Phaser implement/adapt ports; `main.ts` wires them together. An observed exception: `src/domain/race/raceEngine.ts` imports `RandomSource` from `src/application/ports/random.ts`. If adjusting this boundary, relocate the abstraction deliberately without changing gameplay behavior.

## Source ownership

| Area | Owns | Should not own |
| --- | --- | --- |
| `domain/track`, `domain/terrain` | Authoritative geometry, road/terrain surfaces, validation, codec | DOM, Phaser objects, persistence |
| `domain/editor` | Track editing commands, constraints, undo/redo state | Mouse event interpretation, rendering |
| `domain/race` | Fixed-step simulation, gate progress, recovery, AI, physics | Browser scheduling, modal state, audio playback |
| `application/` | Transitions, race/editor sessions, game orchestration, multiplayer protocol | Raw Phaser drawing and Android plugin internals |
| `infrastructure/` | Browser storage, audio, export, native nearby bridge, diagnostics | Gameplay rule decisions |
| `phaser/` | Scene lifecycle, input translation, camera, visual layers and caches | Durable track data authority or scoring rules |
| `ui/`, `styles/` | Accessible DOM controls, interaction affordances, design tokens | Authoritative physics or geometry |
| `qa/`, `tests/` | Contract tests, lane simulation, browser/device verification | Hidden production behavior or test-only shortcuts in releases |

## Important flows

**Editor:** pointer input (`phaser/input/editorInput.ts`) → controller/editor session → `domain/editor/editorState.ts` command/history → geometry through `TrackGeometryService` → invalidation-aware render. Command rejection must remain visible; undo/redo must restore geometry and terrain correctly. Camera view should not jump after unrelated editor changes.

**Race:** controller prepares setup → `application/race/raceSession.ts` → `domain/race/raceEngine.ts` fixed-step simulation (`RACE_TICK_SECONDS = 1/60`) → typed events/telemetry → Phaser renders state and UI shows race outcomes. AI, player and recovery must share consistent geometry and surface authority. Avoid changing simulation step size just to accelerate tests; drive more ticks without changing the simulated contract.

**Track import/save:** untrusted JSON → `domain/track/trackCodec.ts` normalization → validation → `infrastructure/storage/*Repository.ts` → application. The codec handles legacy track representations; do not bypass it with direct casts of incoming JSON. Exports must remain importable.

**Nearby race:** `application/multiplayer/nearbyRace.ts` owns lobby and race state; `controlProtocol.ts` validates bounded reliable JSON messages and spawn assignments; `raceWire.ts` encodes binary pose packets (currently 19 bytes per pose) and `trackTransfer.ts` bounds/chunks gzip track payloads; `infrastructure/multiplayer/androidNearby.ts` adapts Capacitor/native events. Cosmetics are validated separately in `playerIdentity.ts`, not sent on each pose. Any wire change needs compatibility, malformed-packet, out-of-order, disconnect and size-limit tests.

**Startup/Android:** `boot.ts` loads `main.ts` lazily; native Android integrates Capacitor and plugins. Android signing/version identity is a deployment contract; see the repository README and workflow before touching it.

## Shared invariants to protect

- **One geometric truth:** road/terrain height, structures, crossings, checkpoint locations and nearest-path context must agree between editor, AI, physics and rendering. Prefer the existing `TrackGeometryService`, `roadSurface` and terrain authorities.
- **Determinism:** fixed input/tick/randomness should yield reproducible simulation and comparable AI results. Inject clock and random source at appropriate boundaries.
- **Untrusted boundaries:** storage, track import, network packets and native events are untrusted. Normalize/validate early; bound size and coordinate work before expensive geometry.
- **Lifecycle:** leaving or restarting a race tears down active controls, subscriptions and continuous sound. No stale scene subscriptions, orphaned pointer contacts or background races.
- **Editor responsiveness:** redraw/invalidate only changed layers; avoid rebuilding geometry and terrain during pointer movement if inputs are unchanged.
- **Backward compatibility:** saved tracks, scores, preferences and Android update identity must survive normal upgrades. Record a migration plan before changing schemas.
- **Mobile usability:** two-finger interactions, pedal/steering combinations, viewport/safe areas and clear states are first-class constraints.

## When adding a feature

Identify the **owner of the rule**, the **authoritative data structure**, the **ports**, and the **consumer(s)**. Prefer introducing one clear operation at the right level over adding conditionals to `AppController`, `RaceScene`, and the UI simultaneously. If multiple consumers need the same derived geometry, compute it once at the geometry boundary and reuse it.
