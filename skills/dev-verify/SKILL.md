---
name: dev-verify
description: "Internal fresh /dev verification and terminal human review routing."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow dev"
---

# Dev verification

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-verify`

Verification consumes the approved receipt-selected `{planFile, planHash}`, the returned test-gap and
review results, and TaskList. It does not read or write `REVIEW_STATE.md`, `VERIFY_STATE.md`,
`LEARNINGS.md`, `HUMAN_REVIEW.md`, or a fixed plan.

## Fresh independent verification

1. Re-resolve and rehash the receipt-selected generated plan; reject any identity mismatch.
2. Confirm the test-gap audit has no open current-plan gaps and review has returned `APPROVED` with no
   pending review finding. These results are admission evidence, not substitutes for verification.
3. Run the mechanical floor and complete test suite fresh. Read all command output and exit statuses.
4. Dispatch a fresh read-only verifier, distinct from doers and reviewers, with plan requirements,
   criteria, real-test contract, review surfaces, and the fresh command evidence. The verifier checks
   every requirement with runtime evidence; structural existence alone is FAIL.
5. Create exactly one TaskList repair item for each `PARTIAL` or `NOT_MET` result. Route repair items
   through `dev-implement`, then repeat the full fresh verification. The verifier result must identify
   the verifier and preserve raw evidence.

For user-facing work, declared E2E/real-system evidence is required. Unit-only proof does not verify a
user-facing completion claim.

## Return contract

```text
Dev verification result
- Plan: {planFile, planHash}
- Mechanical floor and suite: [{command, exitCode, output}]
- Requirement evidence: [{requirement, status: MET | PARTIAL | NOT_MET, evidence}]
- Verifier: {identity, result}
- Repairs: [TaskList IDs]
- Verdict: PASS | REPAIR_REQUIRED
```

Only `PASS` with no open repair item may enter terminal user review. Load
`${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md`; present the plan's review surfaces and return its
`ACCEPT`, `REJECT`, or `CONTINUE` result. Capture comments in TaskList. A rejection returns to
clarification and a new approved plan; never create `REVIEW.md` or `HUMAN_REVIEW.md`.
