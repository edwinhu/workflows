---
name: ds-common-constraints
description: Common deterministic constraints index for the ds skill family
applies-to: [ds, ds-fix, ds-implement, ds-accept, ds-delegate]
---

# DS Workflow: Common Constraints

Deterministic rules for the DS skill family. Each constraint can be verified by a script returning pass/fail. Self-contained files under `constraints/`.

**Skills that load this file:** ds (orchestrator), ds-fix (midpoint), ds-implement, ds-accept, ds-delegate.

**See also:** `ds-common-conventions.md` for judgment-based behavioral guidance (V1-V9).

After reading this index, load the specific constraint files needed for your current role.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| C1 | Data Quality Checks | [constraints/ds-data-quality-checks.md](constraints/ds-data-quality-checks.md) | Canonical DQ1-DQ6, M1, R1 definitions — load from ds-checks.md, never inline |
| C2 | Post-Subagent Boundary | [constraints/ds-post-subagent-boundary.md](constraints/ds-post-subagent-boundary.md) | After an agent returns, the orchestrator verifies through its returned report, the approved PLAN, and project auto-memory; it does not investigate source or data |
| C3 | Deviation Rules | [constraints/ds-deviation-rules.md](constraints/ds-deviation-rules.md) | R1-R3 auto-fix, R4 STOP for user decision — record deviations in TaskList and structured worker results; return reusable project auto-memory candidates |
| C4 | External Skill Discovery | [ds-external-skill-discovery.md](ds-external-skill-discovery.md) | Before the approved PLAN assigns an external skill, inspect its references and examples; prefer ADOPT/PATCH over greenfield |
| C5 | Data Pull Profile | [ds-data-pull-profile.md](ds-data-pull-profile.md) | Before approving work involving a source >= 50M rows, >= 500 MB, or flagged large/bulk/TB/millions, profile raw versus aggregate shipping needs and record the decision in the approved PLAN |
| C6 | Sample Coverage | [ds-sample-coverage.md](ds-sample-coverage.md) | The approved PLAN defines one canonical sample window and sub-windows; every windowed source has a Required-vs-Actual coverage row and disposition before task use |

## Role Loading Guide

Not every role needs every constraint. Load by relevance:

| Role | Must Load | Why |
|------|-----------|-----|
| **ds (orchestrator)** | C4, C5, C6 | Curate the approved immutable PLAN and dispatch work only after discovery, profiling, and coverage decisions are present |
| **ds-fix (midpoint)** | C1-C6 (all) | Midpoint can route to any role — needs the full constraint set |
| **ds-implement** | C1, C2, C3, C6 | Implementation performs technical checks, records deviations, and does not use a windowed source before coverage is asserted |
| **ds-accept** | C2 | Human-feedback review reads returned reports and records feedback without performing technical verification |
| **ds-delegate** | C2, C3, C6 | Delegation preserves the boundary, includes deviation handling, and supplies coverage assertions in task prompts |
