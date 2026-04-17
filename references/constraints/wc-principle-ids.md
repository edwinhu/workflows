---
name: wc-principle-ids
description: Mode 2 architecture principles must have formal P01-P20 IDs for traceability
applies-to: [workflow-creator]
---

## Rule

The Mode 2 Step 2 scoring section MUST label each architecture principle with a formal ID (P01-P20). Audit output MUST reference these IDs. The IDs enable mechanical verification that all principles were scored.

## Rationale

**Why this exists** — without formal IDs, an auditor cannot mechanically verify "did this audit score all 20 principles?" Prose paragraph counting is fragile. IDs make gaps visible and auditable.

## Examples

### Correct
```markdown
**P01 — Phased decomposition:**
**P02 — Gates (deterministic or judgment-based):**
```

### Incorrect
```markdown
**Phased decomposition:**
**Gates (deterministic or judgment-based):**
```
