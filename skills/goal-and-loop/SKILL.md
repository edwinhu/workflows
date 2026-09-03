---
name: goal-and-loop
description: "Use when a session's stopping condition is being written or repaired — \"set the goal\", \"write the /goal line\", \"what should the goal be\", \"give it a goal before I go to bed\", \"write the brief for the spawned agent\", \"it stopped overnight\", \"it idled while I was asleep\", \"it asked me a question instead of continuing\", \"why did it stop\", \"is the goal actually set\", \"make it keep working\", \"run this unattended\", \"leave it running overnight\". Use proactively BEFORE handing work to any session that will outlive the user's attention — a spawned agent, a background job, a craft dispatch left running, or this session at night. NEGATIVE ROUTING: composing a craft run's own goal is craft-dispatch.sh, which calls compose-goal.sh and needs no help; spawning the session is agent-spawn; delegating a task to a subagent is farm-out. This skill owns the WORDING of the stopping condition, the standing authority that travels with it, and the proof that it actually landed."
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# goal-and-loop — a stopping condition, and something that keeps asking

`/goal` decides whether to continue. `/loop` guarantees something asks — a cron tick the model
cannot cancel, reaching the case a goal cannot: a session already gone quiet, because nothing in a
goal runs when no turn is running. An unattended run needs both.

## Raise it

Three commands, in this order. Do not hand-write the transport.

```bash
S=${CLAUDE_SKILL_DIR}/../craft/scripts/goal-self-send.sh
bash $S "/goal <the linted goal>"
bash $S "/loop 30m Check the goal. If it is not met, take the next action now rather than proposing it."
```

Pass the goal as **one single-quoted argument**. The template is backticked, so double quotes hand
every `<CHECK>` to the shell to run *before* the script sees the string, and the goal then carries
that command's output where its text should be.

**Never build the command as `GOAL="$(cat goal.txt)"; bash $S "/goal $GOAL"`.** A staging file is
fine for `goal-lint.ts --file`, but interpolating it makes a compound command that no permission
rule can allowlist, so auto mode blocks the whole send.

**A craft dispatch raises both for you** — `craft-dispatch.sh` self-sends the composed goal and the
loop. Do not add a second loop; two crons means two ticks.

## Verify it — the send is not the setting

`goal-self-send.sh` **queues**; it does not set. It exits 0 on a successful enqueue, and a detached
drainer sends the line once this turn ends. So on your **next turn**, prove it:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/goal-verify.sh    # 0 = active (prints it), 1 = not set, 2 = can't tell
```

Exit 1 means no goal is set whatever the send reported. Re-send, or hand the user the `/goal` line
and say plainly that it is not active.

<EXTREMELY-IMPORTANT>
**Never report a goal as set on the strength of a send's exit code, and never treat one you only
wrote down as binding.** Measured 2026-09-02: four self-sends across three sessions all reported
success and set nothing — the sessions ran with no goal, and one of them wrote "I'm treating that
as binding on myself regardless" and idled three hours later. A goal held in prose is re-adjudicated
away; only the harness's goal blocks a stop.
</EXTREMELY-IMPORTANT>

**Three things make a self-send land, and all are load-bearing.** It must arrive when the pane is
IDLE — a prompt arriving mid-turn is enqueued and parsed as literal text. It must be TYPED, not
pasted — `herdr agent prompt` honors bracketed paste, so the drainer uses `pane send-text` +
`send-keys enter`. And it must be CHUNKED: Claude Code turns any single insert over **800
characters** (`kre=800` in its bundle) or ~2 lines into a `[Pasted text #N]` block, and the slash
parser requires input that literally starts with `/`, which a paste placeholder never does.
Sub-threshold inserts concatenate exactly like typing — which is why a long goal the user TYPES
works and the same goal sent in one call does not. Measured: a 1,460-char goal failed four
consecutive attempts in one call and executed first try when split into three.

Screen scraping cannot substitute for `goal-verify.sh`: `pane wait-output` matches the assistant's
own prose about `Goal set:`, and the `/goal active` chrome renders only in the working spinner, so
an idle pane shows nothing either way.

## Clear it

A closing goal does not stop the cron — that is the `CronDelete` tool, not the model deciding it is
finished. `bash $S '/goal clear'` for the goal; `CronDelete` for the loop.

<EXTREMELY-IMPORTANT>
## IRON LAW: NO GOAL A FINISHED STEP CAN SATISFY

**A goal names the state the WORK reaches, never the event on the way there.**

"craft has returned a verdict", "the recon report exists", "BRIEF.md has been carried out", "the
agent has reported back" — each is true while the objective is still unmet. The moment it closes the
session stops, and at 02:00 the work stops for the night. `craft has returned a verdict` closed on
`overallPass=false` with 0 of 5 tasks done and 20 blocking findings; craft's own loop is FAIL → fix
→ re-run, and a goal calling FAIL "done" stops the loop that was going to fix it.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## IRON LAW: NO UNATTENDED GOAL WITHOUT STANDING AUTHORITY

**Every decision the goal leaves open becomes a question asked into an empty room.**

If the session may commit, push, pick round-2 scope, choose between two branches it named itself, or
spend the rest of its round budget — the goal says so, in one sentence, up front.
</EXTREMELY-IMPORTANT>

## The four parts

| | |
|---|---|
| **1. END STATE** | the objective in its own terms, with a number someone could dispute. An adjective is a feeling. |
| **2. CHECK** | the backticked command whose exit code settles it, so running it is evidence rather than a claim. A goal settled by re-reading the conversation gets reasoned out of. |
| **3. ESCAPES** | a work counter AND a wall clock, both readable by the session. A counter stops a *losing* run, a clock stops a *stuck* one. The clock must outlast `maxRounds × a round` — craft's 6 and 720 min are the defaults to borrow. |
| **4. AUTHORITY** | what it may decide alone, plus the SHORT list of what genuinely stops it — a missing credential, a dead network, an irreversible or outward-facing action. **Everything not on that list is the next task, difficulty included.** |

## Lint it before you send it

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/goal-lint.ts "<the goal text>" --unattended
bun ${CLAUDE_SKILL_DIR}/scripts/goal-lint.ts --file BRIEF.md --unattended
```

Exit 0 clean, 1 findings, 2 usage. Twelve rules, all decidable from the string. Fix every critical
and major. `goal-self-send.sh` runs it at the chokepoint anyway — a critical refuses the send with
exit 8 and sends nothing; `--no-lint` overrides.

It settles what an exit code can settle and renders no opinion on whether the goal is *right*.

## The continuation rule

**When a sub-run returns and the goal is still open, take the next action. Do not propose it.**

Every measured stall happened at a moment of legitimate completion — a verdict landed, a brief
finished, a recon report arrived. Under an open goal that is the moment with the most information
the session will ever have, and the next action is the one it just finished naming. If two branches
are genuinely open, pick one, say why in a clause, do it. A menu offered at 02:00 is a five-hour
pause with extra steps.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Report "goal set" because the send exited 0 | the send only queues; 4 of 4 reported success and set nothing | `goal-verify.sh` next turn |
| Treat a goal you wrote down as binding on yourself | prose is re-adjudicated away; only the harness blocks a stop | verify, or tell the user it is not active |
| `GOAL="$(cat goal.txt)"; bash $S "/goal $GOAL"` | a compound command no permission rule can allowlist | pass the text as one single-quoted argument |
| Send inline without waiting for idle | lands as a queued prompt, parsed as literal text, no goal | the drainer's `agent wait` — never remove it |
| Switch the drainer to `herdr agent prompt` | it pastes, and a paste is never parsed as a slash command | `pane send-text` + `send-keys enter` |
| Treat a delivery receipt as proof the goal is set | delivery is not execution; only an executed command writes a `<command-name>` record | `goal-verify.sh` |
| Leave a session running overnight on a goal alone | nothing in a goal runs once the session is quiet | add `/loop 30m`, `CronDelete` when it closes |
| Write "has returned a verdict" / "the report exists" | milestone: true while the objective is unmet | name PASS, or the number the work must reach |
| End a turn with a question mark under an open goal | at 02:00 that is a five-hour pause | answer it in one line and act |
| Write "when done or blocked, notify and stop" | every difficulty becomes terminal | enumerate the terminal blockers; the rest is the next task |
| Hold a green commit "because the user is asleep" | the goal should have pre-authorized it; the commit is reversible, the silence is not | commit, and say so in the report |
| Put "and the user has approved" in a goal | a session cannot close it by working — measured 18h | review after the goal, as a step it performs |
| Write "or stop after N turns" | nothing counts turns | a counter file it can `cat`, and a wall clock |
| Report "N of M rounds used" and stop at N | the budget was the authorization, not a ceiling on ambition | spend it, or say why the remainder is unusable |
| Hand-write a goal for a craft run | `compose-goal.sh` already emits a conforming one | `craft-dispatch.sh` |

## References

- `references/templates.md` — the goal template, the unattended-brief template, and three real goals
  rewritten side by side.
- `scripts/goal-verify.sh`, `../craft/scripts/goal-send-drain.sh` — the proof and the transport.
- `../craft/scripts/compose-goal.sh` — the reference implementation; its header records why each
  clause is worded as it is.
