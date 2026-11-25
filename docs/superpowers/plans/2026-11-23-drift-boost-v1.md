# Drift Boost v1 — delivery plan

**Status:** gameplay contract approved; implementation pending. **Scope:** experimental, opt-in Arcade drift boost. Simulation and existing boost-off races remain unchanged.

Follow [architecture](../../architecture.md), [delivery workflow](../../change-workflow.md), [testing guidelines](../../testing-guidelines.md), [AI tuning](../../ai-tuning.md), [AI benchmark workflow](../../ai-difficulty-tuning.md), [race replays](../../race-replays.md) and [LAN multiplayer](../../lan-multiplayer.md). Each gameplay phase delivers a usable change through a focused PR to `main`. The release checks determine whether the feature should graduate from opt-in.

## Gameplay contract

- Charge from qualifying on-road drift duration × speed. Equivalent drift on street, dirt and ice charges equally; braking drifts count. Exclude reverse, stationary spins, collisions, recovery, off-road, airborne and uncontrolled slides. Unspent charge persists across corners and recovery, without decay.
- At 100%, one deliberate press consumes all charge. Double current forward speed once, bounded by 2× the car's normal maximum; allow acceleration up to that ceiling for 1 second. Braking immediately cancels boost without refund. Recovery cancels propulsion, retains unspent charge, and cannot charge. Return safely to the normal speed envelope, without negating braking. Preserve steering, lateral motion and car identity.
- A compact meter and stable-position button above the brake communicate charging, readiness and activation. Support steering and boost together on mobile. Flames use the player's pin/topper color.
- AI earns and uses boost under the same rules. Existing records and ghosts must remain intact and never be compared with boost-enabled runs. Multiplayer peers must agree on race rules. No track-specific gameplay or AI rules.
- Race rules and their tuning revision are frozen at start. The feature is explicitly opt-in and default off during evaluation; no feature activation in Simulation. Pause freezes timers; countdown, finished and wrecked cars cannot charge or activate. Reset, pause and exit release input. A held press cannot trigger again; brake wins over simultaneous activation.

## Initial tuning and ownership

Keep boost parameters in a focused race-domain configuration, separate from vehicle handling. Initial values are hypotheses: reference speed 200 world units/s, 5 seconds to full at that speed, minimum speed 90, slip angle 12–45°, minimum continuous drift 0.2 seconds, equal surface and car multipliers, no decay, duration 1 second, initial speed and ceiling multipliers 2, acceleration multiplier 2 and post-boost return 0.4 seconds. Charge only after the minimum continuous qualifying duration:

`charge = clamp(charge + dt / 5 * speed / 200, 0, 1)`

Use actual velocity relative to heading; reject non-finite data. Do not charge during active boost or return to normal. Share drift measurements with `src/ui/screens/driftCue.ts` where useful, but preserve its existing behavior: its braking and surface rules differ and it is not the scoring authority. Do not modify grip, braking or normal vehicle stats just to generate charge. Initial values must be validated, not treated as measured balance.

Domain owns charge, state and physics; application owns frozen race rules, race lifecycle and result policy; UI/input and Phaser present state and send one-shot commands. Reuse existing boundaries. The existing physics safety limiter and AI catch-up must not bypass or stack beyond the boosted ceiling; raising the engine speed limit alone is insufficient.

## Delivery and parallel work

| Phase / PR | Player value | Depends on | Parallel work |
| --- | --- | --- | --- |
| 1. Playable solo beta | Humans can try drift boost in a safe local Arcade race | None | Domain/physics, controls/HUD, and record/entry safety can be developed together against the contracts below; integrate in this PR. |
| 2. Feedback | Boost feels and looks satisfying | Phase 1 | Effects and audio/haptics can be developed in parallel against Phase 1 state/events; merge as one coherent presentation PR. |
| 3. Fair AI | Rivals earn and use boost and remain competitive | Phase 1 | Policy and benchmark tooling can proceed in parallel; tuning follows integration. Can ship before or after Phase 2. |
| 4. Records and ghosts | Players can keep and race boost-enabled results safely | Phase 1 | Persistence/category work and replay/ghost presentation can proceed in parallel against the rule identity below. Can ship independently of Phases 2 and 3. |
| 5. Nearby multiplayer | Friends can race with boost and see each other's exhaust effects | Phases 1–2 | Protocol and remote rendering can start against the shared contract. Integrate remote rendering with Phase 2 effects. |
| 6. Release decision | A balanced, validated feature can become the default if evidence supports it | Phases 1–5 | Device, performance and balance checks can run concurrently after their relevant feature lands. |

**Coordination:** agree the interfaces at the start of Phase 1; separate branches and file ownership by concern. Domain exposes charge in `[0, 1]`, a phase (`charging`, `ready`, `active`, `returning`), remaining active ticks, and one activation request consumed by a running tick. The setup owner supplies the frozen boost rule (`off` or an explicit tuning revision). Missing persisted metadata means `off`. Domain and physics own `src/domain/race/`. HUD and controls own UI and input adapters. The application owner owns setup, `RaceSession`, and result policy. The integrator wires the shared input and snapshot types. After Phase 1, the effects owner owns rendering, the AI owner owns strategy, and the persistence owner owns score/ghost category changes. The nearby owner owns the transport and lobby. Integration changes to shared files such as `RaceSession` use the integrator. The integrator owns shared composition files, resolves overlaps, reviews each PR and re-runs relevant gates on the merged result. Parallel branches must rebase on the latest main and cannot merge ahead of their stated dependencies.

### Phase 1 — Playable local Arcade beta

**Deliverable:** an off-by-default **Boost Practice** option in local Arcade setup lets one player run on circuits and point-to-point tracks. Starting practice spawns only the player, shows their time and splits, and explains up front that the run is unranked. Reuse the existing solo vehicle selection in `RaceSession.start`. Current setup exposes Time Trial only for point-to-point tracks, and Normal Race spawns AI. Gate practice on local starts and carry the frozen rules through Retry. Nearby and ghost starts must reject practice at the race-start boundary.

- [ ] Implement deterministic fixed-step charge/state, race-local rules and lifecycle in the race domain; integrate through `raceVehicleStepper.ts`, `vehiclePhysics.ts` and `vehicleDynamics.ts` at the actual authoritative owners. One initial forward impulse only; respect the safety limiter, ceiling, braking, recovery and safe return.
- [ ] Add meter, ready/active feedback and a stable boost control above BRAKE. Extend existing input/ports for a one-shot command; support multitouch and an available desktop key. Avoid duplicated synthesized clicks, lost presses, accidental brake activation and stale input on pause/reset/exit.
- [ ] Apply the same unranked rule at both owners: `raceResultRecorder.ts` skips score reads, comparisons and writes, and `raceSession.ts` skips ghost lookup, recording and final save. Omit personal-best and ghost-save prompts for practice results. Include the frozen rules and activation edges in diagnostic exports if they support input replay. Otherwise mark these runs as pose-only in the export so tools cannot silently replay them with boost off. Test on a track with a saved score and ghost, including retry, and assert that neither store is accessed for the practice run. Disable new boost starts through the capability flag to roll back.
- [ ] Test charge thresholds, equal surfaces and braking drift; invalid/airborne/off-road/collision inputs; charge retention, activation, brake precedence, hold, pause and recovery. Cover actual physics ceiling/return and unchanged boost-off/Simulation behavior. Test unsupported starts, UI component states and simultaneous controls. Exercise checkpoint/finish crossings, ramps, water and collisions at boosted speed; fix reproducible failures before shipping.
- [ ] Run the relevant checks below and an Android touch smoke for steering while activating boost.

### Phase 2 — Feedback and visual polish

**Deliverable:** readable, satisfying feedback for the existing solo beta.

- [ ] Add exhaust anchors to each car and bounded flames using the selected pin/topper color, vehicle pose and elevation. Stop immediately when boost ends. Reuse existing rendering/effects infrastructure; no particle network payloads.
- [ ] Add a concise ignition sound and optional haptic only where existing sound/haptic preferences permit. Avoid new settings or elaborate effects unless playtesting shows a need.
- [ ] Component-test lifecycle/color and preference behavior; check day/night, bridge elevation, multiple cars and frame time on device. No regression to controls or ordinary races.

### Phase 3 — Fair AI and tuning

**Deliverable:** human and AI drivers compete under the same boost rules, with AI using boosts sensibly.

- [ ] Enable boost for local Arcade races against AI using the same charging and activation mechanism for every driver. Keep boost races unranked until Phase 4 is integrated. Use a generic policy based on available geometry, upcoming curvature, usable straight, braking distance, surface and car handling; avoid obviously unsafe activations. No free charge, speed cheat or track-name exceptions.
- [ ] Use `npm run qa:ai:benchmark` for the four-car baseline and `npm run qa:ai:sweep` when calibrating policy. Run both comparisons through the shipped boost physics and extend the harness in this phase to select boost rules if needed. Compare boost-off and boost-on using identical seeds/settings, recording completion, lap times, activations, collisions and recoveries. Preserve Hard → Medium → Easy ordering and each car's identity; fix AI policy rather than weakening a car to hide AI problems.
- [ ] Run relevant AI component tests, deterministic lane scenarios and `npm run qa:lanes`. Reject looping, excessive recovery or other material regressions; report measured results and any limits.

### Phase 4 — Boost records and ghosts

**Deliverable:** players can save, select and compare boost-enabled records and ghosts without contaminating historical results.

- [ ] Extend the existing score and ghost category builders with the frozen boost rule identity, including tuning revision. Preserve boost-off keys and treat missing legacy metadata as off. Require a matching revision for lookup, writes, selection and medal comparison. A tuning change that affects pace gets a new revision so earlier boost records and ghosts stay readable in their own category. Keep Boost Practice unranked. Enable ranked boost time trials and matching ghost races together, with an explicit setup choice.
- [ ] Ghosts play recorded poses. Legacy ghosts and ghosts without an effects stream use ordinary pose playback. Avoid speculative telemetry infrastructure.
- [ ] Test old data, boost-off/on separation, writes and lookup, incompatible selection and replay fallback. Check restart and migration without deleting existing records.

### Phase 5 — Nearby multiplayer

**Deliverable:** compatible peers can explicitly start a boost-enabled nearby race and see remote boost feedback.

- [ ] Extend existing lobby/race compatibility so every peer agrees on the frozen rule before starting; reject incompatible or legacy peers for boost-on races with a clear message. Ordinary boost-off multiplayer remains compatible.
- [ ] Keep the boost-off handshake and 19-byte pose format compatible. The current handshake checks protocol version equality and the pose flag byte already carries slot, elevation and round bits. Negotiate boost support and the tuning revision before sending any boost-specific payload. Carry only the current active state needed for remote exhaust through the existing pose sync for compatible boost-on races, so a dropped packet can recover on the next pose. Keep round, sequence, recovery and packet bounds authoritative.
- [ ] Test incompatible peers, malformed/stale/out-of-order messages, recovery, reset, disconnect and remote color/pose; measure packet overhead and boosted-speed smoothness. Enable the setup option for nearby only after these gates pass.

### Phase 6 — Balance and release

**Deliverable:** a documented release decision based on player feel, fairness and measured performance; default-on is conditional, not automatic.

- [ ] Benchmark the five available track exports: Rally2 (sustained drift), Sandy Beach (terrain/recovery), City Harbor (obstacles), Figure Eight (crossings), Kids Room (technical driving). Use them as fixtures, never production exceptions. Cover all four cars and both directions where supported with reproducible seeds; use targeted representative cases rather than an indiscriminate full matrix.
- [ ] Compare boost off/on and clean versus drift-heavy lines. Record times, time to charge, activations, benefit per boost, recoveries/collisions and AI behavior by car; check frame time and multiplayer packet overhead where relevant. Tune central parameters only when evidence warrants it, and use the AI tuning tool for car-specific AI improvements.
- [ ] Play on Android for multitouch, visibility, feel and performance. Review results, compatibility and rollback. Enable by default only if all relevant checks pass and drifting everywhere is not systematically superior to clean driving; otherwise keep opt-in and document the blockers.

## Implementation verification

Run focused domain/component tests first, then `npm run verify` (or `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`). Use `npm run qa:mobile` when actual browser touch/scene behavior is involved, and `npm run qa:lanes` for AI. Use a real Android device for touch/feel and performance claims; browser tests do not prove them. Record commands and outcomes in the PR, review against the gameplay contract and required CI, and fix failures rather than weakening tests. Keep the PR open if a required gate cannot run.
