---
name: wc-traceability
description: Requirement traceability map for workflow-creator's own functionality
applies-to: [workflow-creator]
---

## Workflow-Creator Requirements Traceability

Maps workflow-creator's functional requirements to implementation steps and constraint coverage.

### Requirements (WC-01 through WC-12)

| ID | Requirement | Mode | Step(s) | Constraint(s) | Scope |
|----|-------------|------|---------|----------------|-------|
| WC-01 | Ground every workflow in PHILOSOPHY.md | M1 | Step 1 | wc-philosophy-loaded | v1 |
| WC-02 | Interview user to understand domain | M1 | Step 2 | — (convention) | v1 |
| WC-03 | Decompose into single-responsibility phases | M1 | Step 3 | — (convention) | v1 |
| WC-04 | Design structural gate artifacts | M1 | Step 3b | — (convention) | v1 |
| WC-05 | Apply enforcement proportional to drift risk | M1 | Step 4/4b | — (convention) | v1 |
| WC-06 | Design two entry points per workflow | M1 | Step 5 | — (convention) | v1 |
| WC-07 | Generate files with deviation rules | M1 | Step 6 | — (convention) | v1 |
| WC-08 | Self-audit via fresh subagent with read-only tools | M1 | Step 7 | wc-fresh-subagent-audit | v1 |
| WC-09 | Score P01-P20 principles with formal IDs | M2 | Step 2 | wc-principle-ids | v1 |
| WC-10 | Classify all gates with checkpoint types | M1-M3 | All | wc-checkpoint-classification | v1 |
| WC-11 | Include summary frontmatter in STATE.md | M1-M3 | All | wc-state-frontmatter | v1 |
| WC-12 | Audit-fix loop terminates on score, not feeling | M3 | Step 2 | — (Iron Law) | v1 |

### Coverage Summary

- **12 requirements defined** (all v1 scope)
- **6 with co-located constraint checks** (WC-01, WC-08, WC-09, WC-10, WC-11 + wc-traceability itself)
- **6 convention-only** (judgment-based, graduation candidates)
- **Coverage: 50% graduated to constraints**
- **12/12 with inline `<!-- implements: WC-XX -->` annotations in SKILL.md**
- **12/12 with `implements` field in STATE.md YAML templates**

### Graduation Candidates

| Requirement | Current | Graduation Path | Trigger |
|-------------|---------|-----------------|---------|
| WC-03 | Convention | Script checking "Responsibility:" fields in DESIGN.md | When 3+ workflows have been created |
| WC-05 | Convention | Script checking enforcement density per phase | When enforcement density metric is defined |
| WC-07 | Convention | Script checking deviation rules in generated files | When output format stabilizes |
| WC-12 | Iron Law | Already structurally enforced via ralph-loop | Graduated (structural) |
