## RaceSession responsibility refactor (2026-11-21)

- **Invariant:** preserve fixed 60 Hz simulation, race-finished event ordering, save-once semantics, score category comparisons, ghost persistence, and player-only collision audio.
- **Approach:** keep session clock/lifecycle, race start/restart/step coordination in `raceSession.ts`; move score/result writes and standings conversion to `raceResultRecorder.ts`, audio/haptic translation to `raceFeedback.ts`.
- **Alternatives:** introducing a generic event framework would create more indirection without a second consumer; retain explicit function calls and narrow ports.
- **Verification:** focused successful/failed record, water and nearby exclusions, rival/collision feedback tests; existing session and replay parity suites for full flow; mobile QA for user experience.
- **Rollback:** revert independent PR; track files and multiplayer wire format are unchanged.
