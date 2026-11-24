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

**Intended dependency direction:** domain rules are independent of browser/Phaser/DOM/Android; application orchestrates domain behavior through narrow ports; infrastructure and UI/Phaser implement/adapt ports; `main.ts` wires them together. The former `domain/race/raceEngine.ts` → `application/ports/random.ts` inversion was resolved in PR #123: the contract now lives in `domain/race/randomSource.ts` and the production adapter in `infrastructure/random/mathRandom.ts`. The architecture regression test guards against new outward imports.

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

**Editor:** pointer input (`phaser/input/editorInput.ts`) → controller/editor session; editor toolbox chrome is reduced in `application/editor/editorUiReducer.ts` → `domain/editor/editorState.ts` command/history → geometry through `TrackGeometryService` → invalidation-aware render. Command rejection must remain visible; undo/redo must restore geometry and terrain correctly. Camera view should not jump after unrelated editor changes.

**Race:** controller obtains mode/lap/lighting/grid policy from `application/race/raceSetup.ts` → `application/race/raceSession.ts` (clock, 60 Hz tick scheduling, ghost lifecycle and snapshot publishing) → `domain/race/raceEngine.ts` (tick orchestration, collision ordering and typed events). The engine delegates vehicle integration to `raceVehicleStepper.ts`, gate crossing/grace to `arcadeTimingGate.ts`, and recovery destinations to `raceRecovery.ts`. Application-level `raceResultRecorder.ts` handles category-aware score writes and standings; `raceFeedback.ts` maps race events to sound/haptic decisions. Phaser renders the snapshot and the UI presents outcomes. All modules share the same geometry authority and preserve the fixed 1/60 s physics step regardless of draw or QA speed. Nearby countdowns use an injectable monotonic clock, separate from wall time.

**Track import/save:** untrusted JSON → `domain/track/trackCodec.ts` normalization → validation → `infrastructure/storage/*Repository.ts` → application. The codec handles legacy track representations; do not bypass it with direct casts of incoming JSON. Exports must remain importable.

**Nearby race:** `application/multiplayer/nearbyRace.ts` owns lobby, staging, countdown and peer lifecycle; `nearbyPoseSync.ts` owns adaptive 30–60 Hz pose transmission, host relay, interpolation, and teardown of late sends; `controlProtocol.ts` validates bounded reliable JSON messages and spawn assignments; `raceWire.ts` encodes binary pose packets (currently 19 bytes per pose) and `trackTransfer.ts` bounds/chunks gzip track payloads; `infrastructure/multiplayer/androidNearby.ts` adapts Google Nearby native events. `infrastructure/multiplayer/lanNearby.ts` and `selectNearbyConnection.ts` adapt the Tauri/Android LAN TCP+UDP transport; `NearbyRace` and wire packets remain transport-independent. See [LAN multiplayer](lan-multiplayer.md). Cosmetics are validated separately in `playerIdentity.ts`, not sent on each pose. Any wire change needs compatibility, malformed-packet, out-of-order, disconnect and size-limit tests.

**Startup/Android:** `boot.ts` loads `main.ts` lazily; native Android integrates Capacitor and plugins. Android signing/version identity is a deployment contract; see the repository README and workflow before touching it.

## Shared invariants to protect

- **One ruleset:** all races use the same Arcade physics, AI, collisions (none) and recovery. Auto-accelerate and manual pedals are local input preferences, not race categories. Previous race record, ghost and last-race namespaces are retired; track storage is unchanged.
- **One geometric truth:** road/terrain height, structures, crossings, checkpoint locations and nearest-path context must agree between editor, AI, physics and rendering. Prefer the existing `TrackGeometryService`, `roadSurface` and terrain authorities.
- **No track-specific gameplay exceptions:** AI, physics, progress and difficulty must derive decisions from shared geometry, road/terrain surfaces, vehicle properties and race settings. Never recognize a particular circuit by name, ID, export hash or hand-authored segment index to apply different steering, speed, grip, checkpoints or racing-line rules. Named tracks are allowed as **test fixtures**, never production behavior switches. If a layout exposes a weakness, fix the generic rule and protect it with seeded regressions.
- **Determinism:** fixed input/tick/randomness should yield reproducible simulation and comparable AI results. Inject clock and random source at appropriate boundaries.
- **Untrusted boundaries:** storage, track import, network packets and native events are untrusted. Normalize/validate early; bound size and coordinate work before expensive geometry.
- **Lifecycle:** leaving or restarting a race tears down active controls, subscriptions and continuous sound. No stale scene subscriptions, orphaned pointer contacts or background races.
- **Editor responsiveness:** redraw/invalidate only changed layers; avoid rebuilding geometry and terrain during pointer movement if inputs are unchanged.
- **Night presentation:** preview and race reuse the same cached headlight beam asset, with night-tinted materials and no additional fullscreen shade. See [night presentation](night-presentation.md).
- **Backward compatibility:** saved tracks, scores, preferences and Android update identity must survive normal upgrades. Record a migration plan before changing schemas.
- **Mobile usability:** two-finger interactions, pedal/steering combinations, viewport/safe areas and clear states are first-class constraints.

## When adding a feature

Identify the **owner of the rule**, the **authoritative data structure**, the **ports**, and the **consumer(s)**. Prefer introducing one clear operation at the right level over adding conditionals to `AppController`, `RaceScene`, and the UI simultaneously. If multiple consumers need the same derived geometry, compute it once at the geometry boundary and reuse it.
