# VERIFY — work adapter

Read `${CLAUDE_SKILL_DIR}/../beat-verify/SKILL.md` and follow it. The doctrine — the verifier is never
the doer, the recorded round, verifier continuity, evidence per criterion — is shared and is not
restated here. This adapter names only what `/work` hands the verifier and where each outcome goes.

**Dispatch payload.** Give the verifier the receipt-selected generated plan identity (`planFile`,
`planHash`), the current-hash TaskList task IDs, and the produced artifacts. Nothing else: not the
implementer's report, not the dispatch transcript, not `/goal` history.

**Continuity.** Round 1 is one fresh verifier with no implementation context. From round 2 onward,
resume the same verifier by name or raw agent ID rather than spawning a replacement.

**Round record.** Each verification round is a TaskList item bound to `plan_task_id` and `planHash`.

**Outcomes, in work's loop.**

- FAIL: preserve findings in TaskList, repair worst-first, then end the turn so the `/goal` refires.
- PASS: close the verified implementation and verification items, clear the implementation `/goal`, and
  continue to human review. Verification is not acceptance.
