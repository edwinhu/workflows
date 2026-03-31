# DS Workflow: Common Constraints

Deterministic rules for the DS skill family. Each constraint can be verified by a script returning pass/fail. Self-contained files under `constraints/`.

**Skills that load this file:** ds (brainstorm), ds-fix (midpoint), ds-plan, ds-implement, ds-review, ds-verify, ds-delegate

**See also:** `ds-common-conventions.md` for judgment-based behavioral guidance (V1-V9).

After reading this index, load the specific constraint files needed for your current phase.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| C1 | Data Quality Checks | [constraints/ds-data-quality-checks.md](constraints/ds-data-quality-checks.md) | Canonical DQ1-DQ6, M1, R1 definitions — load from ds-checks.md, never inline |
| C2 | Post-Subagent Boundary | [constraints/ds-post-subagent-boundary.md](constraints/ds-post-subagent-boundary.md) | After subagent returns, main chat MUST NOT read source/data — verify via state files only |
| C3 | Deviation Rules | [constraints/ds-deviation-rules.md](constraints/ds-deviation-rules.md) | R1-R3 auto-fix, R4 STOP for user decision — track all deviations in LEARNINGS.md |

## Phase Loading Guide

Not every phase needs every constraint. Load by relevance:

| Phase | Must Load | Why |
|-------|-----------|-----|
| **ds (brainstorm)** | — | Brainstorm has no deterministic constraints (see conventions V1-V3) |
| **ds-fix (midpoint)** | C1-C3 (all) | Midpoint can route to any phase — needs full constraint set |
| **ds-plan** | — | Planning has no deterministic constraints (see conventions V1, V3) |
| **ds-implement** | C1, C2, C3 | Implementation: data quality, delegation boundary, deviation tracking |
| **ds-review** | C1, C2 | Review: data quality checks, post-subagent boundary |
| **ds-verify** | C2 | Verification: delegation boundary |
| **ds-delegate** | C2, C3 | Delegation: post-subagent boundary, deviation rules |
