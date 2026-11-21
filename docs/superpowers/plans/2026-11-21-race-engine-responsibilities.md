## RaceEngine responsibility refactor (2026-11-21)

- **Invariant:** fixed 1/60 s ticks, unchanged random sampling order, shared road geometry, gate grace and recovery-before-progress semantics.
- **Approach:** move coherent gate, recovery and per-vehicle stepping rules out of `raceEngine.ts`. Keep the `resetRaceVehicle` and `recoverRacePlayer` re-exports at the old import path to preserve consumers.
- **Alternatives:** rewriting the whole tick pipeline or changing the data model would multiply risk without an observable need; not pursued.
- **Validation:** targeted fixed-step/recovery component cases plus existing diagonal checkpoint, ramps, AI lanes, water, reverse track and full unit suites. No serialized track or native protocol changes.
- **Rollback:** revert the independent PR if any deterministic simulation baseline changes; the API re-exports isolate callers.
