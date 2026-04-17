---
name: wc-fresh-subagent-audit
description: Workflow audits must use fresh subagents with read-only tools, never self-review
applies-to: [workflow-creator]
---

## Rule

Mode 1 Step 7 and Mode 3 Phase A MUST dispatch audit work to a fresh subagent with `allowed_tools=["Read", "Grep", "Glob"]`. The same agent that wrote/fixed workflow files MUST NOT score them.

## Rationale

**Why this exists** — self-review is rubber-stamping. The agent that wrote the files shares all the same context, biases, and sunk-cost attachment. April 2026 baseline audit: the initial composite was estimated at 6.5 by the writing agent; a fresh auditor tallied 5.2 — a 25% gap.

## Examples

### Correct
```python
Agent(
  subagent_type="general-purpose",
  description="Audit workflow",
  allowed_tools=["Read", "Grep", "Glob"],
  prompt="You are an independent auditor..."
)
```

### Incorrect
Main chat reads its own generated files and scores them inline without dispatching a subagent.

## Red Flags

- **"I'll just quickly score this myself to save time"** → STOP. The audit IS the value. Self-scoring is theater.
- **"The subagent will just read the same files I already read"** → STOP. Fresh context is the point. Your biases don't transfer.
