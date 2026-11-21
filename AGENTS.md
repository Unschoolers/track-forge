# Track Forge agent instructions

Before changing code, read [docs/README.md](docs/README.md), [docs/engineering-guidelines.md](docs/engineering-guidelines.md), and the relevant specialized documents.

- Prefer the smallest independently reviewable vertical slice. Respect `domain → application → adapters` responsibilities; do not add new reverse dependencies.
- Keep TypeScript strict. Preserve track format migrations, saved data, gameplay determinism, and native compatibility.
- Prefer component/contract tests to browser tests. Every new test must protect a distinct regression; follow [docs/testing-guidelines.md](docs/testing-guidelines.md).
- Use an explicit plan and review for risky or multi-module changes; see [docs/change-workflow.md](docs/change-workflow.md).
- Run the narrowest relevant checks first, then required gates. Do not change expectations, skip a failing test, or silence an error just to make CI green.
- Include before/after evidence for performance work; do not equate a lower test count with higher quality.
- Subagents may work in parallel only on separate files/branches with clear ownership. The integrator reviews and tests each slice before merging.
