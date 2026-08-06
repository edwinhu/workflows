---
name: beat-verify
description: "Shared VERIFY primitive — dispatch an independent verifier against approved criteria and return a recorded PASS/FAIL round to the caller."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — VERIFY

`verify = fresh eyes + named evidence`

The beat that establishes the approved criteria actually hold. It is shared by every workflow that
implements against an approved plan, so the two invariants below are stated once rather than
re-derived per domain.

**The caller supplies:** the receipt-selected immutable `{planFile, planHash}`, the relevant TaskList
task IDs, the produced artifacts, and the domain's evidence sources. It does **not** supply the
implementer's reasoning.

<EXTREMELY-IMPORTANT>
## The verifier is never the doer

**After a ready wave appears complete, dispatch one fresh verifier with no implementation context.**
It receives plan identity, task IDs, and artifacts — never the doer's account of what it believes it
did. The verifier is read-only and never repairs work. An agent that both wrote the code and grades
it cannot see the assumption it made in both places.
</EXTREMELY-IMPORTANT>

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

Represent each verification round as a TaskList item bound to the plan task ID and `planHash`. Its
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
  caller's goal refires.
- On PASS: close the verified implementation and verification items, clear the implementation `/goal`,
  and proceed immediately to human review. Verification is not acceptance.

## Verifier continuity

Round 1 is one fresh verifier with no implementation context. From round 2 onward, resume the same verifier by name or raw agent ID. Every resume says:

- “Assume nothing landed; re-check from scratch.”
- “Do not soften because you raised the finding.”

The verifier retains verification history, never implementation context. A replacement cannot reliably
confirm defects introduced while fixing earlier findings.

## Gate

Every current-plan task has a post-change round recorded against the current `planHash`, every
criterion carries raw evidence, `OVERALL: PASS`, and no criterion was left unchecked. Absence of a
round is a FAIL, not a pass.

## Red flags

| About to | Do instead |
|---|---|
| Verify in the implementation context | Dispatch a fresh independent verifier |
| Pass a criterion the verifier could not check | Record FAIL and the blocker |
| Reuse a verification round from another `planHash` | Dispatch a current-hash round after the last change |
| Spawn a replacement after round 1 | Resume the original verifier |
| Put verification prose into the generated plan | Keep immutable specification separate from TaskList evidence |
| Stop after `OVERALL: PASS` | Continue to human review |
