# Goal and brief templates, and the three rewrites

## The goal template

```
/goal <END STATE, with the number> — `<CHECK>` exits 0 — or <COUNTER> reads <N> or more —
`<how to read it>` it to check — or the run has been going <MINUTES> minutes or more, which
`<script>` prints and settles. <STANDING AUTHORITY>. <CONTINUATION>.
```

**Single-quote it on the command line.** The template is backticked, so double quotes hand every
`<CHECK>` to the shell to run before `goal-self-send.sh` sees the string — and the goal then
carries that command's output where its text should be, undetectably.

Filled in, for an unattended night:

```
/goal parse_status=error is under 1% of XML-era filings measured on the full corpus —
`bash skills/wrds/scripts/parse_npx/measure.sh --xml-error-rate` prints a rate below 0.01 and
exits 0 — or the rounds field in .craft/<run>/args.json reads 15 or more — `jq -r .rounds` it to
check — or the run has been going 480 minutes or more, which
`bash skills/craft/scripts/craft-elapsed.sh .craft/<run> 480` prints and settles. Standing
authority: commit at each green round, pick the next defect yourself, re-dispatch without asking.
When a round returns, take the next action rather than proposing it; the only terminal blockers are
a missing credential, a dead grid, or an action that would touch production.
```

Verify before setting it:

```bash
bun skills/goal-and-loop/scripts/goal-lint.ts "<that text>" --unattended
```

## The unattended-brief template

A brief given to a spawned agent is a goal with prose around it, and it fails the same ways. The
four sections below are the ones the failing briefs were missing.

```markdown
## What done looks like
<the number, with its denominator, that someone could dispute>

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

### 1. `npx-reconcile` — the milestone goal

Was:

```
/goal craft has returned a verdict for .planning/npx-iss-reconciliation.md
```

Closed on `overallPass=false`, 0 of 5 tasks implemented, 20 blocking findings. The session then
asked whether to amend and re-dispatch or read the findings first, and slept 4h10m.

Rewrite:

```
/goal craft has returned PASS for .planning/npx-iss-reconciliation.md —
`bash skills/craft/scripts/craft-result.sh .craft/0827-npx-iss/result.json` exits 0 — or the rounds
field in .craft/0827-npx-iss/args.json reads 6 or more — `jq -r .rounds` it to check — or the run
has been going 480 minutes or more, which `bash skills/craft/scripts/craft-elapsed.sh
.craft/0827-npx-iss 480` prints and settles. On FAIL: read the surviving blocking findings, amend
the plan, re-dispatch — in that order, without asking.
```

Would have bought: the four hours, plus the round-2 amendment the session had already written out
in full (promote `run3/converted/` rather than re-parse; declare the partitioned directory rather
than a single file).

### 2. `mail-bridge` — no goal at all at the moment of stopping

The previous goal had closed when its run returned a verdict. The session finished a recon, wrote
"Writing the plan now", and ended the turn. 5h26m later a human typed `status` and got two
questions: push three green commits, and how far to take a fix already diagnosed to the line.

Rewrite — set when the recon is dispatched, not after it lands:

```
/goal the six parked ambiguous operations are settled and no new 504 on an idempotent verb parks —
`bun test tests/ambiguous-settlement.test.ts` exits 0 — or the rounds field in
.craft/0828-ambiguous-settlement/args.json reads 4 or more — `jq -r .rounds` it to check — or the
run has been going 300 minutes or more, which `bash skills/craft/scripts/craft-elapsed.sh
.craft/0828-ambiguous-settlement 300` prints and settles. Standing authority: commit and push green
work, bump the patch version, and plan the next round yourself. Recon landing is not a stopping
point — write the plan and dispatch it in the same turn.
```

The last sentence is the whole fix. The session did not lack information; it lacked an instruction
that the recon's arrival was a middle, not an end.

### 3. `npx-iss-reconcile` — the brief with a blocked-clause

Was, in `BRIEF.md`:

```
When done or blocked, notify the session that spawned you by running: herdr agent prompt ...
```

Rewrite:

```
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

## What a conforming goal looks like when it is already right

`skills/craft/scripts/compose-goal.sh` emits one for every craft run and passes the lint clean. Its
header comment records why each clause is worded as it is — every one of them was added or removed
in response to a measured stall. Read it before inventing a new clause.
