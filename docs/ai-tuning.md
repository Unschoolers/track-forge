# AI tuning ownership

Only the policy selection changed in this refactor; no pace, handling, or racing
line parameters were retuned.

| Concern | Authority |
| --- | --- |
| Driver difficulty behavior and UI descriptions | `src/domain/config.ts` — `DIFFICULTY_SPECS` |
| Per-difficulty overtaking behavior | `src/domain/config.ts` — `AI_OVERTAKE` |
| Which driver technique, rival pace, Arcade corner reserve, and authored-line speed ratio to use | `src/domain/race/ai/difficultyPolicy.ts` |
| Émile's per-car authored geometry, lane offsets and corner notes | `src/domain/race/ai/emileRacingLines.ts` |
| Physical car response and surfaces | `src/domain/race/vehiclePhysicsConfig.ts` |

Arcade selects Hard steering technique regardless of the chosen opponent
difficulty. Authored racing lines also select Hard steering technique in
Simulation; the selected difficulty still controls mistakes, overtaking, and
the authored line's speed ratio. Non-authored Arcade rivals use the shared
difficulty-specific corner reserve; authored lines override that reserve.

When changing AI balance, first update the owning data or policy, then run
`tests/domain/aiDifficultyPolicy.test.ts`, the relevant car-handling tests,
the seeded Émile race, and `qa:lanes`. Keep physical braking/grip and the
AI planner's predicted stopping ability consistent; do not tune all levels
globally to compensate for a single hairpin regression.
