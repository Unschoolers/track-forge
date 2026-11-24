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

The search now validates every promising coordinate against all six study tracks and both seeds **before** accepting it, including the pace of every rival. A profile may also tune the curvature activation point so ordinary curves do not inherit a hairpin reserve. At most two coordinate passes are made per run. The baseline comparison remains frozen and no new recovery, lost finish or unreviewed >1s slowdown can enter the selected profile. `--verify-only` tests the actual checked-in profiles against the strict 48-case matrix.

The next lab iteration revalidates the previous five-recovery candidate against the original frozen baseline before resuming. Yellow's apex-cut scale, sharp-entry reserve and preview combinations are searched first; Green's lower-difficulty reserve is searched for the remaining Normal traffic recovery. These are experimental overrides only, with unchanged production profiles and acceptance gates.

The three-recovery seed is now resumed and revalidated. The next bounded Yellow search couples Hard corner target, pursuit preview and edge avoidance, plus steering gain/reaction combinations. The two forward missed gates and one traffic off-road recovery remain the target; all original matrix and cross-track gates still apply.

The combined candidate at 7b349682 passed all 48 Hairpin cases with zero recoveries, DNFs or errors and all 96 matched cross-track trials with no regressions (run 45395237707). Promote exactly those four profiles and run the strict checked-in-profile matrix; required CI remains mandatory. Two pre-existing cross-track recoveries remain.

Promotion at 8330c51 failed existing required Bridge crossing, Émile difficulty-order and Kids Room pace gates. Green's 1.2 global lower-difficulty reserve also exceeds the existing policy contract. Restore the last passing production profiles. The repair lab retains only the measured Hard overrides, scopes local technical-corner reserves by difficulty, then searches lower levels independently against the Hairpin matrix, frozen Kids Room timing and matched Bridge checks. Required CI still decides production eligibility; no thresholds were changed.
