---
name: wc-state-frontmatter
description: STATE.md updates must include summary frontmatter (requires/provides/affects)
applies-to: [workflow-creator]
---

## Rule

Every STATE.md update in workflow-creator MUST include `requires`, `provides`, and `affects` fields in YAML frontmatter. Ad-hoc `mode/step/status` alone is insufficient for automated resume and dependency analysis.

## Rationale

**Why this exists** — without structured frontmatter, a future session reading STATE.md gets `mode: create, step: 3b, status: completed` with no information about what artifacts exist or what was consumed. Handoff becomes manual archaeology.

## Examples

### Correct
```yaml
step: 3b-artifact-review
status: completed
requires: [PHILOSOPHY.md, INTERVIEW.md]
provides: [DESIGN.md]
affects: [.planning/wc/{name}/DESIGN.md]
```

### Incorrect
```yaml
step: 3b-artifact-review
status: completed
```
