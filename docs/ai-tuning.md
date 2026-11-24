# AI tuning ownership

**Architecture invariant:** no track-specific AI rules. A track's geometry, local surfaces, crossing structure and its validated race options are inputs; its name, saved ID, content hash and manually indexed segment list must not select a dedicated racing line, handling rule, speed bonus or difficulty. Use real tracks only as deterministic regression fixtures. See [architecture](architecture.md#shared-invariants-to-protect).


All courses use the same dynamic racing-line planner with per-car driving profiles.

| Concern | Authority |
| --- | --- |
| Driver difficulty behavior and UI descriptions | `src/domain/config.ts` — `DIFFICULTY_SPECS` |
| Per-difficulty overtaking behavior | `src/domain/config.ts` — `AI_OVERTAKE` |
| Which driver technique, rival pace, Arcade corner reserve to use | `src/domain/race/ai/difficultyPolicy.ts` |
| Physical car response and surfaces | `src/domain/race/vehiclePhysicsConfig.ts` |

Arcade uses the shared steering controller for every course. Per-car profiles calibrate Hard; difficulty-specific corner reserves, mistakes and overtaking control lower difficulties.

When changing AI balance, first update the owning data or policy, then run
`tests/domain/aiDifficultyPolicy.test.ts`, the relevant car-handling tests,
the seeded Émile race, and `qa:lanes`. Keep physical braking/grip and the
AI planner's predicted stopping ability consistent; do not tune all levels
globally to compensate for a single hairpin regression.

### Recovery-first technical-corner tuning (#315)

`technicalCornerPaceScale` and `technicalCornerPursuitScale` are optional per-car driver-policy reserves for all difficulties. They smoothly fade in on local curvature, default to 1 (unchanged), and do not modify the chassis or gates. Use `node qa/optimization/reliability.mjs` to screen the expanded 48-case Hairpin matrix against its frozen starting profiles, then validate the combined candidate across all six study courses. The report preserves each failure, and candidate selection cannot introduce new recovery, timeout, or unrelated engine error debt in any compared case. No track-specific production rules are allowed. Do not copy a proposed profile into production until combined validation is clean.
