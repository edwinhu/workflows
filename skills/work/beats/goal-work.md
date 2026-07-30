# GOAL + WORK

Get exactly one `/goal` active and pinned to the criteria in `.planning/WORK.md`. The condition must
carry a turn budget and restate the proof in the transcript because the evaluator cannot inspect disk.

`/goal` is a UI command, not a skill, and assistant-emitted slash-command text is a no-op. Only the
top-level session may ask the canonical helper to deliver it; a spawned agent must return the literal
command to its caller.

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal <condition>"
```

Proceed only when the helper returns `{"status":"delivered",...}` or the user explicitly confirms the
goal is active. Otherwise, print the literal command and stop until the user confirms activation.

Use this condition shape:

```text
/goal Every criterion in .planning/WORK.md is satisfied by its named Evidence and an independent
verifier with no implementation context has returned OVERALL: PASS after the last change. Restate the
verdict table and raw evidence in the turn itself. Stop after [N] turns.
```

Use 5 turns for routine work and 8–10 only for real unknowns. Confirm activation only from a successful
helper result or the user's explicit statement, never from emitted text. Clear the goal immediately after
independent `OVERALL: PASS`, before entering human review, with:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"
```

Proceed after a delivered helper result or explicit user confirmation; otherwise print `/goal clear` and
stop. REVIEW waits for user input outside the autonomous loop. If tactical review feedback changes the
work, activate a new bounded repair goal for the captured items, re-run the same verifier, clear that
goal on PASS, and return to REVIEW. On `REJECT:`, leave review without a goal and rewrite the criteria
before activating another one.

## Execute proportionally

Inline implementation is the default. At at least five substantial files or eight implementation
steps, dispatch complete task-local implementation briefs to subagents and orchestrate their results.
A file is substantial only when it must be read in full or changed beyond a line or two; raw filename
count is not the threshold.

Before delegation, pin each task's outputs, writable boundaries, criteria, and executable evidence.
Dispatch mutations sequentially unless real filesystem isolation exists. An implementation agent never
verifies its own work.

The checked-in shared runner is deliberately not used here. `workflows/beat-implement.js` authenticates
DS approved-plan metadata; `/work` follows the shared doctrine procedurally rather than weakening that
trust boundary.

## Red flags

| About to | Do instead |
|---|---|
| Call `Skill(goal)` or assume printed `/goal` text activated it | In the top-level session, run `bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal <condition>"`; otherwise return the literal command and stop |
| Continue after any helper result other than `status: delivered` | Return the literal command and stop until the user explicitly confirms activation |
| Run the helper from a spawned agent | Return the literal goal to the caller |
| Delegate six one-line edits because six files are named | Stay inline; count substantial context, not paths |
| Let a doer report serve as PASS | Run the independent verifier afterward |
| Execute the DS runner for `/work` | Keep execution procedural and DS provenance unchanged |
