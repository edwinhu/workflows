---
name: ds-common-constraints
description: Common deterministic constraints index for the ds workflow
applies-to: [ds]
---

# DS Workflow: Common Constraints

Deterministic rules for the DS workflow. Each constraint can be verified by a script returning pass/fail. Self-contained files under `${CLAUDE_PLUGIN_ROOT}/references/constraints/`.

**See also:** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md` for judgment-based behavioral guidance (V1-V9).

After reading this index, load the specific constraint files your task needs.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| C1 | Data Quality Checks | [ds-data-quality-checks.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-data-quality-checks.md) | Canonical DQ1-DQ6, M1, R1 definitions — load from ${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-checks.md, never inline |
| C2 | Post-Subagent Boundary | [ds-post-subagent-boundary.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-post-subagent-boundary.md) | After an agent returns, verification proceeds through its returned report, the approved PLAN, and project auto-memory; it does not investigate source or data |
| C3 | Deviation Rules | [ds-deviation-rules.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-deviation-rules.md) | R1-R3 auto-fix, R4 stop for user decision — record deviations in the structured result returned for the task; return reusable project auto-memory candidates |
| C4 | External Skill Discovery | [ds-external-skill-discovery.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-external-skill-discovery.md) | Before the approved PLAN assigns an external skill, inspect its references and examples; prefer ADOPT/PATCH over greenfield |
| C5 | Data Pull Profile | [ds-data-pull-profile.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-data-pull-profile.md) | Before approving work involving a source >= 50M rows, >= 500 MB, or flagged large/bulk/TB/millions, profile raw versus aggregate shipping needs and record the decision in the approved PLAN |
| C6 | Sample Coverage | [ds-sample-coverage.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-sample-coverage.md) | The approved PLAN defines one canonical sample window and sub-windows; every windowed source has a Required-vs-Actual coverage row and disposition before task use |
