---
name: grind
description: "Use when work has to keep going with NO session alive — \"run this in a loop overnight\", \"grind loop\", \"start the loop and go to bed\", \"keep iterating hound the check passes without me\", \"a fresh agent every iteration\", \"loop on this for days\", \"the orchestrator session is burning tokens on status reports\", \"wake it only when the grid job lands\", \"what has the loop done so far\", \"stop the loop\", \"it keeps re-diagnosing the same dead item\". Use proactively when a hill-climb needs many cheap passes over hours or days and each pass costs more to supervise than to run. NEGATIVE ROUTING: a stopping condition for a session that stays ALIVE — a Stop-hook hold, a cron heartbeat, an overnight brief — is hound; one delegated piece of work handed to another model and waited on is farm-out; starting a persistent interactive session is agent-spawn. This skill owns the out-of-session loop, the append-only journal that is its whole memory, and the shell gate that decides when a model call is worth spending."
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# grind — a loop with no session, whose only memory is one append-only journal

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

A bash `while` loop that calls a fresh model process per iteration and keeps nothing between them.
Cost inside a chat session is *wakes × context*, and the context only grows: measured on this
project 2026-09-20, one orchestrator spent 1.05 billion cache-read tokens in a day across 1,816
turns on a ~575K-token context, and 208 of those wakes were status reports that needed no judgement
at all. Here nothing accumulates between iterations because nothing survives them.

The loop is `scripts/grind.sh`. Nothing session-scoped can be load-bearing in it — no `CronCreate`,
no Stop hook, no `Monitor`, no session id — so the journal is the whole interface. A human, or a
chat session peeking in, tails it and has no other handle on the run.

## Three rules, and each one is a defect this loop already hit

**1. The supervisor is a shell command, so no model call is spent while it is red.** `--gate` is a
cheap precondition — a queue check, a file that appears when a round lands. While it exits non-zero
the loop appends a `wait`, sleeps `--sleep`, and **never invokes the runner**. A verdict that takes
ten hours otherwise buys ten hours of model calls whose only finding is that the job is still
queued. Wake on decisions, not on events.

**2. The keep decision is `--check`'s exit code, never the agent's opinion.** An iteration reports
success whether or not it did anything, and no downstream check catches a confidently wrong answer.
The agent's only write channel is `append`, and no record it can write makes the loop declare
success.

**3. The floor list is read from the journal at the top of every pass, before the prompt is built.**
A fresh agent handed the same dead pool re-diagnoses it every iteration, for a week. A key filed as
a `floor` is injected into every later prompt as an exclusion, which is the only reason an amnesiac
loop converges at all.

<EXTREMELY-IMPORTANT>
## IRON LAW: NO STOP THE LOOP DID NOT COMPUTE

**`done` is written only after `--check` exited 0, in the loop's own process.**

A model asked whether the goal is met answers from the pass it just ran, which is the one view that
cannot see the goal. Every other terminal record — `stalled`, `budget`, `stopped` — is likewise a
count or an exit code, never a judgement. Pick a check that names the state the WORK reaches: a
suite passing, a rate under a number, a count at zero. `test -f report.md` is true while the
objective is unmet, and the loop exits on pass 1.
</EXTREMELY-IMPORTANT>

## Start it detached

```bash
setsid nohup bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh run \
  --journal /abs/run.jsonl \
  --prompt-file /abs/PROMPT.md \
  --check 'bash /abs/measure.sh --lost-below 120000' \
  --gate  'test -f /abs/out/round-ready' \
  --sleep 300 --stall-after 5 --max-iters 200 \
  >/abs/grind.log 2>&1 </dev/null &
```

Never foreground it: a Bash tool call caps out and takes the run with it, and a session held open to
watch is the cost this skill exists to remove. `--runner` defaults to `claude-code` and `--model` is
passed through to it; a test or a dry run points `--runner` at a stub instead. Every ending — `done`, `stalled`,
`budget`, `stopped` — is announced by default: `agent-msg` to the session that launched the run
(`--notify-to` names another), plus a herdr popup where herdr is installed. `--notify CMD` replaces
that and gets `RALPH_STATE`, `RALPH_EXIT` and `RALPH_JOURNAL`; `--notify none` silences it. A failed
notification never changes the exit code.

Then, from anywhere and at any time:

```bash
J=/abs/run.jsonl
bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh status --journal "$J"      # state, pid, iterations, floors, stall
bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh tail   --journal "$J" -n 40
bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh floors --journal "$J"
bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh stop   --journal "$J" --why 'grid down for maintenance'
```

`stop` is a record, not a signal: the loop honours it at its next boundary, after the pass in flight
finishes. Once the loop answers it with `stopped`, the same `run` command resumes the journal,
floors and all. Exit codes are `0` done, `2` refused, `3` stalled, `4` budget exhausted, `5` stopped.

That subcommand is refused from inside an iteration, and the refusal names its reason — the loop
marks the environment it invokes the runner in, and an operator's own shell carries no such mark, so
an iteration that reads this file and concludes the work looks impossible cannot end a run the
operator started. The guard closes the documented path and claims nothing beyond it: an iteration
runs bash and can still `kill` the pid recorded in `start`, so this prevents a good-faith mistake
rather than guaranteeing the loop cannot be stopped from inside.

## Against hound — the difference is whether anything stays alive

|  | hound | grind |
|---|---|---|
| what stays alive | a chat session, held open by a Stop hook and re-woken by a cron heartbeat | nothing — a bash loop outside every session |
| the memory | that session's context, which grows with every turn | one journal; each iteration is a fresh process that starts empty |
| what decides to continue | the hook, running the check when the session tries to stop | the loop, running `--check` at the top of every pass |
| what it costs | wakes × a context that only grows | one model call per decision, none while the gate is red |
| reach for it when | the work needs that session's own tools, connectors or approvals | the work is a command plus a prompt, and it will take days |

## The journal is the only file

There is no pidfile, no state file, no lock and no cache. Every fact is derived by reading the
journal — the iteration counter is the largest `i`, the floor set is every `floor` record, the pid
comes from `start`. Two files that can disagree about one fact are a bug generator.

| kind | written by | means |
|---|---|---|
| `start` | the loop | a run began: pid, check, gate, runner, model, prompt file |
| `iter` / `iter_end` | the loop | iteration N began; the runner exited with this code |
| `wait` | the loop | the gate was red, so the pass cost nothing |
| `progress` | the agent | the goal moved; this is what `--stall-after` counts back from |
| `floor` | the agent | this key is dead for good, and every later prompt is handed it |
| `done` | the loop | `--check` exited 0 — the only record that means success |
| `stalled` / `budget` | the loop | `--stall-after` passes with no progress; `--max-iters` spent |
| `stop` / `stopped` | the operator / the loop | a stop was requested; the loop honoured it |

That split is enforced, not merely described. The agent may append only `progress`, `floor`,
`attempt` and `note`: `append` refuses every loop-owned kind with exit 2, so nothing an iteration
writes can end a run or report a finish the loop did not compute. A `floor` is refused unless it
carries a non-empty `key`, because one accepted without a key is dropped by the reader and the loop
re-diagnoses that family forever.

Every prompt carries `RALPH_JOURNAL`, `RALPH_SH`, `RALPH_ITER` and `RALPH_FLOORS`, so an iteration
needs nothing from outside itself:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh append --journal "$RALPH_JOURNAL" \
  '{"kind":"progress","key":"2004-noseries","note":"heading index resolved 41K rows"}'
bash ${CLAUDE_SKILL_DIR}/scripts/grind.sh append --journal "$RALPH_JOURNAL" \
  '{"kind":"floor","key":"1934-paper-scans","why":"no machine-readable text in the source"}'
```

A record must be one JSON object on one line and must fit in a single atomic write, or it is
**refused** — never split, never truncated — because a split record leaves a log nobody can replay.
Readers skip lines that do not parse, which is what makes a journal cut short by a crash resumable
rather than fatal. Anything larger than a key and a note belongs in a file the record names.

Reading it by hand is the same one pass:

```bash
grep -c '"kind":"iter"' "$J"                                  # iterations attempted
grep '"kind":"floor"' "$J" | jq -r '"\(.key)\t\(.why)"'       # the set every prompt is handed
grep '"kind":"iter_end"' "$J" | jq -r 'select(.exit != 0) | .i'
```

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Let an iteration's own report decide the run is finished | the loop would be grading itself, and one confident wrong answer ends a week of work with the goal unmet | only `--check` exiting 0 writes `done`; the agent writes records, never verdicts |
| Point `--check` at a milestone — a file existing, a report written, an agent having reported back | it is true while the objective is unmet, so the loop stops on pass 1 | name the state the work reaches: a suite passing, a count under a number |
| Run without `--gate` when the verdict takes hours | every pass spends a model call to learn the job is still queued — that is the whole bill | a shell precondition; while it is red the loop records `wait` and sleeps for free |
| Hand an iteration a key an earlier one closed | it re-diagnoses the same dead family every pass, and the loop never converges | read `RALPH_FLOORS` before choosing work; file a `floor` the first time a key dies |
| Append a whole report as one record | over the single-write bound it is refused, and splitting it would leave a log nobody can replay | a key and a one-line note; write the report to a file and name its path |
| Add a pidfile, a progress file or a notes file beside the journal | two files that can disagree about one fact, and the tiebreak rule is the bug | append a record; derive the pid, the counter and the floors from the journal |
| Foreground the loop from a chat session | the Bash tool call caps out and kills the run mid-flight, and the live session is the cost grind removes | `setsid nohup … &`, then `grind.sh status` when you want to know |
| `kill -9` the loop to end it | the journal then ends on `iter`, and nothing can tell a kill from a crash | `grind.sh stop`, honoured at the next boundary |
| Read `iter_end` with exit 0 as progress | it says the process ran, not that anything moved | `progress` records, which are what `--stall-after` counts |
| Reach for hound's hold to keep this going | the hold keeps a SESSION alive, which is the thing this loop exists to avoid | hound while a session must live; grind when none should |
