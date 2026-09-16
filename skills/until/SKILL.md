---
name: until
description: "Use when a session's stopping condition is being written or repaired — \"set the goal\", \"write the /goal line\", \"what should the goal be\", \"give it a goal before I go to bed\", \"write the brief for the spawned agent\", \"it stopped overnight\", \"it idled while I was asleep\", \"it asked me a question instead of continuing\", \"why did it stop\", \"is the goal actually set\", \"make it keep working\", \"run this unattended\", \"leave it running overnight\". Use proactively BEFORE handing work to any session that will outlive the user's attention — a spawned agent, a background job, a craft dispatch left running, or this session at night. NEGATIVE ROUTING: composing a craft run's own goal is work-dispatch.sh, which calls compose-goal.sh and needs no help; spawning the session is agent-spawn; delegating a task to a subagent is farm-out. This skill owns the WORDING of the stopping condition, the standing authority that travels with it, and the proof that it actually landed."
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# until — a stopping condition, and something that keeps asking

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

`/goal` decides whether to continue. `/loop` guarantees something asks — a cron tick the model
cannot cancel, reaching the case a goal cannot: a session already gone quiet, because nothing in a
goal runs when no turn is running. An unattended run needs both.

## Raise it

Three commands, in this order. Do not hand-write the transport.

```bash
S=${CLAUDE_SKILL_DIR}/../work/scripts/goal-self-send.sh
bash $S "/goal <the linted goal>"
bash $S "/loop 30m Run the goal's CHECK and report its exit code — judge from the command, not from the conversation. If it fails, take the next action now rather than proposing it. If it passes, spend the remaining budget: hunt for work the goal did not name — an ungated checker, a suite nothing runs, a vendored copy, a count that has drifted — fix the largest one within your standing authority and say in one line why you picked it. When the budget is spent or nothing is left, clear the goal and cancel this loop with CronDelete."
```

Pass the goal as **one single-quoted argument**. The template is backticked, so double quotes hand
every `<CHECK>` to the shell to run *before* the script sees the string, and the goal then carries
that command's output where its text should be.

**Never build the command as `GOAL="$(cat goal.txt)"; bash $S "/goal $GOAL"`.** A staging file is
fine for `goal-lint.ts --file`, but interpolating it makes a compound command that no permission
rule can allowlist, so auto mode blocks the whole send.

**A craft dispatch raises both for you** — `work-dispatch.sh` self-sends the composed goal and the
loop. Do not add a second loop; two crons means two ticks.

<EXTREMELY-IMPORTANT>
**Auto mode refuses the self-send outright, the plain single-argument form included.** Claude Code
classifies a script that types into its own session as `Tmux Self Drive` — one of its
adversarial-pattern rules, alongside `Instruction Poisoning`, `Auto-Mode Bypass` and
`Self-Modification`. Those clear only when a human, shown what was flagged, confirms it is a false
positive: an allowlist entry does not clear one, and neither does the agent judging it safe.
Measured 2026-09-03 — a session already matching `Bash(bash ~/.claude/skills/workflows/skills/:*)`
was denied with `[Tmux Self Drive] Sending input or goals to the agent's own session via self-send
scripts`. Do not try to route around it; the workaround is itself the `Auto-Mode Bypass` pattern.

`work-dispatch.sh` does not notice. It calls `goal-self-send.sh` twice and treats a non-zero exit
as "not fatal", so under auto mode a run proceeds with NEITHER a stopping condition NOR a heartbeat
— the unattended idle this skill exists to prevent, arriving silently. A session that must raise its
own goal therefore cannot run in auto mode: start it in another permission mode, or have the user
type the `/goal` line. Either way `goal-verify.sh` is what settles it.
</EXTREMELY-IMPORTANT>

## Verify it — the send is not the setting

`goal-self-send.sh` **queues**; it does not set. It exits 0 on a successful enqueue, and a detached
drainer sends the line once this turn ends. So on your **next turn**, prove it:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/goal-verify.sh    # 0 = active (prints it), 1 = not set, 2 = can't tell
```

Exit 1 means no goal is set whatever the send reported. Re-send, or hand the user the `/goal` line
and say plainly that it is not active.

**It reports the LOOP too, whatever the goal did.** A `/loop` that fails to land was caught by
nothing until 2026-09-16 — the drainer wrote it to `<queue>.unconfirmed` and no one read that
file. Measured across every session's log that day: `/goal` landed 127 times and missed 36;
`/loop` landed 52 and missed **29**. More than a third of every heartbeat ever raised was never
armed, and the session was never told. `goal-verify.sh` now names it, and a `/loop` gets the same
four attempts a `/goal` does — the old one-attempt rule guarded against two crons, but
`confirmed` looks for the command's EXECUTION receipt, so "unconfirmed" is itself evidence that
no cron exists.

**Only the `CronList` tool proves a loop is armed.** `goal-verify.sh` reads the drainer's record,
which says a send did not confirm; it cannot see a cron. When it warns, call `CronList`. No job
means no heartbeat.

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

## The five parts

| | |
|---|---|
| **1. END STATE** | the objective in its own terms, with a number someone could dispute. An adjective is a feeling. |
| **2. CHECK** | the backticked command whose exit code settles it, so running it is evidence rather than a claim. A goal settled by re-reading the conversation gets reasoned out of. |
| **3. ESCAPES** | a work counter AND a wall clock, both readable by the session. A counter stops a *losing* run, a clock stops a *stuck* one. The clock must outlast `maxRounds × a round` — craft's 6 and 720 min are the defaults to borrow. |
| **4. AUTHORITY** | what it may decide alone, plus the SHORT list of what genuinely stops it — a missing credential, a dead network, an irreversible or outward-facing action. **Everything not on that list is the next task, difficulty included.** |
| **5. TEARDOWN** | `When this goal closes, cancel the run loop with CronDelete — it is a cron and does not stop on its own.` Verbatim, and not optional: a cron outlives the goal, `CronDelete` is a model tool with no CLI, and no hook fires on goal completion — so the goal text is the only thing present when it closes. `compose-goal.sh` emits this; a hand-written goal has to carry it too. |

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
| Set a goal on YOUR OWN session to test the transport | its Stop hook blocks idle, the clear needs idle, and only the user can break it | test against a throwaway pane, never the session you are working in |
| Set a goal whose check paths live in a different repo | it can never be met where it runs, only cleared | the check must be runnable in that session's own cwd |
| Report "goal set" because the send exited 0 | the send only queues; 4 of 4 reported success and set nothing | `goal-verify.sh` next turn |
| Self-send from a session running in auto mode | `Tmux Self Drive` denies it, and no allowlist or agent judgment clears an adversarial-pattern rule | raise it in another permission mode, or have the user type the line; prove with `goal-verify.sh` |
| Add an allowlist entry to get a self-send past auto mode | that is the `Auto-Mode Bypass` pattern — a second flagged behaviour, not a fix | change the permission mode, or hand the user the `/goal` line |
| Treat a goal you wrote down as binding on yourself | prose is re-adjudicated away; only the harness blocks a stop | verify, or tell the user it is not active |
| `GOAL="$(cat goal.txt)"; bash $S "/goal $GOAL"` | a compound command no permission rule can allowlist | pass the text as one single-quoted argument |
| Send inline without waiting for idle | lands as a queued prompt, parsed as literal text, no goal | the drainer's `agent wait` — never remove it |
| Switch the drainer to `herdr agent prompt` | it pastes, and a paste is never parsed as a slash command | `pane send-text` + `send-keys enter` |
| Treat a delivery receipt as proof the goal is set | delivery is not execution; only an executed command writes a `<command-name>` record | `goal-verify.sh` |
| Leave a session running overnight on a goal alone | nothing in a goal runs once the session is quiet | add `/loop 30m`, `CronDelete` when it closes |
| Report a heartbeat as armed because the `/loop` send exited 0 | the send only queues, and 29 of 81 never landed — the same trap as the goal, with no check | `goal-verify.sh` warns; `CronList` settles it |
| Write "has returned a verdict" / "the report exists" | milestone: true while the objective is unmet | name PASS, or the number the work must reach |
| End a turn with a question mark under an open goal | at 02:00 that is a five-hour pause | answer it in one line and act |
| Write "when done or blocked, notify and stop" | every difficulty becomes terminal | enumerate the terminal blockers; the rest is the next task |
| Hold a green commit "because the user is asleep" | the goal should have pre-authorized it; the commit is reversible, the silence is not | commit, and say so in the report |
| Put "and the user has approved" in a goal | a session cannot close it by working — measured 18h | review after the goal, as a step it performs |
| Write "or stop after N turns" | nothing counts turns | a counter file it can `cat`, and a wall clock |
| Report "N of M rounds used" and stop at N | the budget was the authorization, not a ceiling on ambition | spend it, or say why the remainder is unusable |
| Hand-write a goal for a craft run | `compose-goal.sh` already emits a conforming one | `work-dispatch.sh` |

## References

- `references/templates.md` — the goal template, the unattended-brief template, and three real goals
  rewritten side by side.
- `scripts/goal-verify.sh`, `../work/scripts/goal-send-drain.sh` — the proof and the transport.
- `../work/scripts/compose-goal.sh` — the reference implementation; its header records why each
  clause is worded as it is.
