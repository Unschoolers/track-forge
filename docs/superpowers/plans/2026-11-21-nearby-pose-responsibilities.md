## NearbyRace responsibility refactor (2026-11-21)

- **Invariant:** compatible 19-byte pose packets, same 30/60 Hz adaptive thresholds, exact host batch relay freshness/slot spoof validation, unchanged lobby stages, countdown and 4-player identity.
- **Approach:** `NearbyRace` retains connection/session state and player finish/disconnect handling; `nearbyPoseSync.ts` owns sequence and recovery counters, pose interpolation, network cadence, batched host relay, and in-flight send invalidation.
- **Alternatives:** rewriting Nearby protocol or converting poses to JSON increases interoperability risk and bandwidth; explicitly not pursued.
- **Validation:** low-cost pose sync contract tests for guest spoof rejection, duplicate/stale relays, host batch, 30→60→30 Hz adaptation, and late completions after room reset; full NearbyRace/multiplayer/native QA and Android build.
- **Rollback:** revert independently; no wire version bump, identity schema change or saved track migration.
