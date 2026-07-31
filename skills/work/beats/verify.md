# VERIFY

After a ready wave appears complete, dispatch one fresh verifier with no implementation context. Give it
the receipt-selected generated plan (`planFile`, `planHash`), relevant TaskList task IDs, and produced
artifacts—not the doer's reasoning. The verifier is read-only and never repairs work.

Require it to process every applicable Success Criteria and Evidence Plan entry:

1. run or inspect the exact named evidence;
2. record the raw observation: exit code, quoted content, rendered observation, or blocker;
3. return PASS or FAIL for each criterion;
4. treat absent, ambiguous, stale, or unavailable evidence as FAIL;
5. confirm the observation occurred after the last relevant mutation;
6. do not invent criteria or soften the approved plan.

For evidence only the user can settle, return `FAIL — needs user`; the user's answer becomes the
TaskList evidence. Mechanical checks still run even when an implementer already reported them.

## Record the round

Represent each verification round as a TaskList item bound to `plan_task_id` and `planHash`. Its
description or completion metadata records:

- verifier session or resumable agent identity;
- task and criterion IDs checked;
- raw evidence observed;
- per-criterion PASS/FAIL;
- bare `OVERALL: PASS|FAIL`;
- outstanding blockers and retry linkage.

Never mutate the receipt-selected generated plan to record results. A round for another plan hash or one
dispatched before the last relevant change cannot satisfy the current task.

- On FAIL: preserve findings in TaskList, repair failing criteria worst-first, then end the turn so the
  goal refires.
- On PASS: close the verified implementation and verification items, clear the implementation `/goal`,
  and proceed immediately to human review. Verification is not acceptance.

## Verifier continuity

Round 1 is one fresh verifier with no implementation context. From round 2 onward, resume the same verifier by name or raw agent ID. Every resume says:

- “Assume nothing landed; re-check from scratch.”
- “Do not soften because you raised the finding.”

The verifier retains verification history, never implementation context. A replacement cannot reliably
confirm defects introduced while fixing earlier findings.

## Red flags

| About to | Do instead |
|---|---|
| Verify in the implementation context | Dispatch a fresh independent verifier |
| Pass a criterion the verifier could not check | Record FAIL and the blocker |
| Reuse a verification round from another `planHash` | Dispatch a current-hash round after the last change |
| Spawn a replacement after round 1 | Resume the original verifier |
| Put verification prose into the generated plan | Keep immutable specification separate from TaskList evidence |
| Stop after `OVERALL: PASS` | Continue to human review |
