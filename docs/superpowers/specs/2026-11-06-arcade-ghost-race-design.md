# Arcade ghost races

Every completed Arcade race is eligible to establish or improve the best replay, including manual, automatic and water recoveries. Replays keep elapsed time and explicit discontinuities. Simulation retains clean-run rules. Normal Race has AI opponents and no ghost; Ghost Race is solo against the best matching saved replay. Match track revision, car, direction, laps and handling.

Race Setup always shows Normal Race and Ghost Race. Ghost Race is disabled, never hidden, when no matching replay exists. Explain the unavailable state and show the target time when available. Refresh availability on setup changes. A stale saved Ghost preference falls back to Normal when no replay exists.

Reuse the existing Web Storage repository and renderer. Keep recording memory bounded by compacting older samples rather than rejecting long Arcade races. Preserve recovery cuts during compaction and interpolation. Retain the fastest completed run, evict older replay combinations when space is constrained, and report save failures accurately. Show target time during Ghost Race and a ghost-specific finish result. No audio changes in this implementation; Micro Machines remains the agreed audio direction.

Approach: extend the existing recorder/store and setup UI. A separate replay engine or hosted leaderboard adds unnecessary state and services. No new dependencies.
