---
name: dev-handoff
description: "Internal /dev resumption summary from an authenticated plan and TaskList."
user-invocable: false
disable-model-invocation: true
---

# Dev handoff

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-handoff`

A dev handoff is a returned value, not a `.planning/HANDOFF.md` file. The immutable receipt-selected
`{planFile, planHash}`, TaskList, project memory, and normal deliverables are sufficient to resume.
Legacy handoff, state, progress, and learning files are conversion-only provenance and never live
authority.

## Process

1. Resolve the approved current dev receipt and rehash its selected plan.
2. Read current-hash TaskList items in ID order: implementation, test-gap, review, verification,
   feedback, retries, blockers, and superseded attempts.
3. Identify the dependency-satisfied next ready wave and attach fresh verifier/reviewer identities
   and returned evidence summaries when present.
4. Return exactly:

```text
Dev handoff result
- Plan: {planFile, planHash}
- Current TaskList IDs: {open, inProgress, completed, findings, superseded}
- Blockers: [{taskId, reason, dependency}]
- Verifier/reviewer: [{identity, result, timestamp}]
- Next ready wave: [TaskList IDs]
```

Do not infer completion from a checkbox, git history, or a prior chat. A new session resolves the
receipt and reconciles TaskList before dispatching any work.
