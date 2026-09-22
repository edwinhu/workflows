---
name: hound
description: "Use when a session's stopping condition is being written or repaired — \"set the stopping condition\", \"hold it until the tests pass\", \"what should the objective be\", \"give it something to work toward before I go to bed\", \"write the brief for the spawned agent\", \"it stopped overnight\", \"it idled while I was asleep\", \"it asked me a question instead of continuing\", \"why did it stop\", \"is the hold actually armed\", \"make it keep working\", \"run this unattended\", \"leave it running overnight\". Use proactively BEFORE handing work to any session that will outlive the user's attention — a spawned agent, a background job, a craft dispatch left running, or this session at night. NEGATIVE ROUTING: composing a craft run's own stopping condition is work-dispatch.sh and needs no help; spawning the session is agent-spawn; delegating a task to a subagent is farm-out. This skill owns the CHECK COMMAND that settles it, the standing authority that travels with it, and the proof that both mechanisms are live."
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# hound — a hold that runs a check, and a heartbeat that keeps asking

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Two mechanisms, neither with a transport, so neither can fail to be delivered.

**HOLD** — `hound-arm.sh` writes a session-scoped state file; `hooks/hound.ts` runs the check on
every Stop and blocks while it exits non-zero. It decides whether to continue.

**HEARTBEAT** — `CronCreate`, a model tool called directly. It guarantees something asks once the
session has gone quiet, which no Stop hook reaches: nothing fires when no turn is running.

An unattended run needs both.

## Arm the hold

```bash
A=${CLAUDE_SKILL_DIR}/scripts/hound-arm.sh
bash $A '<the CHECK command>' --rounds 8 --minutes 720
bash $A --status     # armed? prints the check, the ceilings, and any release attempts
bash $A --disarm     # THE USER releases it, confirming at a terminal; an agent gets exit 2
```

### Three layers, and the hole each one leaves

| layer | stops | leaves |
|---|---|---|
| tty prompt inside `hound-arm.sh --disarm` | an agent releasing the hold at all | needs a human at THAT terminal; no phone |
| the hook restoring a deleted state file from the ledger | `rm` on the state file, however spelled | a FORGED ledger line reading `released by user` |
| `permissions.ask` on `*hound-*.json*` and `*hound-*.releases.log*` | the literal spellings, and reaches the user anywhere | evadable by indirection: `rm -f "$STATE"` matches no pattern |

None of the three is sufficient alone, and the list is the honest statement of that. The strongest
is the tty prompt, because it lives inside the program rather than matching a string; the weakest is
the permission rule, because a variable defeats it. Keep all three: the residual hole is a
deliberate circumvention, which is a different thing from an accident, and the ask rules make the
attempt visible.

**Release is not the session's to take.** Arming refuses a check that is already green or cannot
run, because a session will rationalise — and then release was left to that same judgment.
Measured 2026-09-21: one session released itself twice in an evening, each time with a reason it
believed ("the gate measures the wrong property"), which is the argument equally available to a
session that simply finds the gate hard. So `--disarm` reads a confirmation from `/dev/tty`: one
keystroke for a human, exit 2 for an agent, and every attempt appended to a ledger that `--status`
prints. Deleting the state file is not a release either — the ledger records the arm, and the hook
RESTORES a hold that vanished without a sanctioned exit. The honest move for a bad gate is to arm
the right one, not to stop.

Pass the check as **one single-quoted argument, with no apostrophes in it** — an apostrophe ends the
quote, and double quotes would hand every backticked fragment to the shell to run first. Write "the
exemption in vendor-lint.sh", not "vendor-lint.sh's exemption".

The hold is **self-clearing on its own terms**: the hook removes the state file the moment the
check exits 0, and again when either ceiling is reached — that release says UNMET, and saying so is the session's job.

## The CHECK COMMAND

The check is the whole objective. There is no separate end state to write down: a sentence and a
command disagree eventually, and only one of them runs.

- **It must be RED when armed.** `hound-arm.sh` refuses a check that already exits 0 — a hold on a
  passing check holds nothing and teaches the session that the block is noise.
- **It must be able to run.** Exit above 1 is could-not-run, not a verdict, and is refused too;
  arming on a broken command would hold the session forever on a typo.
- **One clause per claim.** `bun test x.test.ts && bash measure.sh --rate-below 0.01` — each half
  fails on its own terms, and the failure names which.
- **It must run in that session's own cwd.** A check whose paths live in another repo can never be
  met where it runs, only released unmet.
- **No milestone.** `test -f report.md` is true while the objective is unmet. Name what the WORK
  reaches: a suite passing, a rate under a number, a count at zero.

## The escapes are flags, not sentences

`--rounds N` stops a *losing* run; `--minutes M` stops a *stuck* one. The hook counts and clocks
both, so neither is prose the session can re-adjudicate away. Defaults are 8 and 720; the clock has
to outlast `rounds × a round`.

## The CRON PROMPT — the text that re-enters the session

`CronCreate` takes a prompt, and that prompt is the only thing present when a tick fires into a quiet
session. The authority, the continuation rule and the terminal blockers live in it.

```
Run `<CHECK>` and report its exit code — judge from the command, not from the conversation. If it
fails, take the next action now rather than proposing it. If it passes, spend the remaining budget:
hunt for work the check does not cover — an ungated checker, a suite nothing runs, a vendored copy,
a count that has drifted — fix the largest one, say in one line why you picked it, and ARM the
hold on it before the turn ends. Standing
authority: <commit / push / pick the next scope / re-dispatch> without asking. The only terminal
blockers are <a missing credential, a dead network, an irreversible or outward-facing action>;
everything else is the next task, difficulty included. When the budget is spent, end this heartbeat
with CronDelete.
```

**The hunt branch must re-arm.** The hold SELF-CLEARS the moment its check exits 0, so on green
nothing gates stopping and the tick is the only thing left driving. A hunt that ends in a report
ends the loop. Arm the next red check before the turn ends, and the hold does the driving again.

**Enumerate the terminal blockers.** The list is what keeps a hard problem from being filed as a
blocker. "When done or blocked, notify" produced a 5-hour idle: the session hit a fixture it could
not cut cleanly and, having no list, called the difficulty a blocker.

### Lint the check too

`hound-arm.sh` refuses a check that is already green or that cannot run — behavioural facts. The
rules ABOVE are a specification, and until 2026-09-21 nothing enforced them: two gates passed
arm-time validation and were still mis-specified (one measured a pager whose discreteness is
intended; the other asserted a threshold above its instrument ceiling, then began returning exit 3
on a flaky recorder). `hold-lint.ts` settles the decidable part and arming calls it — a CRITICAL
refuses, anything less prints and arms:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/hold-lint.ts '<the CHECK>'            # string rules
bun ${CLAUDE_SKILL_DIR}/scripts/hold-lint.ts '<the CHECK>' --probe    # also RUNS it twice
```

`--probe` is where the value is: two runs that disagree, or one that exits above 1, is an
instrument rather than a gate, and the hook would block or release on chance. It also costs the
check — this executes on EVERY Stop, so a three-minute check makes every turn end a three-minute
pause. It renders no opinion on whether the objective is right; "measures the wrong property" is
judgment and stays yours.

Lint the cron prompt before creating the cron:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/heartbeat-lint.ts "<the prompt>"
bun ${CLAUDE_SKILL_DIR}/scripts/heartbeat-lint.ts --file BRIEF.md
```

Exit 0 clean, 1 findings, 2 usage. Eleven rules, all decidable from the string. Fix every critical
and major. It settles what an exit code can settle and renders no opinion on whether the objective
is *right*.

## Prove both are live

`bash ${CLAUDE_SKILL_DIR}/scripts/hound-arm.sh --status` settles the hold. **`CronList` — the tool,
not a command — is the only thing that proves the heartbeat exists.** Call it. A cron you remember
creating is not a job; measured 2026-09-16, a creation reported success while `CronList` showed none.

## Two teardowns

| | |
|---|---|
| the hold | self-clears when the check exits 0 or a ceiling is hit. `--disarm` needs the USER at a terminal; an agent cannot release it, and `rm` on the state file is undone by the hook |
| the cron | `CronDelete`, a model tool with no CLI. Nothing else can end it — a session cron lives in memory, and no hook event fires when the work completes — so the last sentence of the cron prompt is the only thing present at the moment it should stop |

<EXTREMELY-IMPORTANT>
## IRON LAW: NO OBJECTIVE A FINISHED STEP CAN SATISFY

**An objective names the state the WORK reaches, never the event on the way there.**

"craft has returned a verdict", "the recon report exists", "BRIEF.md has been carried out", "the
agent has reported back" — each is true while the objective is still unmet. The moment it closes the
session stops, and at 02:00 the work stops for the night. `craft has returned a verdict` closed on
`overallPass=false` with 0 of 5 tasks done and 20 blocking findings; craft's own loop is FAIL → fix
→ re-run, and calling FAIL "done" stops the loop that was going to fix it.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## IRON LAW: NO UNATTENDED RUN WITHOUT STANDING AUTHORITY

**Every decision left open becomes a question asked into an empty room.**

If the session may commit, push, pick round-2 scope, choose between two branches it named itself, or
spend the rest of its round budget — the cron prompt says so, in one sentence, up front.
</EXTREMELY-IMPORTANT>

## The continuation rule

**When a sub-run returns and the check still fails, take the next action. Do not propose it.**

Every measured stall happened at a moment of legitimate completion — a verdict landed, a brief
finished, a recon report arrived. That is the moment with the most information the session will ever
have, and the next action is the one it just finished naming. If two branches are genuinely open,
pick one, say why in a clause, do it. A menu offered at 02:00 is a five-hour pause with extra steps.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Self-send anything — a prompt, a command, a stopping condition — from a session that will not go idle | a typed transport needs an idle pane and a session working back-to-back never offers one; the send exits 0 and nothing lands | `hound-arm.sh` writes a file, `CronCreate` is a tool call: both land inside the turn |
| Report a heartbeat as armed because you created one | 29 of 81 heartbeats raised on 2026-09-16 never armed, and nothing told the session | `CronList` settles it — no job, no heartbeat |
| Arm a check that already exits 0 | it holds nothing and teaches the session the hold is noise | `hound-arm.sh` refuses it; pick the check that is red now |
| Arm a check whose paths live in a different repo | it can never be met where it runs, only released unmet | the check must run in that session's own cwd |
| Put an apostrophe in the check | it ends the single quote, and double quotes run every backticked fragment first | write the word without it |
| Arm a hold on YOUR OWN session to try the hook out | it then blocks your own stop until the check passes | read `tests/until.test.ts`, or arm a check you can satisfy on demand |
| Treat a stopping condition you wrote down as binding on yourself | prose is re-adjudicated away; only the hook blocks a stop. Measured 2026-09-02: a session wrote "I'm treating that as binding regardless" and idled three hours later | arm it, and confirm with `--status` |
| Disarm your own hold because the gate looks wrong | that is the same sentence a session uses when the gate is merely hard, and it is not yours to judge: `--disarm` refuses without a tty and the hook restores a deleted state file | arm the RIGHT check — replacing a gate is allowed, stopping is not — or ask the user to confirm the release |
| Restate `--rounds` or `--minutes` as prose in the prompt | two ceilings that can disagree, and the prose one is the bug | the flags; the hook counts and clocks them |
| Write "has returned a verdict" / "the report exists" as the check | milestone: true while the objective is unmet | a suite passing, a rate under a number, a count at zero |
| Leave a session running overnight on the hold alone | nothing in a Stop hook runs once the session is quiet | `CronCreate` a heartbeat; `CronDelete` when the work is done |
| End a turn with a question mark under an armed hold | at 02:00 that is a five-hour pause | answer it in one line and act |
| Write "when done or blocked, notify and stop" | every difficulty becomes terminal | enumerate the terminal blockers; the rest is the next task |
| Hold a green commit "because the user is asleep" | the authority clause should have pre-authorized it; the commit is reversible, the silence is not | commit, and say so in the report |
| Put "and the user has approved" in the objective | a session cannot close it by working — measured 18h | review after the hold releases, as a step it performs |
| Write "or stop after N turns" | nothing in the harness counts turns | `--rounds`, which the hook counts |
| Finish a hunt with a report and stop | the hold self-cleared when the check went green, so nothing gates stopping and the loop ends there | arm the next red check before the turn ends |
| Report "N of M rounds used" and stop at N | the budget was the authorization, not a ceiling on ambition | spend it, or say why the remainder is unusable |

## References

- `references/templates.md` — the check-command and cron-prompt templates, the unattended-brief
  template, and three real stalls rewritten side by side.
- `scripts/hound-arm.sh`, `../../hooks/hound.ts` — the arm and the hold. The hook's header records
  the three properties that make a Stop hook safe rather than a trap.
