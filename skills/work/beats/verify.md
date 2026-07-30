# VERIFY

After the work appears complete, dispatch one fresh verifier with no implementation context. Give it
`.planning/WORK.md` and the artifacts, not the doer's reasoning.

Require it to process every Success Criteria row:

1. run or inspect the exact Evidence named in the row;
2. record the raw observation (exit code, quoted content, rendered observation, or blocker);
3. return PASS or FAIL for the row;
4. treat absent, ambiguous, or unavailable evidence as FAIL;
5. do not fix the work or invent new criteria.

For evidence only the user can settle, return `FAIL — needs user`; the user's answer becomes the
recorded evidence. Mechanical checks must be run by the verifier even if the implementer already ran
them.

Append each round to `WORK.md`:

```markdown
### Verify run <n>

| # | Criterion | Evidence observed | PASS/FAIL |
|---|---|---|---|

OVERALL: PASS

Outstanding: none
```

Keep the bare `OVERALL: PASS|FAIL` on its own line so the gate is mechanically readable. Restate the
verdict and evidence in the conversation because subagent reports are not the user-facing proof.

- On FAIL: repair failing criteria worst-first, then end the turn so the goal refires.
- On PASS: set `status: verified` and proceed immediately to human review. Verification is not
  acceptance.

## Verifier continuity

Round 1 is fresh. From round 2 onward, resume the same verifier by name or raw agent id. Every resume
message must say:

- “Assume nothing landed; re-check from scratch.”
- “Do not soften because you raised the finding.”

The verifier retains verification history, never implementation context. A replacement cannot reliably
confirm defects introduced while fixing its own earlier findings.

## Red flags

| About to | Do instead |
|---|---|
| Verify in the implementation context | Dispatch a fresh independent verifier |
| Pass a criterion the verifier could not check | Record FAIL and the blocker |
| Spawn a replacement after round 1 | Resume the original verifier |
| Stop after `OVERALL: PASS` | Continue to human review |
