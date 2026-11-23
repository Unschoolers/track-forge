# AI tuning ownership

**Architecture invariant:** no track-specific AI rules. A track's geometry, local surfaces, crossing structure and its validated race options are inputs; its name, saved ID, content hash and manually indexed segment list must not select a dedicated racing line, handling rule, speed bonus or difficulty. Use real tracks only as deterministic regression fixtures. See [architecture](architecture.md#shared-invariants-to-protect).


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

An overtake remains committed for its difficulty-specific lane hold, then can
rejoin only after a quarter-second of clear base-lane space. Red's driving
profile also abandons a failed passing attempt after the target pulls beyond
the difficulty's overtaking range; all other cars retain the original
eight-second stalled-pass fallback. This avoids changing Green's validated
mixed-surface passing behavior while improving Red's pavement racing decisions.
The policy never adds grip, brakes, or engine power.

When changing AI balance, first update the owning data or policy, then run
`tests/domain/aiDifficultyPolicy.test.ts`, the relevant car-handling tests,
the seeded Émile race, and `qa:lanes`. Keep physical braking/grip and the
AI planner's predicted stopping ability consistent; do not tune all levels
globally to compensate for a single hairpin regression.
