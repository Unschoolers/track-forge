# Directional jump ramps

## User contract

Select **Structure → Jump** and paint a contiguous road section in the editor.
The ramp ascends in authored forward direction and ends in an abrupt lip;
the road immediately following it is ordinary surface. Use the existing
24-world-unit relative elevation, with ramp length determining slope.
There is no height slider or speed boost.

V1 is directional: a circuit containing jumps must be raced forward.
Invalid or unsupported placements (missing approach/landing, short sections,
water on the ramp, crossing conflicts, start-grid overlap) report an explicit
race-readiness error. Surface painting removes the jump. Existing editor
section commands own history and serialization.

## Implementation boundary

- RoadStructure, track codec, path profile and stable section identity own
  authored geometry. The profile exposes both sides of the lip and avoids
  treating the discontinuity as a downhill grade.
- The deterministic 60 Hz race tick checks a finite swept forward crossing
  from grounded ramp support. The existing vertical dynamics owns flight,
  gravity and landing. Intentional launch skips bridge-fall recovery;
  ordinary lateral raised-road departures keep their existing policy.
- Phaser uses the existing cached bridge presentation with a discontinuous
  lip face, no jump rails, and a directional takeoff cue. Physics never
  depends on Phaser.
- Local tracks retain schema 8. Unsigned/signed jump exports use envelope
  versions 3/4; ordinary tracks keep 1/2. Older importers therefore reject
  new jump exports rather than silently flattening them. Nearby geometry
  transfer uses the same envelope selection. Do not downgrade an installed
  app with jump tracks in its local library: older local codecs do not know
  the new structure value. Export before any rollback.

## Verification and release gate

Run focused domain/component tests, the full verify gate, native/mobile
verification, and the existing optimizer against both jump and ordinary
holdout tracks:

```sh
npm run qa:optimize -- --workers 2 --trials 14 --seeds 1,4331 --scenarios jump-straight,jump-gravel,pine-hairpins,meadow-loop --out qa/results/jump-optimization
npm run verify
npm run qa:mobile
```

The AI optimization workflow runs that study separately from the matched
legacy-physics baseline so an older engine never receives a jump fixture.
Inspect every car's matched pace, recovery and finish metrics before promoting
any driving-policy changes. Then verify Easy/Normal/Hard ordering and real
Android flight/readability. No speed cheats or track-specific production AI.

PR #459 remains draft until CI, the jump study, independent review and
Android visual checks are confirmed. No claim of passing checks or tuned AI
is made by this document.
