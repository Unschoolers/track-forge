# Delivery, review and verification workflow

Use small, complete vertical slices. Parallel work is welcome when ownership is clear; never merge independent unchecked changes just because they are finished.

## Phase 1 — Understand

- Confirm the player/developer problem and reproduce it with a saved track, platform, settings and expected/actual behavior.
- Read [architecture](architecture.md), [engineering guidelines](engineering-guidelines.md) and the relevant specialized doc.
- Find the authoritative owner and existing tests before designing a replacement.
- For a cross-cutting change, write a brief plan with contract, invariants, alternatives, migration/rollback and verification cases. Avoid speculative redesign.

## Phase 2 — Implement

- Branch from current `main`. Keep one coherent concern per PR.
- Correct behavior at the narrowest owner. Do not duplicate domain logic in UI and Phaser.
- Add/adjust the **few high-value tests** that would fail on the bug; cover meaningful edges.
- Performance work includes baseline/reproduction and an equivalent after measurement, not just optimistic code.
- Agents can work independently on separate branches/files; integrator must review overlaps and cross-module assumptions before combining.

## Phase 3 — Verify

Run the narrowest relevant tests, then:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run verify` runs the complete JavaScript gate. Run `npm run qa:mobile` for touch/scene/browser changes, `npm run qa:mobile:production` for release boot and packaging changes, `npm run qa:lanes` and deterministic lane tests for AI/path changes, and the Android test/compile workflow for native changes. Do not assert a check passed unless executed or CI confirms it.

For native packaging, follow README signing/version instructions. Never work around mismatched certificates by telling users to overwrite saved data without a recovery path.

## Phase 4 — Review and integrate

Review for:

- Correct contract and meaningful edge cases; no weakened assertions
- Single behavioral authority and no prohibited dependency edges
- Backward compatibility, migration and malformed-input limits
- Resource cleanup, race conditions, asynchronous errors and native behavior
- Mobile input/accessibility, editor camera stability and render invalidation
- Measured performance impact and honest CI/test execution evidence

PR description:

```md
### User-visible change and reproduction
### Root cause and approach
### Invariants/compatibility protected
### Tests run (commands + outcomes)
### Performance evidence (if relevant)
### Risk, rollback and follow-up
```

Open a PR to `main`. Fix blocking failures rather than hiding them. Rebase/refresh after concurrent merges; merge only after review and required gates. Update docs when changing behavior or an engineering contract.

## Handling failures

- **Unknown failure:** preserve logs, input track, seed and configuration. Explain the uncertainty.
- **Flaky test:** reproduce multiple times; separate timing/host noise from product behavior.
- **Regression:** add a minimal reproducer at the correct boundary before fixing.
- **Blocked verification:** state exactly what did *not* run; leave PR open rather than implying success.
- **Post-merge issue:** prefer a focused fix or revert with a preserved reproducer. No silent catch blocks or threshold inflation.

## Release boundary

GitHub's `build.yml` separates web verification/build, conditional Android compilation, and protected main-only signing/release. Test-only and documentation-only pushes to main still run verification, but do not publish a new release. Native test-only and CI orchestration changes run native verification without publishing. Mixed product/test changes and packaging changes release normally; explicit manual release builds remain available. Determine the full main-push diff from the previous commit, fail visibly if it cannot be resolved, and never let a test-only push cancel an in-progress product release. Browser-only QA changes do not require native compilation on PRs. Changes to signing, native plugin APIs, Android permissions or installed-update behavior require explicit native validation. The PR workflow must not gain signing secrets.
