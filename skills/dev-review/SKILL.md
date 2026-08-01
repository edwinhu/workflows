---
name: dev-review
description: "Internal independent /dev review over authenticated plan identity and TaskList."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow dev"
---

# Dev review

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-review`

Review the current receipt-selected generated `{planFile, planHash}` after the test-gap audit returns
`COVERED`. Never use `REVIEW_STATE.md`, `VALIDATION.md`, `LEARNINGS.md`, a fixed plan, or a visible
review ledger. TaskList is the live finding/retry record; the result below is the review account.

## Independent review loop

1. Resolve and rehash the approved dev receipt. Read its requirements, architecture, task criteria,
   evidence plan, and review surfaces.
2. Dispatch fresh read-only reviewer(s) with the exact plan identity, changed-code scope, fresh test
   evidence, and no implementation reasoning. Reviewer and doer must be different identities.
3. Require evidence for each reported issue, reject pre-existing or speculative findings, and capture
   actionable findings as one current-plan TaskList item each (`item_kind: review-finding`) with
   requirement/criterion references and retry dependencies.
4. Send fixes only through `dev-implement`; resume the reviewer after fixes and require a full fresh
   re-review. The controller reconciles findings; it does not patch or silently suppress them.
5. At the bounded retry limit, return `ESCALATE` with open TaskList IDs rather than fabricating an
   approval.

## Optional Codex second pass

After a primary PASS, Codex is optional. Record the user's launch, join, retry, decline, unavailability,
or completed verdict in the current review TaskList item and the returned result. A launch is not a
verdict: `requested` must be joined before approval. High-confidence actionable Codex findings create
normal TaskList findings and re-enter the same repair/re-review loop. Do not create
`codex-second-pass-*.json` or any planning ledger.

## Return contract

```text
Dev review result
- Plan: {planFile, planHash}
- Reviewers: [{identity, scope, freshEvidence}]
- Findings: [TaskList IDs with requirement/criterion links]
- Codex: {status: completed | declined | unavailable | retrying, verdict?, reviewTaskId}
- Verdict: APPROVED | CHANGES_REQUIRED | ESCALATE | BLOCKED
- Required next action: [TaskList IDs or dev-verify]
```

`APPROVED` means every reviewer has fresh evidence, no actionable current-plan finding remains, and any
chosen Codex pass has returned or is explicitly declined/unavailable. Then continue to `dev-verify`.
