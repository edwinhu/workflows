---
name: dev-test-gaps
description: "Internal /dev requirement-to-evidence audit after authenticated implementation."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
---

# Dev test-gap audit

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-test-gaps`

Use the receipt-selected `{planFile, planHash}` and current TaskList only. Do not read a fixed
`SPEC.md` or `PLAN.md`, and do not produce `VALIDATION.md`, a progress ledger, or a visible review
artifact.

## Audit

1. Resolve and rehash the approved dev receipt immediately before auditing. Reject stale identity.
2. Read every `REQ-NN`, task criterion, real-test contract, and requirement-to-test mapping from the
   selected generated plan.
3. Inspect concrete unit, integration, and required E2E evidence. A skipped test, mock-only test,
   structural grep, or an old command result is not coverage.
4. Run the relevant tests fresh and read their exit status and output. User-facing requirements need
   the declared real/E2E evidence, not unit-only evidence.
5. Classify every requirement `COVERED`, `PARTIAL`, or `MISSING`, naming test files, test names,
   evidence commands, and raw outcomes.

For every PARTIAL or MISSING criterion create exactly one current-plan TaskList finding with
`item_kind: test-gap`, requirement ID, evidence, and any dependency. If a gap reveals an
implementation defect, create a repair work item/dependency for `dev-implement`; this audit does
not fix production code. Test-only changes still require a valid RED/GREEN result and independent
verification.

## Return contract

Return, rather than persist, this complete result:

```text
Test-gap audit result
- Plan: {planFile, planHash}
- Requirement → test matrix: [{requirement, criterion, tests, evidence, status}]
- Findings: [TaskList IDs]
- Fresh suite evidence: [commands, exit codes, relevant output]
- Verdict: COVERED | GAPS_FOUND
- Next ready wave: [TaskList IDs]
```

Only `COVERED` with no open gap finding admits `dev-review`. Otherwise route the repair IDs through
the shared implementation adapter and re-audit every requirement.
