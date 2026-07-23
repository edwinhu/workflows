---
name: ds-common-constraints
description: Common deterministic constraints index for the ds skill family
applies-to: [ds, ds-fix, ds-plan, ds-implement, ds-review, ds-verify, ds-validate, ds-delegate]
---

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
| C4 | External Skill Discovery | [ds-external-skill-discovery.md](ds-external-skill-discovery.md) | Before drafting PLAN.md tasks that reference an external skill (wrds, gemini-batch, etc.), Glob its references/ and examples/, load domain refs, read example READMEs, prefer ADOPT/PATCH over greenfield |
| C5 | Data Pull Profile | [ds-data-pull-profile.md](ds-data-pull-profile.md) | Before finalizing PLAN.md with any source >= 50M rows, >= 500 MB, or flagged large/bulk/TB/millions — dispatch read-only profiling subagent to quantify raw vs aggregate ship size, record decision table in PLAN.md |
| C6 | Sample Coverage | [ds-sample-coverage.md](ds-sample-coverage.md) | ONE canonical sample window + sub-windows in SPEC; every windowed source has a Required-vs-Actual coverage row with a disposition per gap; no source used by a task until asserted against its required window (COV gate) |

## Phase Loading Guide

Not every phase needs every constraint. Load by relevance:

| Phase | Must Load | Why |
|-------|-----------|-----|
| **ds (brainstorm)** | C6 | Brainstorm writes the canonical sample window + sub-windows into SPEC (see also conventions V1-V3) |
| **ds-fix (midpoint)** | C1-C6 (all) | Midpoint can route to any phase — needs full constraint set |
| **ds-plan** | C4, C5, C6 | External Skill Discovery; Data Pull Profile; Sample Coverage — fill each source's Actual window from profiling and assert vs Required |
| **ds-implement** | C1, C2, C3, C6 | Implementation: data quality, delegation boundary, deviation tracking, no windowed source used before COV-asserted |
| **ds-review** | C1, C2, C6 | Review: data quality checks, post-subagent boundary, sample-coverage gate |
| **ds-verify** | C2, C6 | Verification: delegation boundary, sample-coverage gate |
| **ds-delegate** | C2, C3, C6 | Delegation: post-subagent boundary, deviation rules, coverage assertion in task prompts |
