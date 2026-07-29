---
name: beat-implement
description: "Shared IMPLEMENT primitive — one active /goal, work, then a fresh verifier that never wrote the code. Read by any phase that executes against a criteria table."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — IMPLEMENT

`implement = GOAL + VERIFY`

**This is the one beat that composes by plain concatenation, and the reason is measurable:** across
`dev-implement`, `ds-implement`, `writing-draft`, and `workshop`, every implement-shaped phase has
`/goal` and a verifier and **zero `AskUserQuestion` sites**. No human gate sits inside it, so nothing
has to yield mid-run. Every other beat interleaves an ask — `ds-plan` is profile → ask → plan, with
the asks triggered by measurements the phase just took — and interleaving is what a `.js` workflow
cannot express, because a workflow takes no mid-run user input.

So this primitive is also the only one that could compile to a workflow script unchanged.

**The caller supplies:** the criteria artifact, the turn budget, and what "the work" is.

<EXTREMELY-IMPORTANT>
## The verifier is never the doer

**The agent that did the work does not get to grade it.**

Verification runs in a **fresh subagent with no implementation context** — it sees the criteria and
the artifacts, not your reasoning, not your intentions, not the reasons a shortcut seemed fine.
Self-verification is rubber-stamping with extra steps: you already believe it works, which is exactly
why you stopped.

A verdict produced with your own context in the transcript is void. Re-run it fresh. A tainted PASS
is worse than no verification — it converts an open question into a false assurance the user acts on.
</EXTREMELY-IMPORTANT>

## Procedure

### 1. GOAL — one, confirmed, budgeted

Get exactly one `/goal` active, pinned to the criteria artifact, carrying a turn budget.

`/goal` is a built-in UI command: `Skill(goal)` fails and printing the line is a silent no-op,
because slash commands dispatch only on the **user input** path. In an RC session, self-inject:

```bash
if agent-msg resolve "$CLAUDE_CODE_SESSION_ID" >/dev/null 2>&1; then
    agent-msg send "$CLAUDE_CODE_SESSION_ID" "/goal <condition>"
fi
```

**If another agent spawned you, do not run that probe at all.** `$CLAUDE_CODE_SESSION_ID` resolves to
your *parent's* session, so the send injects into someone else's conversation, arriving as if its
owner had typed it. Report the literal line to your caller instead.

Two clauses the condition must carry:

- **A turn budget.** A loop with no floor is how a stuck task burns an afternoon unattended.
- **"Restated in the turn itself, not only in the file."** The evaluator reads the transcript and
  cannot open files — a condition provable only on disk can never be confirmed, so the goal refires
  until the budget burns out while the work sits finished.

### 2. Delegate when the work overflows

At **≥5 substantial files or ≥8 steps**, implementation goes to subagents and your job becomes
orchestration. A file is substantial only if you must read it in full or its change runs past a line
or two — six one-line fixes across six files is not five substantial files.

**Delegation thins your criteria, and that cost is paid deliberately.** Editing a file yourself, you
see how it behaves; dispatching it, you see a report, and the criterion you write tends to check the
*shape* of the change rather than whether it works. So write each criterion's Evidence **before**
dispatching, and prefer running the thing over inspecting it.

Delegating does not relax the Iron Law: a subagent that implemented something still cannot verify it.

### 3. VERIFY — fresh, adversarial, gated

Dispatch a verifier with no implementation context. For each criterion it must *run or inspect the
named evidence* — actually run it, not reason about what it would output — record the raw result, and
return PASS or FAIL per row plus one `OVERALL:` line.

A criterion whose evidence could not be checked is **FAIL**, not PASS.

**From round 2, resume the same verifier** rather than spawning a replacement. A resumed verifier can
confirm its own findings were fixed; a replacement re-derives everything and can never close a loop
it did not open — which is where defects *introduced by the fixes* hide. Give it a name at spawn, or
record the raw `agentId` where the harness refuses names. Every resume must say **"assume nothing
landed, re-check from scratch"** and **"do not soften because you raised the finding."**

This does not weaken the Iron Law: a verifier accumulates *verification* context, never
*implementation* context, and never acquires a stake in the work passing.

### 4. On FAIL, end the turn

Fix worst-first, then **end the turn immediately** so the goal refires and verification re-runs. Do
not summarize, do not ask whether to continue — the evaluator decides when this is done.

## Gate

The criteria artifact's verify log contains a run whose `OVERALL` is PASS, from a verifier dispatched
**after the last change**. Write the verdict into the artifact, not only into the conversation: a
gate that reads a file cannot pass on a verdict that lives only in chat.

PASS does not mean done. It says the work matches the criteria — nothing has yet checked the criteria
against what the user wanted. That is beat 5.

## Red flags

| Action | Why wrong | Do instead |
|---|---|---|
| About to verify the work yourself | You already believe it works; that belief is why you stopped | Fresh subagent |
| About to accept a PASS on a criterion the verifier could not check | An unchecked criterion reported as passing is a false assurance the user acts on | Treat "couldn't check" as FAIL |
| About to spawn a replacement verifier on round 2+ | It cannot confirm the previous round's findings were fixed, so defects introduced BY those fixes go unseen | Resume the named one |
| About to record the verdict only in chat | The gate reads the artifact; a verdict it cannot see is not a gate | Write the verify log |
| About to summarize and pause after fixing a FAIL | Every pause is a chance to lose the loop; the goal is waiting to refire | End the turn silently |

## Facts

- `/goal` is a UI command, not a skill. `Skill(goal)` is rejected; emitted text is never dispatched.
- The `/goal` evaluator judges from the transcript and cannot open files.
- Measured across four workflow families: implement-shaped phases contain zero `AskUserQuestion`
  sites. That absence is what makes this beat concatenable — and what makes it the only beat
  expressible as a workflow script.
