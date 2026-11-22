# Track Forge engineering documentation

Start here for **current team/agent guidelines**. Older specs and plans under `docs/superpowers/` explain historical decisions but are **not automatically current architectural authority**.

| Document | Use it for |
| --- | --- |
| [Architecture](architecture.md) | Component map, runtime flows, boundaries and invariants |
| [Engineering guidelines](engineering-guidelines.md) | SOLID, DRY, data contracts, UI, rendering, performance, safety |
| [Testing guidelines](testing-guidelines.md) | Selecting, writing, consolidating, and deleting valuable tests |
| [Change workflow](change-workflow.md) | Delivery phases, verification, reviews, CI and regression handling |
| [Repository audit — 2026-11-21](repo-audit-2026-11-21.md) | Evidence-based improvement opportunities; **not** claims of fixed issues |
| [Mobile gameplay QA](gameplay-qa.md) | Touch/browser scenarios and limitations |
| [AI lane checker](ai-lane-checker.md) | Deterministic simulation diagnostics and regressions |
| [Race performance](race-performance.md) | Repeatable Chromium/Android measurements |
| [Night presentation](night-presentation.md) | Preview/race lighting parity and rendering budget |
| [Kids' Room environment](kids-room-environment.md) | Toy props, carpet hills, juice spills and visual-only road skins |
| [Environment material presentation](environment-materials.md) | Ground, road and terrain styling, visual parity, caching, and performance limits |
| [Vehicle artwork](vehicle-artwork.md) | Shared car silhouettes for race, flyover and selector; visual-only scope |
| [Recovery and checkpoint authoring](recovery-and-checkpoints.md) | Last road-contact recovery, automatic editor markers, safety and rollback |
| [Race replay exports](race-replays.md) | Hidden diagnostics trigger, all-car capture and export file contract |
| [Nearby sharing](nearby-track-sharing.md) | Share tracks with approval and stay connected across rematches |
| [Refactor history](refactorplan.md) | Shipped milestones and historical backlog |
| [Parity audit](trackforge-parity-audit.md) | Earlier migration parity decisions |

## What belongs in docs

1. Put **normative, durable rules** here; use links rather than copying the same rule into several files.
2. Add a short design note for cross-cutting changes affecting save format, physics, multiplayer protocol, or rendering architecture. State invariants, alternatives, migration and rollback.
3. Update the relevant current page in the *same PR* when changing a contract.
4. Keep incident-specific observations in the audit or a dated investigation; separate **verified behavior**, **inference**, and **proposal**.
5. Prefer concise examples using real repository paths and real commands. Remove stale statements instead of piling on exceptions.

The root [AGENTS.md](../AGENTS.md) directs coding agents to these guidelines.
