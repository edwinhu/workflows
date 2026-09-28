---
name: hound
description: "Use when a session's stopping condition is being written or repaired — \"set the stopping condition\", \"hold it until the tests pass\", \"what should the objective be\", \"give it something to work toward before I go to bed\", \"write the brief for the spawned agent\", \"it stopped overnight\", \"it idled while I was asleep\", \"it asked me a question instead of continuing\", \"why did it stop\", \"is the hold actually armed\", \"make it keep working\", \"run this unattended\", \"leave it running overnight\". Use proactively BEFORE handing work to any session that will outlive the user's attention — a spawned agent, a background job, a work dispatch left running, or this session at night. NEGATIVE ROUTING: a long unattended loop whose target is a computable command is grind, which gets fresh context per iteration — hound keeps one session alive and re-enters its whole context on every wake; composing a work run's own stopping condition is work-dispatch.sh and needs no help; spawning the session is agent-spawn; delegating a task to a subagent is farm-out. This skill owns the CHECK COMMAND and the GOAL that settle it, the standing authority that travels with them, and the proof the hold is live."
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# hound — a hold that runs a check and asks a judge

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

**THE HOLD** — `hound-arm.sh` writes a session-scoped state file; `hooks/hound.ts` reads it on every
Stop and decides, in this order:

| | |
|---|---|
| the watched `--run` is IN FLIGHT | allow the stop, count nothing. The clock still runs |
| the check exits non-zero | block, count a round. One line: the check, its exit, the budget |
| the check exits 0, or there is no check | ask an independent judge whether the goal is met AND nothing obvious is left open. MET releases; UNMET blocks with the judge's reason |
| `--rounds` or `--minutes` reached | release, and the verdict is UNMET |

No transport, so nothing can fail to be delivered: the hold is a file, and the block is the Stop
hook's own return. The standing authority and the continuation rule are stated on the first counted
block and re-injected by `--brief` after a compaction.

## Hound or grind — decide first

**grind is the DEFAULT for any loop longer than about an hour whose target is a command**: a fresh
model process per iteration, keeping nothing between them. Hound keeps ONE session alive, and every
wake re-enters its whole context. Measured AGK 2026-09-27: a hound heartbeat woke 14 times with no
news, each wake re-entering a 113 KB plan and a 276 KB run dir, while a grind on the same objective —
a 3.6 KB prompt and a 1.3 KB check — met it in 3 iterations.

Hound is for a SHORT hold on work needing THIS session's tools, connectors or approvals.

## Arm the hold

```bash
A=${CLAUDE_SKILL_DIR}/scripts/hound-arm.sh
bash $A '<the CHECK command>' --goal '<the objective>' --rounds 4 --minutes 120
bash $A --goal '<the objective>' --run <run-dir>    # CHECK-LESS: the judge alone on the goal
bash $A --status     # armed? the check, the run, rounds used, minutes left, recent exits, ledger
bash $A --disarm     # THE USER releases it, confirming at a terminal; an agent gets exit 2
```

**`--run <dir>`** is a work run this hold watches. While that run is in flight — `args.json` there
with no non-empty `result.json` — a stop is ALLOWED and costs no round: the round is being worked by a
detached process, so a block buys nothing and every wake pays for the whole context again.

**Check-less is a real mode**, for a plan that states no computable check — inventing one would be a
check nobody wrote. The command refusals (already green, could-not-run) do not apply; `hold-lint.ts`
still runs on the goal, and an UNAVAILABLE judge **blocks** rather than failing open, because with no
check there is no other evidence.

Arming caps THIS session's auto-compact window at 250000 through the project's
`.claude/settings.local.json`; every release — pass, expiry or `--disarm` — restores it, and global
settings are never touched. `HOUND_COMPACT_WINDOW=0` opts out.

### Three layers, and the hole each one leaves

| layer | stops | leaves |
|---|---|---|
| tty prompt inside `hound-arm.sh --disarm` | an agent releasing the hold at all | needs a human at THAT terminal; no phone |
| the hook restoring a deleted state file from the ledger | `rm` on the state file, however spelled | a FORGED ledger line reading `released by user` |
| `permissions.ask` on `*hound-*.json*` and `*hound-*.releases.log*` | the literal spellings, and reaches the user anywhere | evadable by indirection: `rm -f "$STATE"` matches no pattern |

None is sufficient alone. The strongest is the tty prompt, which lives inside the program rather than
matching a string; the weakest is the permission rule, which a variable defeats. Keep all three: what
is left is a deliberate circumvention rather than an accident, and the ask rules make it visible.

**Release is not the session's to take.** Measured 2026-09-21: one session released itself twice in
an evening, each time believing "the gate measures the wrong property" — the argument equally
available to a session that merely finds the gate hard. So `--disarm` reads a confirmation from
`/dev/tty`: one keystroke for a human, exit 2 for an agent, every attempt in the ledger. The honest
move for a bad gate is to arm the right one, not to stop.

Pass the check as **one single-quoted argument, with no apostrophes in it** — an apostrophe ends the
quote, and double quotes would hand every backticked fragment to the shell to run first. Write "the
exemption in vendor-lint.sh", not "vendor-lint.sh's exemption".

The hold is **self-clearing on its own terms**: the hook removes the state file the moment the goal
is judged met, and again when either ceiling is reached — that release says UNMET, and saying so is
the session's job.

## The CHECK COMMAND

The check is the executable FLOOR of the objective; the `--goal` text is the objective, and the judge
rules on it. A check alone releases the moment one narrow command goes green; a goal alone has nothing
that runs. Arm both where both exist.

- **RED when armed, and able to run.** `hound-arm.sh` refuses exit 0 (a hold on a passing check holds
  nothing) and exit above 1 (could-not-run is not a verdict, and would hold forever on a typo).
- **One clause per claim.** `bun test x.test.ts && bash measure.sh --rate-below 0.01` — each half
  fails on its own terms, and the failure names which.
- **It must run in that session's own cwd.** A check whose paths live in another repo can never be
  met where it runs, only released unmet.
- **Broad enough that one edit cannot close it.** A check a single fix closes goes green and the session
  stops with the budget untouched — the founding complaint, "all I am doing is asking what else every
  hour". Prefer the whole surface to the defect you already know about.
- **No milestone.** `test -f report.md` is true while the objective is unmet. Name what the WORK
  reaches: a suite passing, a rate under a number, a count at zero.

## The escapes are flags, not sentences

`--rounds N` stops a *losing* run; `--minutes M` stops a *stuck* one. The hook counts and clocks both,
so neither is prose the session can re-adjudicate away. Defaults are 4 and 120, and the clock has to
outlast `rounds × a round`. Every red Stop counts a round and blocks — the one exception is a watched
`--run` in flight, which is not this session's turn to spend.

## The optional cron

A Stop hook reaches nothing once the session is quiet, so something outside it has to wake the session.
For a `work` dispatch that is the **`farm-runs` plugin monitor**: it watches the run for the whole
session and wakes it on milestones, on the verdict, and on a run that dies without one. A cron on top
of that wakes the session for nothing — AGK 2026-09-27, 14 ticks inside one round.

Add a `CronCreate` poll only when nothing else watches the work. An hour is the period, and the prompt
is a **NUDGE** — `and? (<run id>)`, no check, no paths, no restated authority or teardown, because a
wake re-enters the whole context anyway. `CronList` is the only proof a cron exists; the hook's
release message is what tells the session to `CronDelete` it.

### Lint the objective

The rules ABOVE are a specification, and until 2026-09-21 nothing enforced them: two gates passed
arm-time validation and were still mis-specified. `hold-lint.ts` settles the decidable part and arming
calls it, on the check and on the `--goal` text both — a CRITICAL refuses, anything less prints and arms:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/hold-lint.ts '<the CHECK>' --goal '<the objective>'
bun ${CLAUDE_SKILL_DIR}/scripts/hold-lint.ts '<the CHECK>' --probe    # also RUNS it twice
```

Refused on either surface: milestone phrasing ("has returned a verdict"), a clause only a human
closes ("and the user has approved"), a turn count, a round verdict (`work-result.sh`, `result.json`),
and success as a judgement. A `work` plan's `goalCheck` is run through the same rules by `plan-lint`,
one dispatch before the arm. There is no prompt linter — a nudge has nothing to lint.

`--probe` is where the value is: two runs that disagree, or one exiting above 1, is an instrument
rather than a gate, and the hook would block or release on chance. It also prices the check, which
runs on EVERY Stop. It renders no opinion on whether the objective is RIGHT; that stays yours.

Arming above the defaults (`--minutes` over 120, `--rounds` over 4) prints a WARNING naming the
per-wake context cost and the ready-to-run `grind` command on the same check, then arms.

## Prove it is live, and tear it down

`bash ${CLAUDE_SKILL_DIR}/scripts/hound-arm.sh --status` settles the hold. If a cron was raised,
**`CronList` — the tool, not a command — is the only proof it exists**: measured 2026-09-16, a creation
reported success while `CronList` showed none. The hold self-clears when the goal is judged met or a
ceiling is hit; `--disarm` needs the USER at a terminal, and `rm` on the state file is undone by the hook.

**Done means the goal is met, not that the check is green.** The hold releases `passed-goal-met`
only when the judge said the goal was met; on `passed-unjudged` (no `--goal`, or the judge was
unreachable with a check to fall back on) nobody confirmed the objective and a green check is all that
happened — say so rather than reporting it as done. Arm with `--goal` so the judge has something to
rule on.

`cron-delete-guard.ts` denies `CronDelete` while a hold is **armed**; the user's escape is
`work-abandon.sh <run-dir> --why '<reason>'`, which writes the run's verdict, releases the hold and
allows the delete.

<EXTREMELY-IMPORTANT>
## IRON LAW: NO OBJECTIVE A FINISHED STEP CAN SATISFY

**An objective names the state the WORK reaches, never the event on the way there.**

"the work run has returned a verdict", "the recon report exists", "BRIEF.md has been carried out", "the
agent has reported back" — each is true while the objective is still unmet. The moment it closes the
session stops, and at 02:00 the work stops for the night. `the work run has returned a verdict` closed on
`overallPass=false` with 0 of 5 tasks done and 20 blocking findings; `work`'s own loop is FAIL → fix
→ re-run, and calling FAIL "done" stops the loop that was going to fix it.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## IRON LAW: NO UNATTENDED RUN WITHOUT STANDING AUTHORITY

**Every decision left open becomes a question asked into an empty room.**

If the session may commit, push, pick round-2 scope, choose between two branches it named itself, or
spend the rest of its round budget — `hound-arm.sh` states it, on the first counted block and in
`--brief`. Not in a cron prompt, which is a nudge.
</EXTREMELY-IMPORTANT>

## The continuation rule

**When a sub-run returns and the check still fails, take the next action. Do not propose it.**

Every measured stall happened at a moment of legitimate completion — a verdict landed, a recon report
arrived — which is the moment with the most information the session will ever have, and the next
action is the one it just finished naming. If two branches are open, pick one, say why, do it. A menu
offered at 02:00 is a five-hour pause with extra steps.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Self-send anything — a prompt, a command, a stopping condition — from a session that will not go idle | a typed transport needs an idle pane and a session working back-to-back never offers one; the send exits 0 and nothing lands | `hound-arm.sh` writes a file, `CronCreate` is a tool call: both land inside the turn |
| Report a cron as armed because you created one | 29 of 81 raised on 2026-09-16 never armed, and nothing told the session | `CronList` settles it — no job, no wake |
| Arm a check that already exits 0 | it holds nothing and teaches the session the hold is noise | `hound-arm.sh` refuses it; pick the check that is red now |
| Arm a hold on a work round verdict (`work-result.sh`, `result.json`) | it can never certify the goal — it goes green on a FAIL the loop was going to fix — and it outlives an abandoned run | arm `args.goalCheck`, or nothing and let the judge rule on the goal |
| Arm a hound hold while a grind loop works the same objective | the hold blocks this session's stop while the grind's gate waits for no round in flight: both wait for the other, and neither moves (AGK 2026-09-27) | pick one driver — grind for a long loop, hound for a short hold this session drives |
| Arm a check whose paths live in a different repo | it can never be met where it runs, only released unmet | the check must run in that session's own cwd |
| Put an apostrophe in the check | it ends the single quote, and double quotes run every backticked fragment first | write the word without it |
| Arm a hold on YOUR OWN session to try the hook out | it then blocks your own stop until the check passes | read `tests/hound.test.ts`, or arm a check you can satisfy on demand |
| Treat a stopping condition you wrote down as binding on yourself | prose is re-adjudicated away; only the hook blocks a stop. Measured 2026-09-02: a session wrote "I'm treating that as binding regardless" and idled three hours later | arm it, and confirm with `--status` |
| Disarm your own hold because the gate looks wrong | that is the same sentence a session uses when the gate is merely hard, and it is not yours to judge: `--disarm` refuses without a tty and the hook restores a deleted state file | arm the RIGHT check — replacing a gate is allowed, stopping is not — or ask the user to confirm the release |
| Restate `--rounds` or `--minutes` as prose, or write "or stop after N turns" | two ceilings that can disagree, and nothing in the harness counts turns | the flags; the hook counts and clocks them |
| Leave a session running overnight with nothing to wake it | nothing in a Stop hook runs once the session is quiet | the `farm-runs` monitor for a work run; otherwise `CronCreate` a poll, and `CronDelete` it on release |
| End a turn with a question mark under an armed hold | at 02:00 that is a five-hour pause | answer it in one line and act |
| Write "when done or blocked, notify and stop" | every difficulty becomes terminal | enumerate the terminal blockers; the rest is the next task |
| Hold a green commit "because the user is asleep" | the authority clause should have pre-authorized it; the commit is reversible, the silence is not | commit, and say so in the report |
| Put "and the user has approved" in the objective | a session cannot close it by working — measured 18h | review after the hold releases, as a step it performs |
| Finish a hunt with a report and stop | the hold self-cleared when the check went green, so nothing gates stopping and the loop ends there | arm the next red check before the turn ends |
| Report "N of M rounds used" and stop at N | the budget was the authorization, not a ceiling on ambition | spend it, or say why the remainder is unusable |

## References

- `references/templates.md` — the check-command and cron-prompt templates, the unattended-brief
  template, and three real stalls rewritten side by side.
- `../work/SKILL.md` Phase 3 — where a `work` dispatch arms this hold, and what `args.goalCheck` is.
- `scripts/hound-arm.sh`, `../../hooks/hound.ts` — the arm and the hold. The hook's header records
  the three properties that make a Stop hook safe rather than a trap.
