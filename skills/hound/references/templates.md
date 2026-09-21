# Check, cron-prompt and brief templates, and the three rewrites

## The check command

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/hound-arm.sh '<CHECK>' --rounds <N> --minutes <M>
```

`<CHECK>` is the objective. One clause per claim, red at the moment you arm it, runnable in this
session's cwd, no apostrophes. Filled in, for an unattended night:

```bash
bash skills/hound/scripts/hound-arm.sh \
  'bash skills/wrds/scripts/parse_npx/measure.sh --xml-error-rate-below 0.01' \
  --rounds 15 --minutes 480
```

The two ceilings are flags because the hook enforces them. Do not also write them into prose: two
ceilings that can disagree is a bug, and the prose one is the bug.

## The cron prompt

```
Run `<CHECK>` and report its exit code — judge from the command, not from the conversation. If it
fails, take the next action now rather than proposing it. If it passes, spend the remaining budget:
hunt for work the check does not cover, fix the largest one and say in one line why you picked it.
Standing authority: <what it may decide alone>. The only terminal blockers are <the complete list>;
everything else is the next task, difficulty included. When the budget is spent, end this heartbeat
with CronDelete.
```

**The CronDelete sentence is not optional.** A cron outlives the work, `CronDelete` is a model tool
with no CLI, a session-scoped cron lives in memory rather than on disk, and no hook event fires when
the objective is met — so nothing but this text is present at the moment it should stop. Measured
2026-09-16: a heartbeat raised without it re-ran a satisfied check twice more before a human noticed.

Lint it:

```bash
bun skills/hound/scripts/cron-prompt-lint.ts "<that text>"
```

## The unattended-brief template

A brief given to a spawned agent is a cron prompt with prose around it, and it fails the same ways.
The four sections below are the ones the failing briefs were missing.

```markdown
## What done looks like
<the command that settles it, and the number it must print>

## Standing authority
You may <commit / push / re-dispatch / choose scope / spend the round budget> without asking.
Do not ask about <the decisions that recur>: <the answer>.

## Terminal blockers — the complete list
<missing credential> / <network or grid down> / <an irreversible or outward-facing action>.
Nothing else is terminal. A hard problem is the next task, not a blocker.

## When you finish the stated scope and budget remains
<the named next thing>, or: pick the largest open item you found while working, say in one line
why you picked it, and start it. Report at the ceiling, not at the first stopping point.
```

**Do not write "when done or blocked, notify."** That sentence produced a 5-hour idle: the session
hit a fixture it could not cut cleanly, correctly refused to ship a test that did not reproduce the
defect, and — having no list of what counts as a blocker — filed the difficulty as one.

## The three rewrites

### 1. `npx-reconcile` — the milestone objective

Was: hold until `craft has returned a verdict for .planning/npx-iss-reconciliation.md`.

It closed on `overallPass=false`, 0 of 5 tasks implemented, 20 blocking findings. The session then
asked whether to amend and re-dispatch or read the findings first, and slept 4h10m.

Rewrite — the verdict file, read for PASS rather than for existence:

```bash
bash skills/hound/scripts/hound-arm.sh \
  'bash skills/work/scripts/work-result.sh .craft/0827-npx-iss/result.json' \
  --rounds 6 --minutes 480
```

with the cron prompt carrying: *on FAIL, read the surviving blocking findings, amend the plan,
re-dispatch — in that order, without asking.*

Would have bought: the four hours, plus the round-2 amendment the session had already written out
in full (promote `run3/converted/` rather than re-parse; declare the partitioned directory rather
than a single file).

### 2. `mail-bridge` — nothing armed at the moment of stopping

The previous hold had released when its run returned a verdict. The session finished a recon, wrote
"Writing the plan now", and ended the turn. 5h26m later a human typed `status` and got two
questions: push three green commits, and how far to take a fix already diagnosed to the line.

Rewrite — armed when the recon is dispatched, not after it lands:

```bash
bash skills/hound/scripts/hound-arm.sh \
  'bun test tests/ambiguous-settlement.test.ts' --rounds 4 --minutes 300
```

with the cron prompt carrying: *standing authority — commit and push green work, bump the patch
version, plan the next round yourself. A recon landing is not a stopping point: write the plan and
dispatch it in the same turn.*

That last sentence is the whole fix. The session did not lack information; it lacked an instruction
that the recon's arrival was a middle, not an end.

### 3. `npx-iss-reconcile` — the brief with a blocked-clause

Was, in `BRIEF.md`:

```
When done or blocked, notify the session that spawned you by running: herdr agent prompt ...
```

Rewrite:

```markdown
## Standing authority
Commit each green round on this branch. Do not push, do not switch branches. Choose the next defect
yourself and start it without asking.

## Terminal blockers — the complete list
WRDS credentials rejected; the grid unreachable; a change that would touch anything outside this
worktree. Nothing else. A fixture you cannot cut cleanly is the next task — widen the excerpt until
it reproduces, or build the fixture from the filing itself.

## When you finish the stated scope and budget remains
You have 15 rounds. Spend them. If the parser is clean, take the largest remaining measured defect
and fix it under the same gate. Report at the ceiling.
```

The session used 5 of 15 rounds, had scoped the next defect to 288 filings and 57,967 rows, and
stopped at 01:42 with five hours of night left.
