---
name: wc-checkpoint-classification
description: Every gate in workflow-creator must be classified as human-verify/decision/human-action
applies-to: [workflow-creator]
---

## Rule

Every `**Gate:**` section in workflow-creator's SKILL.md MUST include a `[checkpoint: TYPE]` annotation where TYPE is one of: `human-verify` (auto-advanceable), `decision` (genuine pause), or `human-action` (manual step).

## Rationale

**Why this exists** — without classification, workflow-creator cannot run in autonomous mode. Every gate pauses for human input, including the 90% that are rubber-stamp approvals. Classification enables auto-advance for `human-verify` gates while preserving genuine pauses for `decision` gates.

## Examples

### Correct
```markdown
**Gate: Philosophy Loaded** `[checkpoint: human-verify, auto-advanceable]`
```

### Incorrect
```markdown
**Gate: Philosophy Loaded**
```
