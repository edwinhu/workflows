---
name: dev-accept
description: "Internal /dev REVIEW beat — presents verified work to the user and returns the terminal decision."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow dev"
---

# Dev acceptance — the human-review beat

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-accept`

Verification consumes the approved receipt-selected `{planFile, planHash}`, the returned test-gap and
review results, and TaskList. It does not read or write `REVIEW_STATE.md`, `VERIFY_STATE.md`,
`LEARNINGS.md`, `HUMAN_REVIEW.md`, or a fixed plan.

## Fresh independent verification

1. Re-resolve and rehash the receipt-selected generated plan; reject any identity mismatch.
2. Confirm the test-gap audit has no open current-plan gaps and review has returned `APPROVED` with no
   pending review finding. These results are admission evidence, not substitutes for verification.
3. Obtain a fresh run of the mechanical floor and the complete test suite. **Do not run them
   yourself**: verification happens after approval, this conversation is the approver, and
   `implementer-identity-gate` denies every Bash call from it — test runs included. Dispatch an agent
   to execute them and return each `{command, exitCode, raw output}` verbatim. Read all of it.
   Summarized or paraphrased results are not evidence; if an agent returns a verdict instead of
   output, re-dispatch for the output.
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
