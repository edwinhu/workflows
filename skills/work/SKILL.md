---
name: work
description: "Use when the user says \"work this\", \"run a work loop\", \"do this properly\", \"take this through clarify plan and verify\", \"run it through the gate\", \"/work\", or hands over a substantial change that has no domain workflow of its own and should be planned, approved and independently verified before it lands. NEGATIVE ROUTING: a code change or bug fix is /dev; a dataset, table, figure or number is /ds; long-form prose is /writing; a talk built from a research paper is /workshop; lecture notes or course slides are teaching:notes and teaching:slides; a skill, workflow or plugin in this repo is skill-creator, workflow-creator or plugin-creator. Each of those is this loop plus a domain gate, and work is only the fallback when none of them fits."
argument-hint: 'the task to run through the loop'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor, PushNotification]
---

# `work` — clarify → plan → goal → workflow → human review

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

A structured loop for tasks worth doing properly: clarify with the user, draft a plan they
edit and approve, self-set a goal, run `workflow.js` — dispatched through farm-out — to implement
and independently verify, then put the result in front of the human in tuicr. Human rejection
routes back to CLARIFY.

```
CLARIFY ─► PLAN ─► GOAL ─► workflow.js ──PASS──► HUMAN REVIEW (tuicr)
   ▲                           ▲    │              │
   └── human REJECT ────────────┼────┼──────────────┤
                               └─fix┘ FAIL        └─ findings → fix → re-run

work-round.sh (agents only where judgement is needed; every exit code is a script):
dispatch: red-before + red-suite hashes (work-dispatch.sh, no agent)
  ─► workflow.js AGENTS: IMPLEMENT waves ─► [VERIFY (no-acceptanceCmd tasks) ∥ RULE ∥ SCORED ∥ ATTEMPTS]
  ─► work-checks.sh: red-after ∥ acceptanceCmds ∥ mechanicalChecks ∥ red-suite re-hash
  ─► work-stage.mjs digest ─► ONE lens = one farm.sh --tasks row, kind review ─► workflow.js gate
                                 RED: diagnose and route; GREEN: open-ended pass
FAIL selectors: tasksThatFlagged + mechanicalThatFailed + rulesThatFailed + lensesThatFlagged + planFindings
```

No agent runs a command. The red probes, every `acceptanceCmd` (which replaces that task's verifier)
and every mechanical check are exit codes recorded by scripts; a red-suite file whose hash moved
between dispatch and the checks is a CRITICAL owned by the task whose `writablePaths` reach it, else
`plan`. The lens reads a digest — failures first with command, exit, tail and owner; green checks
marked settled and never re-run; a per-task `git diff --stat`; out-of-scope paths pre-flagged — and
runs as ONE `farm.sh --tasks` row of kind review on the routed provider and `lens.model`. RED means a
task flagged or a check failed: the lens diagnoses each failure into `routes`, naming its
owner task or `"plan"`. GREEN means those checks passed: the lens makes one open-ended pass. Both
modes rule on carried findings. Scored results are advisory; they do not choose the mode or decide
the gate. There is no refuter leg.

**Plan review is computed and happens before dispatch, not inside it** — `plan-lint.ts` over the
built args and `plan-preflight.ts` executing their commands at baseline, enforced by
`work-dispatch.sh` while the run is still armed. No agent reads the plan markdown for defects
(see *Plan review*).

Everything lives in this skill directory — `workflow.js`, `scripts/work-dispatch.sh` (Phase 3+4 in
one call), `scripts/work-pending.sh` (is a dispatch owed?), `scripts/compose-goal.sh` (the objective
and its ceiling), `scripts/human-review-gate.sh`, `scripts/work-result.sh`.
Nothing here depends on any plugin.

**The gate has a test suite; run it after touching `workflow.js`** — `node --check` proves only that
the file parses. `scripts/workflow-harness.mjs` executes the script for real against stubbed hooks,
and `scripts/workflow.test.ts` asserts the invariants that decide PASS/FAIL: fail-closed on every
dead agent, the three `redCommand` verdicts, `overallPass === false` implying a non-empty selector,
the `readOnly` n/a dimensions. `scripts/plan-review.test.ts` guards the computed plan-review rules
and the absence of the judged layer. Add both to `mechanicalChecks` on a run that edits the spine:

```bash
bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/   # absolute path: a bare relative path is
# read as a NAME FILTER and exits 1 having matched nothing — identical to a real failure
```

## State

Two locations, one owner each:

| Path | Holds | Owner |
|---|---|---|
| `<plansDirectory>/<slug>.md` | the approved plan — **the run's authority**, the file that gets hashed | plan mode (native); `work` only reads and hashes it |
| `.work/<run-id>/` | args, verdict JSON, and `plan-<hash12>.md` — the archived bytes each round ran under | `work` |

`plansDirectory` decides where that plan lives, and `work` **honours whatever it is set to** —
`"./.claude/plans"` and `"./.planning"` (what the domain workflows use) are
equally valid. The value is resolved relative to the project root, so the plan is project-local and
`work` hashes it in place — no copy. Unset at every tier, the default is `.claude/plans`. `run-id` is
a short date-slug like `0806-fix-auth`. Both `.work/` and the plans directory want to be
gitignored — add them before the
first run if the repo would otherwise track them. Clean up `.work/<run-id>/` when the run
completes, unless the user wants provenance kept; leave the plan file alone either way, it's plan
mode's. **The plan file is not durable and `work` does not own it** — plan mode memoizes one slug per
session, so re-entering plan mode overwrites the plan in place, and the directory is gitignored. So
dispatch archives the bytes it hashed to `.work/<run-id>/plan-<hash12>.md` (content-addressed: an
amended round adds one, never overwrites). That archive is the only copy of what a run was approved
with — if the plan matters beyond the run, `git add -f` it before cleaning the run dir. There is no `goal.md`: the plan holds the success criteria, and the goal is a
session-level condition (Phase 3), not a file.

## Phase 1 — CLARIFY

**Before any task reconnaissance**, AskUserQuestion on the axes that shape the plan (skip axes
the request already answers; batch up to 4 per call):

1. Desired outcome — what does done look like?
2. Exclusions — what must NOT change?
3. Constraints — style, deps, compatibility.
4. Observable success criteria — what command/check proves it? *A command with a meaningful
   exit code becomes a `mechanicalChecks` entry in the plan's Run sizing block.*
5. Review surface — working tree (default), commit range, or PR?
6. **Which provider runs the review lens?** — routed (default: `kinds.review` in `routing.json`) /
   claude / codex / gemini. *A non-routed answer sets `args.lensProvider`, which the dispatcher
   resolves through `route.ts` to that provider's review candidate. It cannot be combined with an
   explicit `lens.model` or `lensModel`.*
7. **Read-only runs only — use an agent team for discovery? (default yes.)** Ask this axis only
   when the run is an audit (`readOnly: true`); for a run that writes, the answer is always no and
   the axis is skipped. The honest tradeoff: a team of communicating auditors covers more **cross-file**
   surface than one lens reading alone, because its members can hand each other what they found. The
   cost is that a team's findings are **correlated**, so the adjudication — the lens ruling each claim
   `open|closed` with evidence — stays **outside** the team. Answering no is a real option; it costs
   discovery breadth, not gate integrity. For where the team runs and how its findings reach the gate,
   see *Where the agent team lives*.

Gate: you can plan without guessing. If answers surface a trivial task, say so and exit the
loop — see red flags.

## Phase 2 — PLAN

EnterPlanMode. Explore, then draft a plan that MUST contain:

- **Task table**: `(id, name, work, writable paths, acceptance)` — acceptance is a checkable
  criterion per task, not a vibe. Add **`dependsOn`** to any row whose refs or inputs are files
  another row writes: it is the only thing that orders IMPLEMENT, and rows without it are
  implemented concurrently (so their writable paths must be disjoint).
- **Every claim is a `tasks[].acceptance` clause or a `mechanicalChecks` entry**, plus the review
  surface. A criterion belonging to no task belongs nowhere: it is a sentence nothing runs, and it is
  the largest defect surface a plan has. Whole-deliverable facts become a mechanicalCheck; per-task
  facts become that task's acceptance. Prose may explain WHY, never assert WHAT — the moment prose
  states a criterion there are two representations of one fact, and they drift within one amendment.
  `plan-lint`'s `prose-command` rule enforces the executable half: a command in prose that no
  acceptance, redCommand or mechanicalCheck runs is a MAJOR.
- **Run sizing** — the scrutiny the gate will apply (Phase 4 documents what each knob costs):

  ```
  ## Run sizing
  Review lens:       <the dimensions the ONE lens judges — merge every named risk into that one prompt>
  Mechanical checks: <name> — `<exact command>`              (omit the section if none)
  Rule checks:       <name> — `<exact command>` blockAt <val> (opt-in, omit if none)
  Scored checks:     <key> — <what it scores>, ADVISORY: never gates  (opt-in, no default; omit if none)
  Test-first:        <task id> — `<redCommand>`               (one line per red-gated task; omit if none)
  Red dispositions:  <task id> — <why this task carries no red gate>  (one line per dispositioned task; omit if none)
  Lens provider:     <provider>                              (only when axis 6 is not routed)
  ```

Each active task costs 1 implementer, plus 1 verifier only if it has no `acceptanceCmd`. **The
review lens is exactly 1 agent**; it rules on both `carriedFindings` and external `priorFindings`
without additional agents. Red probes, `acceptanceCmd`s, mechanical checks and rule checks cost
**no** agent — scripts run them. Each scored item and attempt costs one agent. Above ~50, split the
plan into sequenced work runs. Four acceptanceCmd tasks: 4 implementers + 1 lens = 5 agents.

**This is enforced, not advised.** `workflow.js` computes the fan-out
(`activeTasks + tasksWithoutAcceptanceCmd + 1 (the lens) + scoredItems + attempts`;
task counts are zero under `readOnly` or `onlyTasks: []`)
at arg-validation and **throws before dispatching anything** if it exceeds `maxAgents` (default 50);
the error prints the per-dimension breakdown. Raising `maxAgents` is legitimate; raising it silently
at dispatch time is what the throw prevents, because sizing is the user's call at approval time.

**Sizing lives in the plan because it shapes the gate.** Rewriting the lens or dropping a mechanical
check after approval would weaken the verdict without changing a byte the user signed off on — the
hash covers the `work:dispatch` spec block, so anything that decides PASS/FAIL has to be inside it.

**An audit needs a plan too.** `readOnly` still requires `planPath` + `specHash`, and the plan it
hashes is a **charter**, not a work order: what is being audited, what the lens judges it against, which
mechanical checks run, and the standing instruction that nothing may be written. The task table may
be empty. Do **not** shortcut by hashing the artifact under audit instead: the AUTHORITY block tells
every agent the hashed file is its *only authority*, so hashing the audited file would tell each lens
that the thing it is judging is the standard it judges against.

**A domain workflow's plan opens with YAML frontmatter `workflow: <name>`** (`dev`, `ds`, `writing`,
`workshop`, or plugin-qualified like `teaching:notes`) — it is what the re-seeded `Implement the
following plan:` prompt shows first, and what routes that session back to the owning skill.

**Arm the run before calling ExitPlanMode.** The plan must carry a dispatch block — every
`workflow.js` arg except `planPath`/`specHash`, which `work-dispatch.sh` injects because a block
cannot state its own hash:

```
<!-- work:dispatch
{"runId": "0813-slug", "goalTurns": 12, "args": { … }}
-->
```

Writing it is what arms the run, and the plan is the only file plan mode may write — which is also
the only thing that survives approval. **Claude Code clears the context when a plan is approved near
the ceiling** and re-seeds a bare `Implement the following plan:` session with no `work` in it, which
will otherwise implement in the main thread. While a plan is armed and no `.work/*/args.json`
records its hash, `~/.claude/hooks/main-thread-guard.sh` denies Edit/Write/Agent in that project —
resolving the project from the nearest ancestor of `cwd`, so a `cd` cannot disarm it — and blocks the
turn from ending once; both name the dispatch command. It denies only what some task's
`writablePaths` covers (`work-dispatch.sh --covers`, failing closed when the spec cannot decide):
a path no implementer may write is not the run's output, which is what leaves the **red suite
authorable** here and nowhere else. For the one case that rule cannot reach — a path that IS a
task's output and must still exist before wave 1 — the plan declares `scaffoldPaths`, and
`work-dispatch.sh --scaffold` tells the guard to allow it. Without that list the only exit was
`--abandon`, which releases the guard for the **whole rest of the session** and silences the Stop
nudge along with it, so a plan defect became a disarmed run. A `readOnly` run never writes, so
there the Stop nudge is the only thing that fires. Derive the prose Run sizing block from the JSON;
`work-dispatch.sh` prints the fan-out it computes, so drift shows up before anything is dispatched.

The user edits the plan file and approves via ExitPlanMode. Then **hash the plan where plan mode
actually wrote it** — resolve the path, don't assume it:

```bash
# The configured location — plansDirectory, project-root-relative, default .claude/plans.
PLANS=$(jq -r '.plansDirectory // empty' .claude/settings.local.json .claude/settings.json \
  ~/.claude/settings.json 2>/dev/null | head -1); PLANS=${PLANS:-.claude/plans}
PLAN=$(ls -t "$PLANS"/*.md 2>/dev/null | head -1)
[ -n "$PLAN" ] || PLAN=$(ls -t ~/.claude/plans/*.md | head -1)   # fallback: a pre-setting session
bash ~/.claude/skills/workflows/skills/work/scripts/work-dispatch.sh --spec-hash "$PLAN"   # 64-hex spec hash
```

Whichever it resolves to is `planPath`. **Never copy the plan** — one file, hashed in place, is the
run's authority. A copy creates a second file that can drift from the one the user edits. (The run
dir's `plan-<hash12>.md` is not that: it is a dead snapshot named by its own hash, written by
dispatch and never read as authority, so nothing can edit it or drift from it.)

**Ensure `plansDirectory` is set.** Plans belong inside `projectDir`, alongside the work and the
agents. `plansDirectory` is [relative to the project
root](https://code.claude.com/docs/en/settings), so any project-relative value puts them there —
`"./.claude/plans"` and `"./.planning"` both work, and `work` resolves whichever is set:

```bash
rg -n '"plansDirectory"' .claude/settings.local.json .claude/settings.json ~/.claude/settings.json 2>/dev/null
```

If no tier sets it, add one — `"plansDirectory": "./.claude/plans"` is this skill's default,
`"./.planning"` is what the domain workflows use — to the project's
`.claude/settings.json`, and gitignore that directory. Setting it at the user tier covers every
project at once, which is usually what you want. Precedence is Claude Code's own:
`.claude/settings.local.json` beats `.claude/settings.json` beats `~/.claude/settings.json`.

**It takes effect next session, not this one.** Plan mode fixes the plan's path when you enter it, so
a session that started before the setting was live still writes to `~/.claude/plans/` — which is why
the snippet above resolves the real path instead of asserting one. Do not stop the run over it, and
do not copy the file to make the path look right.

The plan's `work:dispatch` spec block is the sole authority every dispatched agent gets; the prose
around it explains but never binds. Nothing re-derives it: the agents re-run `--spec-hash` themselves
and stop on mismatch, so an amended spec halts the run instead of silently changing the contract,
while fixing a typo in the rationale costs nothing.

## Phase 3 — THE HOLD

**The dispatch arms a hold ON THIS SESSION** — in the main chat, not in the farmed child, which
runs one `workflow.js` and exits. The hold is what carries the outer loop (gate FAIL → fix → re-run;
tuicr findings → fix → re-review): on every Stop it blocks while the goal is not met, and it survives a
run that dies.

| | |
|---|---|
| **`args.goalCheck`** (optional) | the ONE command that settles the whole plan. Armed as the hold's check. NEVER a round verdict — `plan-lint` runs it through `hold-lint.ts` and a CRITICAL blocks the dispatch |
| no `goalCheck` | the hold is **check-less**: the judge alone on `args.goal`, bounded by `maxRounds` and `compose-goal.sh --minutes` |
| `--run <run-dir>` | recorded by the arm. While the round is in flight a stop is ALLOWED and costs no round: a detached process is doing the work |

**Under the hold, a failed round advances with `work-redispatch.sh <plan> <run>/args.json --dispatch`,
never a fresh `work-dispatch.sh`** — the first re-runs only the tasks that flagged and their dependents
and carries the rest; the second re-runs every task, throwing away the round's verified work. The
hold's first counted block and its `--brief` say so with the paths filled in.

### The check command — the rules `hold-lint.ts` enforces

The check is the executable FLOOR; `args.goal` is the objective and the judge rules on it. Arm both
where both exist.

- **RED when armed, and able to run.** `work-hold.sh` refuses exit 0 (a hold on a passing check holds
  nothing) and exit above 1 (could-not-run is not a verdict, and would hold forever on a typo).
- **It names and prints the goal state** — a suite passing, a rate under a number, a count at zero —
  **never a milestone** (`test -f report.md` is true while the objective is unmet) and **never a round
  verdict** (`work-result.sh`, `result.json`: green on a FAIL the loop was going to fix, and it
  outlives an abandoned run).
- **One clause per claim**, so a failure names which half. **Runs in this session's own cwd** — a check
  whose paths live in another repo can only be released unmet. **Broad enough that one edit cannot
  close it.** **No apostrophes**: the check is one single-quoted argument.

`hold-lint.ts` settles the decidable part of that on the check and the goal text both; `plan-lint`
runs it one dispatch before the arm, and a CRITICAL blocks. `--probe` also RUNS the check twice —
two runs that disagree is an instrument, not a gate — and prices it, since the hook runs it on every Stop.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/hold-lint.ts '<CHECK>' --goal '<OBJECTIVE>' [--probe]
```

### Arming by hand, when no dispatch is doing it

A session that is not dispatching — an overnight hunt, a spawned agent's caller, a `visual-verify`
loop — arms the same hold itself:

```bash
A=${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-hold.sh
bash $A '<CHECK>' --goal '<OBJECTIVE>' --rounds 4 --minutes 120
bash $A --goal '<OBJECTIVE>'    # CHECK-LESS: the judge alone, and an UNAVAILABLE judge BLOCKS
bash $A --status                # armed? check, run, rounds used, minutes left, recent exits, ledger
bash $A --disarm                # THE USER releases it: a tty prompt, or the permissions.ask prompt
```

Defaults are 4 rounds and 120 minutes; above either, the arm prints the per-wake context cost and the
equivalent `grind` command, then arms. Arming caps this session's auto-compact window at 250000
through `.claude/settings.local.json`, and every release restores it (`WORK_HOLD_COMPACT_WINDOW=0`
opts out). Templates for the check, the nudge and an unattended brief:
[`references/hold-templates.md`](${CLAUDE_PLUGIN_ROOT}/skills/work/references/hold-templates.md).

**Release is not the session's to take.** Three layers, none sufficient alone:

| layer | reaches | the residual hole |
|---|---|---|
| `--disarm` — the tty prompt when there is a terminal, otherwise the `permissions.ask` rule `Bash(*work-hold.sh --disarm*)`, which prompts on phone and Remote Control too and records the verb `released by user (permission prompt)` | a human, wherever they are | the ask rule matches the command text AS WRITTEN, so a variable-indirected call slips past it — a tripwire, not a lock |
| the hook restoring a state file deleted without a sanctioned release | a `rm` instead of an argument | the ledger must be readable |
| `permissions.ask` on `*work-hold-*.json*` / `*work-hold-*.releases.log*` | an edit in place | same text-matching hole |

The honest move for a gate you think is wrong is to arm the right one, not to stop.

**A hold frozen at rounds 0 that never releases is usually version skew, not a stuck check.**
`--status` reports `never evaluated since arm Nm ago` when no Stop has reached `hooks/work-hold.ts`
since the arm — the session's Stop registration points somewhere else. `/reload-plugins`. Until then
`cron-delete-guard.ts` keeps refusing the heartbeat deletes, and says the same thing in its refusal.

**Done means the goal is met, not that the check is green.** The hold releases `passed-goal-met` only
when the judge agreed; `passed-unjudged` (no goal, or the judge was unreachable with a check to fall
back on) means nobody confirmed the objective — say so rather than reporting it as done, and leave any
heartbeat cron alive.

**The continuation rule, which the arm states on the first counted block and in `--brief`: when a
sub-run returns and the check still fails, TAKE the next action — do not propose it.** Every measured
stall happened at a moment of legitimate completion, which is the moment with the most information the
session will ever have. Two branches open: pick one, say why in a line, do it. The arm states the
standing authority with it — what the session may decide alone, unasked — because every decision left
open becomes a question asked into an empty room.

A round verdict is not the hold's business in either direction — it goes green on a FAIL the loop was
going to fix, and it outlives a run the user abandons (AGK 2026-09-27). For a long loop whose target is
a computable command and needs no session, use grind instead.

**`work-dispatch.sh` does Phase 3 and Phase 4 in one call** — it reads the armed plan's dispatch
block, injects `planPath`/`specHash`, writes `args.json`, starts `workflow.js` detached and arms the
hold. Run it, then skip to the Monitor; the rest of these two phases is what it does and why,
and what to check when it reports something odd:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-dispatch.sh                    # armed plan; or pass one
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-dispatch.sh --provider codex   # "run work through codex"
```

**The provider comes from the invocation, and every skill that wraps `work` forwards it.** A provider
named in `$ARGUMENTS`, however it is spelled — `--provider codex`, `--dispatch codex`, "run this on
gpt" — is `--provider codex` on the dispatch line, whether `work` was invoked directly or through `/dev`,
`/ds`, `/writing`, `/notes`, `/slides` or `/exams`. Those skills print their own dispatch recipe, so
each carries the flag too; dropping it silently routes the run by kind instead of on the named provider.
`--provider` is the ONE spelling: `work-dispatch.sh --dispatch` and `work-redispatch.sh --dispatch
codex` each exit 2 naming it, rather than dying on "unknown flag" or accepting a synonym.

**With no `--provider`, each step routes by kind through `scripts/lib/routing.json`.** Before
`args.json` is written the dispatcher calls `route.ts --row` once per kind and injects the kind map
as `args.routing` (`kindModels`, `source`, per-kind `decisions`); the claude wrapper hosts the run and
`workflow.js` gives each step its kind's full model id — an implementer `judgement` or its task's
`kind`, the verifier and every probe `script`, the lens `review`. An explicit model arg still wins
(the model rows below). A `route.ts` refusal for any kind blocks the dispatch before anything runs.
**`--provider claude|codex|gemini` is the whole-run override**: that wrapper hosts every step,
`route.ts` is not consulted, `args.routing` is `{source: 'flag', provider}`, and the wrapper remaps
the tier names so every `'sonnet'` default follows — bar a `lensProvider` plan, whose review row is
the one `route.ts` call, recorded as `args.routing.lens` with its model in `args.lens.model`.
`work-redispatch.sh` takes the same flag and re-resolves `args.routing` every round, so a refreshed
table takes effect next round, and when a round repeats its predecessor's failure exactly, a different
provider is the lever for framing lock-in — `lensProvider` on the judge side
(`references/convergence.md`). Design: `docs/DESIGN-routing.md`.

It needs nothing from the session's context, which is the point: a run whose context was cleared at
plan approval is recovered by this one command, with no re-exploration.

**The plan-review gates run before `args.json` is written, exiting 3 with the run still armed and
every artifact byte-identical.** Tier 1 is `plan-lint.ts` on the built args. The two probe gates
execute disjoint command sets, each command exactly once: tier 2 runs active tasks' `redCommand`s
unless they carry proven `red-green` adjudications for that exact current command. Its classifier
refuses `red-not-red` (exit 0 — the gate already passes) and `could-not-run` (exit 127, a missing runner,
`pytest` exit 4/5, or no test output at
all), so only non-zero *with* a real test result proceeds; **tier 2b runs every `mechanicalChecks`
cmd** at baseline via `plan-preflight.ts --only mechanical`, where only a `critical` refuses.
Acceptance commands are `plan-preflight`'s third probe kind and **no dispatch gate runs them** — run
`--only acceptance` by hand on a quiet tree, before arming.
`--no-red-probe` drops tier 2, `--no-mech-probe` drops tier 2b, `--no-lint` drops all of them, and
`WORK_RED_PROBE_TIMEOUT` / `WORK_MECH_PROBE_TIMEOUT` (300s each) bound their own tier's commands.
A task whose work is already COMPLETE can satisfy neither gate —
a `redCommand` is refused `red-not-red`, omitting it is refused `redcommand-missing` — so it declares
`redDisposition` instead; both scripts echo `red: N gated, M dispositioned` with each disposition,
beside the wave graph.

### What WAKES the session, once it has gone quiet

A Stop hook reaches nothing when no turn is running, so the hold alone cannot restart a session that
has gone quiet. The **watcher mod** (`hooks/register.ts`) does: it reads
`$TMPDIR/farm-events/$CLAUDE_CODE_SESSION_ID`, where `work-round.sh`, `work-loop.sh` and their
`farm.sh` file themselves, shows the round and phase in the status line, and wakes the main chat ONCE
on the loop's exit (the round's verdict when no loop runs) and on a run that dies without one.
`/farm` prints the table.

**Nothing wakes a session that is not running.** A run that finishes while no session is open is
reported when the session next starts, and on 2026-09-27 a restarted loop sat at 23:14 with nothing
to wake. So the cron is the **backstop, on by default**: the dispatch
prints an hourly `CronCreate` call (`WORK_LOOP_INTERVAL_MINUTES` sets the period) whose prompt is a
nudge (`and? (work run <runid>)`) — a few words, and a tick mid-round is allowed through uncounted by
the hold, so it is cheap. **Make that call before your next action and report the job id**; `CronList`
is the only thing that proves it exists. `--no-cron` opts out, and then the dispatch says in one line
that the watcher mod is the only wake.

Nothing is typed into this session and nothing is queued, so there is no send to verify, no transport
to fall back to, and no ordering constraint against Phase 4.

**`work-result.sh` is the round's verdict, and only the round's.** Exit 0 is PASS, 1 is FAIL, 2 is
could-not-run; a `readOnly` run closes on either verdict, because an audit's gate legitimately FAILs.
The escapes the objective states — the round counter and the wall clock — are read from `args.json`
and `work-elapsed.sh`.

**If the USER abandons the run**, retire it with
`bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-abandon.sh <run-dir> --why '<reason>'`: it writes
the run's verdict (`overallPass=false, abandoned=true`), releases the hold, and allows the `CronDelete`
a `cron-delete-guard` deny would otherwise refuse. It is the only sanctioned way out of an armed hold
short of the user confirming `work-hold.sh --disarm` at a terminal.

**Name the plan by PATH, never by a fixed sha256.** A pinned digest self-invalidates the first time
the FAIL loop does what this file prescribes: fix, **amend the plan, re-hash**, re-dispatch. The run
then PASSes against a hash the condition does not name, and the evaluator correctly reports the goal
unmet on finished work. The path is stable; the hash is the thing the loop is expected to change.

**Write `args.goalCheck` so a COMMAND settles the PLAN, not the round.** Nothing reads the
conversation to decide whether the work is done, and `work-result.sh` settles one round only. A plan
that has no such command states none and gets the judge-only hold; what it must not state is a check
reading `result.json`, which `plan-lint` blocks.

Phase 4 dispatches **in the same turn** — `work-dispatch.sh` does both, so there is nothing to
sequence and no queued message to wait out.

## Phase 4 — workflow.js

The args, annotated — write them to the args file as **plain JSON**, no comments, since the workflow
`JSON.parse`s it:

This fence is `work`'s ARGUMENT SCHEMA, not a workflow declaring its own gate.
`mechanicalChecks: [{name, cmd}, ...]` documents the parameter `work` ACCEPTS; `work` is the
engine that RUNS a workflow's checks and has none of its own to collapse, so P10 — which
governs what a generated workflow declares — is declared away for this region only:

<!-- wc-probe: ignore-entry-point:start -->
```js
{
  projectDir, planPath: "<the path $PLAN resolved to in Phase 2>", specHash: "<64-hex>",
  goal: "<one sentence>",
  tasks: [{id, name, work, writablePaths, acceptance, refs, redCommand|redDisposition}, ...], // from the plan's task table
  lensProvider: "codex",           // ONLY if CLARIFY axis 6 named a provider; else omit (routed)
  mechanicalChecks: [{name: "node-check", cmd: "node --check foo.js"}, ...],  // optional
  scoredChecks: [{key, items, prompt, schema, components, passthrough, refs, agentType}, ...], // optional; advisory, never gates
  lens: {prompt: "<what the ONE review judges>", refs: [], agentType: "Explore",
         effort: "high"},                     // optional; ONE object; a `model` here pins it over the kind map
  attempts: [{key: "a1", prompt: "<task for the blind probe>", refs: [], agentType: "Explore"}], // optional
  authorityExtra: "<domain rule appended to every agent's AUTHORITY block>",  // optional
  implementerAgentType: "…", verifierAgentType: "Explore",        // optional
  readOnly: true,                                                 // optional; audit an existing tree
  priorFindings: [{id, title, severity, detail, file, ownerTask}, ...],  // optional; claims made OUTSIDE this run
  carriedFindings: [...same shape...], taskFixes: {"<taskId>": [...]},   // derived by work-redispatch.sh
  onlyTasks: ["<taskId>"], priorResults: {implemented: [], verified: [], red: []}, // derived re-run scope
  // onlyTasks: [] is a zero-implementer round only when every task has carried records
  freezeFindingSet: true, maxRounds: 6,                           // freeze is derived; cap defaults to 6
  maxAgents: 50,                                                  // optional; fan-out ceiling — throws if the floor exceeds it
  implementerEffort: "xhigh", verifierEffort: "medium",           // optional; null omits the key and inherits
  scoredEffort: "low",                                            // optional; null omits the key and inherits
}
```
<!-- wc-probe: ignore-entry-point:end -->

**Dispatch through farm-out, never the built-in `Workflow` tool** — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies it unconditionally, so an in-session call is
dead. `farm.sh` sets `FARM_OUT_CHILD=1`, which is what lets its child make the call.
`work-dispatch.sh` runs exactly this and prints the wait loop with the run's paths filled in; what
follows is what it does, for when you are reading its output or a dispatch has gone wrong.

```bash
R=.work/<run-id>; mkdir -p "$R"          # the runner refuses if --out's directory does not exist
# write the args object above to "$R/args.json" as JSON
# DETACHED, never foreground: a real gate runs 20-60 min and a foreground tool call caps out
# and kills it mid-run, as does a harness-tracked background task.
setsid nohup bash ${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts/farm.sh \
  --workflow ${CLAUDE_PLUGIN_ROOT}/skills/work/workflow.js \
  --args "$PWD/$R/args.json" --out "$PWD/$R/result.json" --cwd "$PWD" \
  > "$R/run.log" 2>&1 < /dev/null &
# Wait for it: work-result.sh is one-shot and knows nothing about the dispatch. Watch BOTH the
# artifact and the process — a watcher that only greps for success is silent through a crash — and
# key liveness on THIS run's --out path, or a concurrent dispatch reads as proof ours is alive.
# farm-alive.sh keys on the RUN, not the runner's filename: the runner's event file carries
# out=<this run's --out> and its filename is the pid, so a rename cannot break the check.
while :; do
  [ -s "$PWD/$R/result.json" ] && break
  bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/farm-alive.sh "$PWD/$R/result.json" > /dev/null \
    || { echo "dispatch died with no verdict — see $R/run.log" >&2; exit 1; }
  sleep 30
done
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-result.sh "$PWD/$R/result.json"
```

`--loops N` launches `work-loop.sh` detached to execute that wait and drive redispatch, recording
its exit code in `<run-dir>/loop.exit`. It checks liveness, adjudicates each verdict and consults
`converge-check.ts` each round, up to N rounds. N defaults to the args `maxRounds` value, or 6 when
absent; a non-numeric value is refused with exit 2 naming the flag. `--loops 0` prints the wait loop
instead and exits 0.

The driver's exit codes: **0** PASS; **exit 1** the dispatch died with no verdict (see the run log it
names); **exit 2** `work-result.sh` refused the verdict; **exit 5** `converge-check.ts` reported NOT
CONVERGING, which is evidence about the BRIEF — re-plan rather than spend the remaining rounds;
**exit 6** the round cap was reached; **exit 7** a plan defect needs a scope decision, which is a
human's to make.

**Run that wait as a `Monitor`, not a foreground Bash call** — Bash caps at 10 minutes and a gate
runs 20-60. Pass the loop body as Monitor's `command` with `persistent: true` (no deadline), keeping
both terminal states: result written, and process gone without one. Then call `work-result.sh` when
it fires. Fall back to the loop across turns only where Monitor is unavailable — Bedrock, Vertex,
Foundry, or `DISABLE_TELEMETRY`/`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set. A Monitor dies with
the session; the detached run does not, and the hold is a file, so the hold is what survives a restart.

**When `work-result.sh` returns the verdict, send a `PushNotification` carrying the OUTCOME** —
"elide gate PASS, 33pp, both readings", never "the run finished". A run is a deliverable and takes
up to an hour, so the user has probably walked away; a notification that only reports completion
makes them come back to ask what happened, which is the thing it was supposed to save them. Here
only — not at dispatch, not at round boundaries.

`farm.sh` exits 2 on a malformed call (`--workflow` without `--out`, an `--args` file that is not
readable JSON) and non-zero when `--out` came back missing or not a JSON object. `work-result.sh`
then refuses (exit 2) unless the file is one object carrying `overallPass`, `verdict`, `scoreTable`,
`findings`, `tasksThatFlagged`, `mechanicalThatFailed` and `lensesThatFlagged` with the right types,
and prints the verdict and the score table on success. Those four selectors are REQUIRED: a return
dropping one channel would make a FAIL carried solely by that channel read as a clean run. `routes`
and `planFindings` are **optional and type-checked when present**, so an older verdict on disk still
reads — but a FAIL with a non-empty `planFindings` is the one a re-dispatch cannot close, so consume
it too.

**State the residual plainly: mechanical claims are adjudicated, the rest is shape, not fidelity.**
A model transcribes the workflow's returned object into `--out`, so a fabricated object with the
right keys — outside the re-run mechanical claims — passes both checks. Reconcile the score table
against the plan's Run sizing: counts that cannot be squared with what the run was sized to dispatch
make the result unverified, not a PASS.

| param | type | effect |
|---|---|---|
| `goalCheck` | `string` (optional) | The ONE command that settles the whole PLAN — not a round. `workflow.js` never reads it; `work-dispatch.sh` arms the hold on it, so it is a specification and is linted as one: `plan-lint` runs it through `hold-lint.ts` and a CRITICAL (a round verdict, an apostrophe, milestone phrasing, a human-closed clause) BLOCKS the dispatch, one step before the arm. Omit it when the plan has no such command and the hold becomes the judge alone on `goal`; a declared-but-empty string is refused rather than read as absent. |
| `readOnly` | `boolean` (default `false`) | Audit mode: no Implement phase, red probes or per-task verifiers; `tasks[]` may be empty/absent. Mechanical checks (scripted) and scored legs still run, then the lens. Review/probe legs default to `Explore` unless a supported agent-type override is set. No Edit/Write does not remove Bash: commands, refs and caller prompts must themselves be read-only. Task score dimensions are n/a (`null`), not checked-and-clean. The static five-entry `meta.phases` literal remains unchanged, but Implement is never opened. Both audit verdicts go to human review, not the fix loop. |
| `priorFindings` | `[{id?, title, severity, detail, file?, ownerTask?}]` | External claims, such as discovery-team or human findings. Merged with `carriedFindings` for the lens to rule `open｜closed` with evidence; open `critical｜major` claims gate even under the freeze. Missing rulings, empty closure evidence or a dead lens leave claims open. Required: title, detail and severity `critical｜major｜minor`. Missing ids are minted; duplicate ids across both inputs throw. Prefer a stable id and `ownerTask`; put line numbers in `line`, not `file`. Redispatch preserves this external-claims input rather than overwriting it with the run's carry. No additional agents. |
| `mechanicalChecks` | `[{name: string, cmd: string}]` | Run by `work-checks.sh` after the agents return, in parallel, `cmd` **verbatim** in `projectDir`, recording `{name, exitCode, output}`; **the JS reads the exit code** — no agent runs or asserts one, and none is dispatched. Fail closed: a command that cannot run (timeout, cannot spawn, exit 126/127) or is never reported is `exitCode: -1`, which counts as failed. Missing `name` or `cmd` throws. **The recorded exit code is still a claim once transcribed into `result.json`, and the claim is adjudicated in a shell**: work-result.sh re-runs EVERY declared check — a claimed failure included, since the file is a model's transcription of the gate object — and refuses (exit 2) when the observed exit code disagrees, or when a claimed non-zero exit sits beside `overallPass: true`. The refusal names **which direction** the disagreement went, because they mean opposite things: a claimed FAILURE that passes on re-run is a flake — re-run the gate, do not re-plan — while a claimed PASS that fails on re-run is the case the adjudicator exists for. Both still exit 2; passing a non-reproducing failure would wave a genuinely flaky gate through. Re-running one command to confirm a claim is cheap and re-running N is not — which is why a workflow declares **one** mechanical entry point whose exit code is its whole mechanical verdict, never a list of commands (a list also drops a check silently, and nothing reports a check it never knew about). **A check's `cmd` must finish inside ~10 minutes, because it is run TWICE**: `work-checks.sh` runs it (`WORK_CHECK_TIMEOUT`, default 1800s) and `work-result.sh` re-runs it to adjudicate the claim, capped near 10 minutes. A check that outlives that returns 124/137/143 — a kill, not an exit — which scored as a *failing gate* until work-result.sh learned to refuse it. Anything genuinely long (a scale run, a soak) goes **behind** the gate, not inside it: run it detached (`run_in_background`, or a `Monitor` when you want per-event notice) writing an artifact, and let `cmd` be the fast read of that artifact. **`overallPass` in `result.json` is NOT the verdict and must never be read directly, without exception** — the verdict is `work-result.sh`'s exit code (0 pass, 1 fail, 2 refused), and any caller that reads the file another way is a defect. |
| `scoredChecks` | `[{key, items, prompt, schema, components, refs, agentType?}]` (default off) | Weighted 0–10 scores, one agent per `items` entry, running in parallel with Verify. **The agent returns RAW COUNTS and `work` computes every score in JS** from the caller-declared `components`, so no agent ever sees the formula it is scored by — an agent that reports its own score inflates it. **It is advisory and structurally cannot gate**: `overallPass` is computed without reading any scored value, there is no threshold and no `blockBelow`, it adds no selector channel, and even a dead agent does not flip the verdict. An unmeasured, dead or partially-reported item scores `null` with a reason — never `base`, never `0`. Absent or `[]` opens no phase and dispatches nothing, and the return then carries `scores: []` with `scoresRun`/`scoresReported` as `null` (n/a — render it as such, never `0`). A schema key that is not a declared count, a score-shaped name, or a `penalties` key the schema does not declare all throw at arg-validation, before any dispatch. **`passthrough: [<field>, …]`** declares the evidence a score never reads — the numeric denominators a finding is stated against and the item lists it is built from — which a count-only whitelist cannot express; it stays a whitelist (an undeclared field is still refused, a field cannot be both a penalty and passthrough, and the score-shaped-name check applies to it too). Declared fields come back on that item's entry under **`evidence`** — nested, so nothing can collide with a component name; absent entirely when none was declared or reported; present on a `null`-scored item and never on a dead agent. Each item counts against `maxAgents`. Contract, arithmetic and worked example: [`references/scored-checks.md`](${CLAUDE_PLUGIN_ROOT}/skills/work/references/scored-checks.md). |
| `tasks[].redCommand` | `string` (optional) | Test-first gate that is **executed**, never asserted: `work-dispatch.sh` runs the string verbatim before launch and records it in `args.redBefore` — the JS requires a **non-zero** exit — and `work-checks.sh` runs it after the implementers, where the JS requires **zero**. No agent runs either side. A before-run exiting 0 is **reported at dispatch, not refused**, and the gate scores it `red-not-red`; a command that cannot run still refuses dispatch (exit 3). Every existing file a `redCommand` names is hashed into `args.redSuiteHashes` (plus `args.redSuite`); a hash that moved by check time is a CRITICAL owned by the task whose `writablePaths` reach the file, else `plan`. Three failure verdicts, each fails the task and puts its id in `tasksThatFlagged`: `red-unproven` (a side was never recorded or could not run, `exitCode: -1`), `red-not-red` (exit 0 before, so the test proves nothing), `green-not-green` (non-zero after). Must be **one invocation** — the shell operators `` ; & \| ` $ > < ( ) { } `` and newlines throw at arg-validation, because the string runs with the dispatcher's authority and a shell program can fabricate RED; flags and quotes are fine, a multi-step check goes in a script you name. Costs no agent. When `priorResults.red` carries `verdict: 'red-green'` for the same task id **and** `record.command === task.redCommand`, neither side runs. Changed or missing command records are dropped, so the current command must be probed anew. Nothing runs under `readOnly`. `scoreTable` then carries `redGated`, `redProven`, `redUnproven`, `redNotRed`, `greenNotGreen`, and the return carries `red` — feed it back as `priorResults.red` so a carried task keeps its adjudication instead of re-reading as unproven. It does **not** close everything: the command loads code the implementer may control, so keep `writablePaths` narrow. Absent leaves every existing caller byte-identical. |
| `tasks[].acceptanceCmd` | `string` (optional) | The command whose exit code **is** this task's acceptance. `work-checks.sh` runs it after the implementers; 0 passes, anything else (or -1, could not run) fails the task into `tasksThatFlagged`, recorded in the verifier's shape so carry-forward and the digest are unchanged. A task carrying one gets **no verifier agent**. Its `acceptance` prose is still listed in the digest only when no command checks it. Empty or non-string throws. |
| `redSuite` | `string[]` (optional; set by `work-dispatch.sh`) | Extra files hashed with every file a `redCommand` names into `redSuiteHashes` at dispatch. `work-checks.sh` re-hashes them; a moved hash is a CRITICAL `[Red suite modified]` finding owned by the task whose `writablePaths` cover the file, else `plan` — an implementer that weakens the test it is graded by fails the round. `redBefore` (`{id: {exitCode, output}}`) and `redSuiteHashes` are dispatcher-written; never author them in a plan. |
| `tasks[].redDisposition` | `string` (optional) | The filed reason a task carries **no** red gate — for work already complete, where any `redCommand` would be refused `red-not-red`. plan-lint accepts it INSTEAD of `redCommand` (both declared is `red-both-declared`, MAJOR; neither is `redcommand-missing`, MAJOR; empty/whitespace reads as absent), and dispatch echoes it verbatim. **Its content is never validated** — non-empty is the whole check; grading prose is the non-terminating shape. Inert to workflow.js: no probe, no agent, no score field. |
| `scaffoldPaths` | `string[]` (optional) | Paths the plan authors **before** the dispatch, even though a task also writes them. Read only by `main-thread-guard.sh` via `work-dispatch.sh --scaffold` (0 declared, 1 not, 2 undecidable → the guard fails closed); it changes nothing about how implementers run, and `writablePaths` still governs who may write what during the run. Exists for the greenfield red gate: a `redCommand` on a surface that does not exist yet fails to import, which is `could-not-run`, so a stub has to be on disk before wave 1 — and a stub is the implementer's output, so `--covers` alone can only deny it. Keep it to the specific file: a scaffold covering a task's whole writable surface is `scaffold-swallows-task` (major) at plan-lint. Absent leaves every existing caller byte-identical. |
| `tasks[].dependsOn` | `string[]` (task ids, optional) | A **read ordering**: declare it when this task's `refs`, tests or inputs are files another task writes. IMPLEMENT then runs in waves — concurrent within a wave, waves in order. **Absent everywhere leaves every existing caller byte-identical**: one wave, `tasks[]` order. Refused at arg-validation, before any dispatch: a non-array or self-referencing value, an **unknown id** (a typo would silently drop the ordering it was written to enforce), a **cycle** (named with every id in it — a cycle means two tasks each need the other's output), and a wave whose tasks claim **overlapping `writablePaths`** (prefix-aware). An edge to a task outside `onlyTasks` is **satisfied, not unschedulable** — a prior run implemented it and its output is on disk, so refusing it would make every scoped re-run impossible. A `redCommand` still brackets its own implementer inside a wave, never a sibling's. |
| `tasks[].refs` | `string[]` (absolute paths) | Files the implementer must Read in full before working. Absent or `[]` injects nothing into the prompt. |
| `lens.refs` | `string[]` (absolute paths) | The rules the lens judges against. **It is told to read them IN FULL** — it is the only reader of them, so a ref it skips is a rule nothing applied. Absent or `[]` injects nothing. Keep the set to what the judgement actually needs: one agent pays for all of it, and distilling a ref into a summary copy is the drift `spine-fidelity` exists to catch. |
| `maxAgents` | `number` (default `50`) | Hard ceiling on the fan-out floor, checked at arg-validation. **Throws before any agent is dispatched**; the error names each dimension's count. Raise it deliberately, in the plan — see the sizing note above. |
| `lens` | `{prompt?, refs?, agentType?, model?, effort?}` | One object, ONE agent: a single `farm.sh --tasks` row of kind `review`, run by `work-round.sh` after the agents and the scripted checks. `agentType` becomes the row's `agent`, `model` its `model`; the provider is the routed lens provider, so `route.ts` is not re-asked. The prompt is the digest (`work-stage.mjs`: failures first with command, exit code, last 60 output lines and owner; green checks marked settled with "never re-run settled checks"; a per-task `git diff --stat` over its `writablePaths`; changed paths no task covers pre-flagged; acceptance clauses and criteria no command checks), then the lens prompt and refs. Carried findings ride along. Absent or blank prompt uses correctness, spec fidelity, tests and methodology; review cannot be disabled. Model: see `lensModel` below (`kindModels.review` when routed, else `'sonnet'`); `lensProvider` moves it to another provider. Effort defaults to `'high'`; null effort inherits. JS selects RED for task/mechanical failures: return `routes[] {failure, ownerTask, cause, fix}`, no fresh findings. GREEN: return `findings[] {title, severity, file, line?, detail, ownerTask}`, no routes. Severity is `critical｜major｜minor`; owner is a task id or `"plan"`. Both modes return `carried[] {id, status: open｜closed, evidence}`. Lines belong in `line`, not `file`. Satisfied checks belong in `dispositions`, reported but never gated; `defect: false` and explicit non-defect labels are routed there as a backstop. A dead lens synthesizes a gating critical and leaves all carried claims open. Arrays and the retired array argument are refused. |
| `attempts` | `[{key, prompt, refs, agentType? default Explore, model?, effort?}]` | Parallel, blind probe agents. Each returns `{key, answer}` without writing to disk, and their results are passed to the lens; the return and scoreTable carry attempts `[{key, reported}]`. An attempt is BLIND: it gets only its own prompt and its own refs, not the task context or the full plan. A dead, thrown or empty attempt yields a synthesized critical finding (`deadAttemptFinding`) that gates even under `freezeFindingSet`. Counted in the fan-out formula. |
| `carriedFindings` | `[{id?, title, severity, detail, file?, ownerTask?}]` | The run's own carry, derived by `work-redispatch.sh --dispatch` from previous blocking findings plus existing carry, minus evidenced closures. Existing ids are preserved; missing ids are derived from `(lens, title, file)`. External claims stay in `priorFindings`, not duplicated here. The lens rules the merged pool; `carriedSubmitted` and `carriedOpen` count it. No additional agents. |
| `probeModel` | `string｜null` (default `args.routing.kindModels.script`, else `'sonnet'`) | Model for the count-reporting legs — `scored:*`. They report counts the JS turns into a verdict, so there is no judgement to downgrade. (Red probes, mechanical checks and rule checks are scripts now and use no model.) Order: a non-empty string here, then `args.routing.kindModels.script` (the dispatcher's kind map), then `'sonnet'`; `null` falls through to the map and inherits the session model only when there is none (a `--provider` run). Which model probes should run on is the `script` kind in `scripts/lib/routing.json`, not advice here: change the reviewed table, never pin `probeModel` in a plan to follow a recommendation. |
| `verifierModel` | `string｜null` (default `args.routing.kindModels.script`, else `'sonnet'`) | Model for `verify:*`. A verifier judges ONE task against ONE stated acceptance criterion, with both the criterion and the evidence handed to it — bounded, and one per task. Same order as `probeModel`: `null` falls through to the kind map and inherits only without one. |
| `implementerModel` / `lensModel` | `string｜null` (default `null`) | An implementer takes a non-empty `implementerModel`, then `args.routing.kindModels[task.kind ?? 'judgement']`, else inherits; `task.kind` must be `script｜judgement｜review｜bulk`, or the run throws before any agent. The lens takes `lens.model`, then `lensModel`, then `kindModels.review`; with no kind map, omitting `lens.model` uses `'sonnet'` even when `lensModel` is set, and `lensModel` only fills a `lens.model` of null. Declare model changes in the plan. |
| `taskFixes` | `{"<taskId>": [finding｜route｜string, …]}` | Redispatch groups the previous verdict's routes and blocking findings by valid `ownerTask`, replacing stale fixes even on FULL rounds. Each task's implementer sees them under `FIX FIRST (from last round's review):`, with title/failure, location, detail/cause/fix. Unknown task ids or non-array values throw. |
| `implementerEffort` | `string｜null` (default `'xhigh'`) | Reasoning effort for `implement:*`. Implementers write the artifact the whole gate then judges, and `xhigh` is the documented level for long-horizon agentic coding. Pass `null` to omit the key and inherit the session default. |
| `verifierEffort` | `string｜null` (default `'medium'`) | Reasoning effort for `verify:*`. A verifier judges ONE task against ONE criterion with the evidence handed to it — bounded. Pass `null` to omit the key and inherit. |
| `scoredEffort` | `string｜null` (default `'low'`) | Reasoning effort for `scored:*`. The scored leg reports **count fields** and the JS computes the composite, so it has no judgement to downgrade. Pass `null` to omit the key and inherit. Red probes and mechanical checks are scripts and have no effort; there is deliberately no global `lensEffort` — the lens sets `effort` on its own object (default `'high'`) or inherits. |
| `authorityExtra` | `string` | Appended to the `AUTHORITY` block every dispatched agent receives — implementers, verifiers, the lens. Absent leaves `AUTHORITY` byte-identical. |
| `implementerAgentType` / `verifierAgentType` / `lens.agentType` | `string` | Passed through as `agentType`. Use to pin a structurally read-only agent (`Explore` has no Edit/Write) for judges instead of trusting a prompt that says "modify nothing". Absent passes no key at all, so the dispatcher default applies. |
| `lensProvider` | `"claude"｜"codex"｜"gemini"` (optional; absent = routed) | CLARIFY axis 6: the provider that runs the review lens. The dispatchers read it, not `workflow.js`: the review row they send `route.ts` carries `provider`, which takes that provider's first available candidate in `kinds.review`'s chain into `kindModels.review`. Under `--provider` that row is the one `route.ts` call and its model lands in `args.lens.model`, since the normalised lens's `'sonnet'` default would beat `lensModel`. Refused before anything launches — a value outside the three, an explicit `lens.model` or `lensModel` beside it, or a row `route.ts` cannot answer with a model. The lens's findings gate as any lens's do. |
| `freezeFindingSet` + `maxRounds` | `boolean` (default `false`), positive `int` (default `6`) | Redispatch sets the freeze from round 2. Open blocking carried findings gate; fresh blocking lens findings become reported `residue`, not gates for that round. Task/mechanical failures and the synthesized dead-lens critical still gate. The cap belongs in the approved plan; redispatch refuses a round beyond it with exit 4. See *The frozen finding set and the round cap*. |
| `onlyTasks` + `priorResults` | `string[]`, `{implemented, verified, red}` | Redispatch derives the selected task ids from all selectors, closes them under transitive dependents, and adds tasks with missing records. The remaining task records are carried. Absent/unreadable verdicts or `--full` mean FULL; proven `red-green` records for the exact current command are still carried from round 2 and skip both dispatch-time and in-run re-probes. A changed command invalidates its old proof and selects the task for a new probe pair; missing current-command red evidence fails closed. Absent `onlyTasks` runs all tasks; a non-empty array selects its slice. `onlyTasks: []` runs no implementer or per-task verifier, but re-runs checks and the lens; it throws unless every task has carried implemented+verified records, whose verdicts still gate. |

Every knob is read off the plan's **Run sizing** block — no line there means the default stands.
Choosing one at dispatch time changes the verdict without changing the bytes the user approved.

`mechanicalChecks` are **whole-deliverable**: they always run, including under `onlyTasks`, and are
never carried forward from `priorResults` — carrying an empty set forward would be a vacuous pass.

The lens always re-runs, including on a zero-implementer round. `scoreTable.lensesRun` is `1`;
`lensesReported` is `1` or `0`. Zero means no review reported: the gate synthesizes a critical and
leaves every carried finding open. It never means reviewed-and-clean.

### Plan review — computed, over the args, before anything is spent

**Plan review is the review of the inputs `workflow.js` will run**, and it is finished before
dispatch. No agent reads the plan markdown looking for defects: Phase 2's rule that every claim is a
`tasks[].acceptance` clause or a `mechanicalChecks` entry makes the args object *be* the plan, so
reviewing the args reviews the whole thing. The judged layer that once did this measured 20/16/17
findings with 8/8/9 surviving across three dispatches of one plan, **zero title overlap** between
consecutive rounds and zero artifacts built — every finding real, and the reviewed surface growing in
response to its own output.

`work-dispatch.sh` enforces two tiers on the built args, before `args.json` is written; a blocking
finding exits 3 with the run still armed and every artifact byte-identical. Both run by hand too:

```
bun ~/.claude/skills/workflows/skills/work/scripts/plan-lint.ts      <plan.md|args.json>
bun ~/.claude/skills/workflows/skills/work/scripts/plan-preflight.ts <plan.md|args.json> --cwd <repo> [--only acceptance]
```

**Tier 1 — `plan-lint`** decides the plan's structured fields. Its `major`/`critical` rules block:
`dependson-cycle`, `dependson-missing`, `redcommand-existence-only`, `redcommand-missing`,
`red-both-declared`, `redcommand-disagreement`, `self-gating-task`, `writable-paths-overlap`,
`plan-table-column-arity`, `prose-command`, `lens-missing-severity`, `lens-missing-condition`,
`acceptance-is-the-mechanical-check`, `pipeline-exit-code`, `criterion-unmapped`, `count-mismatch`,
`work-artifact-unasserted` (scoped to tests and assertion scripts — things that exist to be RUN),
plus one worth spelling out:

- `gate-shell-operator` matches `workflow.js`'s own operator regex exactly, with no `bash -c`
  exemption, so tier 1 cannot pass a gate that arg-validation then refuses.

`acceptance-clause-uncommanded` and `redcommand-relative-path` are minor and advisory — deciding
whether a prose clause states a requirement is a judgement, not a lint.

**Tier 2 — `plan-preflight`** executes the args' own commands at BASELINE and reads the exit codes,
so give it a quiet tree. Live-service and network commands are skipped unless `--unsafe`.

- **`redCommand`s** (TIER 2, its own richer classifier): `red-not-red` (exit 0 — the gate already
  passes) and `could-not-run` refuse. **A red gate must produce real test-framework output**: an
  absence grep, or a `-t` filter matching nothing, exits 1 having run nothing and is `could-not-run`,
  never red. Each active task without carried proven RED for its current command is probed before any task runs — so a gate
  pointing at a file a later task creates is refused too, and failing tests must exist before the run —
  author them before dispatching, which the guard permits because no task's `writablePaths` covers a
  suite that gates the run (one that did would be `self-gating-task`).
  **A suite that never loaded is `could-not-run`, not red**: a collection or import error means the
  surface under test does not exist, and a red that only proves that proves nothing about behaviour.
  Greenfield work therefore needs a stub that exists and fails — declare it in `scaffoldPaths`,
  which is what makes it authorable while the run is armed.
  Run by hand, `plan-preflight` decides on the exit code alone — `red-gate-already-green` (0),
  `gate-command-not-found` (127), `gate-timeout` (no status); it has no could-not-run classifier,
  which reads the probe's OUTPUT and lives only in `work-dispatch.sh`'s `red_probe_gate`.
- **`mechanicalChecks`** (TIER 2b, **including under `readOnly`** where they are the entire gate):
  only a `critical` refuses (127); a mixed red/green baseline is normal and reports
  as `baseline-split`, since the run is what closes the gap.
- **acceptance commands** (`--only acceptance`): `acceptance-command-not-found` (critical) when a
  command exits 127 — the clause names a binary this tree does not provide and can never mean what it
  claims; `acceptance-green-at-baseline` (major) when a task carries no `redCommand` and every one of
  its acceptance commands already exits 0, so nothing distinguishes "the work landed" from "the work
  was never started". A task with a `redCommand` is exempt — its red gate already carries that proof.
  **No dispatch gate executes these**: tier 2b passes `--only mechanical`, so acceptance probes are a
  by-hand pass, before arming the run.

The script throws on missing plan/hash/tasks — never "fix" that by inventing args; re-derive them
from the plan file. It runs IMPLEMENT, then VERIFY (blind verifiers for tasks with no `acceptanceCmd`); `work-checks.sh`
then runs every command the gate reads, and the single review lens — one farm row — reads the digest
of task/check outcomes and carried claims; the JS computes the gate. IMPLEMENT runs in the waves `dependsOn` declares.

**One tree, still.** Worktrees are deliberately not used: `workflow.js` has no filesystem, so it
could not merge them, and a merge agent's silent slip is indistinguishable from an implementer's
omission until a lens catches it. What makes concurrent implementers safe in that one tree is **not**
trust, it is arg-validation: same-wave tasks must have **pairwise-disjoint `writablePaths`**, checked
prefix-aware (`src` and `src/lib/x.ts` overlap) and refused before any agent is dispatched.
Serialising two such tasks with a `dependsOn` makes the same paths legal, because different waves
never write at the same time.

### Where the agent team lives (not in `workflow.js`)

**A team cannot run inside `workflow.js`.** The workflow dispatcher unions a fixed disallow list
(`["SendUserMessage", "Agent", "Workflow"]`) into whatever `agentType` a leg names, so **`Agent` is
stripped from every workflow leg regardless of type**; `SendMessage` survives, so a leg can message
something that already exists but cannot create anything to talk to. So on a `readOnly` run where
CLARIFY answered yes to the team axis, the team runs **before** the Phase 4 dispatch and hands its
discoveries in as `priorFindings`. Discovery gets the team; the adjudication and the gate stay outside it.

It also cannot run in this session: the guard denies the `Agent` tool outside its allowlist
(`Explore`, `Plan`, `librarian`, `codex:rescue`, `statusline-setup`, `plugin-dev:*`), so named
teammates are only spawnable inside a farm-out child. Run it through `farm-team.sh`, with **one
`--expect` per teammate**:

```bash
# --cwd places the LEAD; --expect resolves against the CALLER's cwd, so keep those absolute.
bash ${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts/farm-team.sh --cwd "$PWD" \
  --prompt-file "$PWD"/.work/<run-id>/team.txt \
  --expect "$PWD"/.work/<run-id>/findings/<lens>.json \
  --expect "$PWD"/.work/<run-id>/findings/<other-lens>.json
```

**The file is the record, the message is the signal.** Teammate delivery is not fully reliable
(`.claude/rules/agent-teams.md`), so each teammate writes **exactly one** file to
`.work/<run-id>/findings/<lens>.json` before going idle, holding a JSON array:

```json
[{ "title": "…", "severity": "critical|major|minor", "detail": "…", "file": "src/app.rs" }]
```

The lead concatenates `findings/*.json` into `priorFindings`, stamping each entry with a stable `id`
(the filename plus an index does) so the lens can rule on it by id across rounds, and an `ownerTask`
wherever the teammate named one. **A teammate that found nothing writes `[]`**: that is what makes
"found nothing" distinguishable from "died", and it is the whole reason the file exists rather than
the message.

**The file count is the runner's exit code, not the lead's diligence.** One `--expect` per teammate
makes `farm-team.sh` exit non-zero naming every findings file that is missing or empty. Do not start
Phase 4 on a non-zero exit — name the teammate to the user. Do not file the missing teammate as a
`priorFinding` either: the lens closes an entry only on evidence it can point at, and no evidence in
the tree can confirm a negative about an agent that is gone — so the entry would sit open forever,
failing every round for a reason no task can fix.

On the result:

- Render the verdict and `scoreTable`, including task counts, `lensMode`, `routes`, `planFindings`,
  `carriedSubmitted`/`carriedOpen`, `survivingBlocking`, `survivingMinor`, and advisory counts.
  `mechanicalRun`/`mechanicalPassed` at `0/0` means the phase was skipped, not checked-and-clean.
- `scoreTable.lensesRun` is `1`; `lensesReported: 0` synthesizes a critical, fails the gate through
  `lensesThatFlagged`, and leaves every carried finding open. A lens that returned no findings is
  reported as `1`, not `0`. Show the actual `routes`, `planFindings` and carried rulings too.
- **On a `readOnly` run** `tasksJudgedThisRun`, `implementedDone` and `verifyPassed` are `null` — the
  dimension **does not apply**, nothing was dispatched along it. That is neither zero nor clean:
  render it as *n/a*, because a `0` printed beside real counts reads as "checked and clean".
  An audit with `tasks: []` has no task owners, so `tasksThatFlagged` is `[]`; any declared task
  owners can still appear through lens routing. Both verdicts go to Phase 5 via the findings file,
  not to the fix loop.
- **FAIL** → the selector is `tasksThatFlagged`, `mechanicalThatFailed`, `lensesThatFlagged` **and
  `planFindings`**. Consume all four. See below. **PASS** → Phase 5.

### The FAIL fix loop — four selectors plus planFindings

The JS gate passes only when `tasksThatFlagged`, `mechanicalThatFailed` and the standing blocking
finding set are empty. A FAIL therefore has at least one non-empty selector. Consume all three
existing selectors and `planFindings`; the latter names fixes outside every task's writable scope.

The lens routes RED failures and GREEN blocking findings by `ownerTask`. Valid task owners join
`tasksThatFlagged`; `"plan"` owners enter `planFindings`. Redispatch builds `taskFixes` from those
routes and blocking findings so each selected implementer sees why it is re-running. Task selection
includes transitive dependents and tasks with missing implemented/verified/red records.

| selector | what it names | next action |
|---|---|---|
| `tasksThatFlagged` | incomplete, unverified, unreported or red-failing tasks, plus valid lens-routed owners | Redispatch selects those tasks and their dependents; `priorResults` carries the rest and `taskFixes` supplies the fixes. |
| `mechanicalThatFailed` | `{name, exitCode, output}` for each failed check; `-1` means unchecked/dead, not passed | Fix the diagnosed cause. Checks always re-run; a lens route to a task narrows implementation to that owner. An unattributed mechanical failure forces FULL. |
| `rulesThatFailed` | rule ids (`DEN`, `M1`, …) whose Jev p >= `blockAt`, plus `ruleChecks:<name>` when the runner died, printed no parseable line, or reported a rule unavailable; per-rule p is in `ruleVerdicts` | Fix the diagnosed cause. Rules always re-run; a lens route to a task narrows implementation to that owner. A rule is wired only after `bun skills/work/scripts/rule-calibrate.ts` passes it (docs/DESIGN-routing.md). |
| `lensesThatFlagged` | `['lens']` when a blocking finding stands, including an open carried claim or a dead-lens critical | Act on the finding's owner; the lens always re-runs. Fresh findings held as residue do not set this selector. |
| `planFindings` | routes or standing blocking findings owned by `"plan"` | Amend the dispatch spec: add the required path to a task's `writablePaths`, or reword the requirement, then re-hash. Unchanged spec hash refuses redispatch with exit 3, spending no round or rotating the result. After an amendment, an all-plan failure permits `onlyTasks: []` when all task records are carried. |

Use `work-redispatch.sh <plan> <run>/args.json --dispatch`, not hand-written scope args. For a
lens-only failure lacking a valid owner, redispatch falls back to `file`→`writablePaths`, stripping
`:\d+(-\d+)?(:\d+)?$` first (`:135`, `:135-140`, `:135:8`). An unmapped finding forces FULL.
Proven `red-green` adjudications for the exact current command are carried on scoped and FULL rounds
from round 2; neither the dispatch-time before-run nor the after-run re-proves RED against already-fixed code.
Changed or commandless records are dropped; task-id equality alone never certifies an amended command.

An invalid owner is logged, not silently discarded. A FAIL with all four selectors empty violates
the return contract; investigate it rather than treating it as clean. Pre-dispatch lint/probe
refusals are separate from returned `planFindings`, but both require correcting the plan and
re-hashing. Amend by replacement, not accretion: more than one `ROUND <n>` marker in a work cell is
`plan-lint`'s blocking `work-accretion` finding.

### The frozen finding set and the round cap

The historical measurements in `references/convergence.md` explain why a dry fresh-finding pass is
not a reliable exit condition. From round 2, redispatch sets `freezeFindingSet` and derives
`carriedFindings` from the previous blocking findings plus existing carry, removing evidenced
closures. Existing ids survive; missing ids are derived from `(lens, title, file)`. External claims
remain in `priorFindings` and are merged into the same adjudication pool by the spine.

The lens rules each carried id `open|closed` with evidence. A closed entry appears in `carried[]`
but not in standing `findings[]`; a missing ruling, empty closure evidence or dead lens leaves it
open. Under the freeze only open blocking carried claims gate the finding channel. Fresh blocking
findings remain in `findings[]` and are also reported as `residue[]`, without gating that round.
Task/mechanical failures and the synthesized dead-lens critical still gate.

The carry is re-derived, not a permanently fixed round-1 list: a fresh finding in the previous
verdict can enter the next round's carry, including one previously reported as residue. Thus the
freeze limits what gates the current round; it does not guarantee a monotonically shrinking set.
If the run ends, remaining residue can be supplied to a fresh run as external `priorFindings`.

`maxRounds` defaults to 6. Redispatch beyond that cap exits 4, spends no round, rotates no result,
and prints a paste-ready `priorFindings` block containing still-open claims and residue for a fresh
run. Raising the cap is a human decision, not the loop's.

At round ≥ 3, or with an archive older than 2 h, redispatch prints the `converge-check.ts` command.
Run it as `bun ~/.claude/skills/workflows/skills/work/scripts/converge-check.ts <run-dir> [--json]`:
exit 0 CONVERGING, 1 NOT CONVERGING with reasons, 2 too short to judge. The report itself is advisory;
`work-loop.sh` consumes it and stops with exit 5 on NOT CONVERGING.

### Text-only findings: fix inline, confirm with `readOnly`

When **every** standing finding is a text defect in an already-built artifact — a doc that
contradicts the code, a command template that is wrong as written — re-dispatching implementers
rebuilds finished work to re-judge a few sentences. Instead:

1. **Fix the text inline.** The orchestrator may edit it; no implementer is needed.
2. **Verify each finding directly**, by the evidence the finding itself names — diff the two files,
   run the corrected command and show its exit code. Not "it looks right now".
3. **Confirm with a `readOnly` re-judge, sized to the fix.** `readOnly: true`, `tasks: []`, the
   unchanged `mechanicalChecks`, and a `lens.prompt` **narrowed to the findings that were fixed and
   the text that changed**: does each named defect actually close, and did the edit introduce a new
   contradiction? Hand the fixed findings back as `carriedFindings` so the lens has to rule each one
   `closed` with evidence rather than merely not re-raise it. Record the narrowed prompt in the plan's
   dispatch spec and its Run sizing, then re-hash — changing prose alone does not change the gate.

   The checks stay in `work-checks.sh` rather than run inline: the JS gates on the exit code the
   script recorded, and an orchestrator running its own checks is back to self-report.

**The confirming pass is not optional.** Fixing findings inline and declaring victory is the
orchestrator certifying its own edits — the same self-report the gate exists to replace.

**Cap confirming passes at two.** A third consecutive confirming FAIL means stop and put the findings
to the user. The failure mode is not a loop that finds nothing; it is a loop where every finding is
individually real and severity quietly decays, so there is never an obvious moment to stop — judge
the *trend*, not the current finding.

**Text-only is a judgement about the FIX, not the severity.** A wrong command template is `critical`
and still text-only; a one-word doc change that alters what a script does is not. The test is whether
any task's implementation changes. If one does, it is a normal `onlyTasks` re-run.

**The fix loop does not apply to a `readOnly` run.** There, a FAIL is the *expected successful
outcome*: an audit that finds defects is an audit that worked. The selectors still name what was
found, but they are the audit's report, not a work queue — fixing what they name is a separate
**writing** run, with its own plan, its own hash, and its own gate. Route both verdicts to Phase 5.

## Phase 5 — HUMAN REVIEW

**Phase 5 runs AFTER the goal clears, and is no part of it.** The goal's terminal clause is `work`'s
own verdict; a human verdict is not something a session can work toward, so putting one in the goal
makes every run stoppable only by a person who may have walked away — measured 2026-08-22, a tested
and reversible bugfix sat behind that clause for ~18 hours while the outage it repaired stayed live.

Two consequences, and they are the whole of the change:

- **Deliver first.** A `work` PASS means the suite is green, which is not the same as done. Where the
  run has a real-world claim — the account ingests mail again, the endpoint answers — establish THAT
  before opening review, so the reviewer sees something whose central assertion already holds.
- **Never block delivery on the TUI.** Open review on work that is delivered, or offer it and move
  on. The one case that still argues for reviewing before you ship is work that cannot be undone —
  a one-way migration, a deletion — where there is no rollback to fall back on. That is a judgement
  the orchestrator makes out loud with the user, not a gate this file imposes on every run.

```bash
# 30-minute timeout; NEVER run_in_background; NEVER relaunch on timeout (the TUI is still open)
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/human-review-gate.sh -w --no-update-check
# or: -r <range> / pr <N> per the plan's review surface
```

### The read-only path — review the findings file, not the tree

A `readOnly` run changes no files, so `-w` opens an empty diff and tuicr returns `unreviewed`, which
the table below calls *not approval*. So on a `readOnly` run the orchestrator **first writes
`.work/<run-id>/findings.md` from the object `workflow.js` returned**, then reviews that file:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/human-review-gate.sh \
  --file .work/<run-id>/findings.md --no-update-check
```

The orchestrator writes it because **a Workflow script cannot**: its sandbox has no filesystem and no
Node API — the hooks are `agent`/`parallel`/`pipeline`/`log`/`phase`/`workflow`/`args`/`budget`.
(`human-review-gate.sh` forwards its args verbatim to tuicr, so `--file` needs no script change.)

`.work/` is gitignored, so this file does not survive the machine. **A findings document worth
keeping must be moved somewhere tracked** — say so to the user when the audit found anything.

### What the findings file must contain — transcription, not judgement

The agent writing this file is the agent that ran the audit. If it summarises in its own voice, the
audit becomes self-reported — exactly the pattern the gate exists to prevent, reintroduced one step
after the gate. So: counts come from `scoreTable` verbatim, findings from `findings[]` verbatim, the
verdict from `verdict`. **Organise; do not grade.**

| section | source | rule |
|---|---|---|
| verdict + one-line scope | `verdict`, `judged` | verbatim |
| coverage | `scoreTable`, including `lensesReported` and `lensMode` | Print counts verbatim; `lensesReported: 0` means unreviewed, not clean. Render null task/score dimensions as n/a. |
| rule verdicts | `ruleVerdicts` | Advisory evidence from the rule checks. |
| rules that failed | `rulesThatFailed` | Gate for rules failing above blockAt. |
| carried rulings | `carried[]` | Every id with status and evidence, closed entries included. |
| standing findings | `findings[]` | Fresh lens findings plus open carried claims, grouped by severity with owner task and location. |
| residue | `residue[]` when the freeze is enabled | Mark fresh blocking findings as reported but not gating this round; do not relabel them minor. |
| diagnoses and plan amendments | `routes[]`, `planFindings[]` | Failure → owner, cause and fix. Routes are empty on GREEN; plan-owned items require amending the dispatch spec and re-hashing. |
| positive dispositions | `dispositions[]` | Satisfied checks, not defects or gates. For routed entries include `routedFromFinding`, `claimedSeverity` and `routedBecause`. |
| mechanical | `mechanical[]` | Name, exit code and output. |
| advisory | `scores[]` | JS-computed scores and evidence; never gates. |
| task records | `implemented[]`, `verified[]`, `red[]` when present | Distinguish carried records from work judged this round; an audit dispatches none. |
| not checked | the plan's scope vs what actually ran | Explicit, not omitted. |

Blocks until the user quits tuicr, then prints one verdict JSON:

| verdict | meaning | action |
|---|---|---|
| `approved` | files marked reviewed, no new notes | clear goal, clean `.work/`, done — offer commit/ship |
| `findings` | new human annotations | tactical loop below |
| `rejected` | a note contains `REJECT`, or PR is request-changes | strategic loop below |
| `unreviewed` | opened-and-quit, nothing touched | **not approval** — ask the user what they want |

**Tactical loop (findings, plan unchanged):** convert each comment to a task; fix via
workflow.js re-run scoped with `onlyTasks` (or directly for one-liners, then still re-verify via
the workflow); reply to each annotation in-session:
`tuicr review add --username "Claude" --session <slug> --target-file <path> --line <n> "<reply>"`;
relaunch the gate script.

**Strategic loop (REJECT):** the interpretation was wrong, not the execution. Clear the goal,
keep `.work/<run>/` as provenance, start a fresh run-id, return to Phase 1 CLARIFY with the
rejection notes as input. **Cap: two rejections** → stop, summarize both misses, and escalate/
descope with the user rather than guessing a third time.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Trivial edit (one file, obvious) | run the full loop | say it's overkill; just do it |
| Verifier needed for a task | let the implementer self-certify | separate verifier agent, blind to the report |
| Task is test-first | let the implementer report "RED confirmed", or make RED the review lens's job | give the task a `redCommand` — the dispatcher and `work-checks.sh` execute it on both sides of the implementer and the JS reads the two exit codes. A lens runs after the work and structurally cannot observe RED |
| Sizing not in the approved plan | write the lens prompt or pick the checks at dispatch time | it shapes the gate — put it in the plan, re-hash, then dispatch |
| Tasks feel like they could run in parallel | fan out implementers yourself, or give each a worktree | declare `dependsOn` and let IMPLEMENT wave them — concurrent within a wave, and arg-validation refuses a wave whose `writablePaths` overlap, so safety is checked rather than trusted. Worktrees stay out: `workflow.js` cannot merge them (no filesystem), and a merge agent's silent slip reads as an implementer's omission |
| A task reads a file another task writes | rely on `tasks[]` array order | array order is not a contract the script enforces — declare `dependsOn: ['<id>']`. An unknown id and a cycle both throw before dispatch; an edge to a task outside `onlyTasks` is treated as satisfied, since a prior run put its output on disk |
| Write `args.goalCheck` as this run's `work-result.sh` / `result.json` | "that is what settles the run" | a round verdict cannot certify the goal and outlives an abandoned run; `plan-lint` runs it through `hold-lint.ts` and blocks. State the plan's own measurement, or state none and let the judge rule on `args.goal` |
| Dispatch printed a `CronCreate` block (the default) | scroll past it; the monitor covers it | the monitor dies with the session and the cron does not. Call `CronCreate` this turn and report the job id; `CronList` is what proves it |
| A stop is allowed mid-round and you read that as the hold being broken | re-arm, or treat the run as over | the run is IN FLIGHT: `args.json` with no verdict beside it, worked by a detached process. The clock still runs and the next Stop after the verdict blocks again |
| About to self-send a `/goal` or `/loop` into this session | any transport — herdr, agent-msg, a drainer | none of them land: a typed send needs the pane IDLE and a dispatching session never is. `work-hold.sh` writes a file and `CronCreate` is a tool call; both land inside the turn |
| Session opens on `Implement the following plan:` | implement it in the main thread | the context was cleared at approval — this is Phase 4, not the work. The plan's frontmatter `workflow:` names the skill to invoke first; then dispatch. `work-dispatch.sh` needs nothing you lost. Same answer when an Edit is denied for an armed run |
| A stopping condition is a claim, not a command | "the tests in the plan pass" | a check is RUN — give it a command whose exit code is the verdict |
| Treat a stopping condition you WROTE DOWN as binding on yourself | prose you can re-adjudicate away | only the hook blocks a stop. Measured 2026-09-02: a session wrote "I'm treating that as binding regardless" and idled three hours later. Arm it, confirm with `--status` |
| Arm a check that already exits 0 | it holds nothing, and teaches the session the hold is noise | `work-hold.sh` refuses it; pick the check that is red now |
| Disarm your own hold because the gate looks wrong | "this gate measures the wrong property" | that is the same sentence a session uses when the gate is merely hard. `--disarm` prompts the USER on every transport (tty, or the `permissions.ask` rule) and the hook restores a deleted state file — arm the RIGHT check, or ask the user to confirm |
| Arm a hold while a grind loop works the same objective | two drivers on one objective | the hold blocks this session's stop while grind's gate waits for no round in flight: each waits for the other (AGK 2026-09-27). Pick one — grind for a long loop, the hold for short work this session drives |
| Arm a hold on YOUR OWN session to try the hook out | it then blocks your own stop until the check passes | read `tests/work-hold.test.ts`, or arm a check you can satisfy on demand |
| End a turn with a question mark under an armed hold | offer the user a menu | at 02:00 that is a five-hour pause — answer it in one line and act. Same for "when done or blocked, notify and stop": enumerate the terminal blockers; the rest is the next task |
| Finish the hunt with a report and stop, or stop at N of M rounds | "the check went green" / "the budget says N" | the hold self-cleared, so nothing gates stopping — arm the next red check before the turn ends. The budget was the authorization, not a ceiling on ambition: spend it, or say why the remainder is unusable |
| Put "and the user has approved" in the objective, or hold a green commit because the user is asleep | wait for the human | a session cannot close a human clause by working (measured 18h) — `hold-lint` refuses it; review after the hold releases. The standing authority pre-authorized the commit; it is reversible, the silence is not |
| Recon would flood the conversation | read every file into this context | scout with a subagent during CLARIFY/PLAN — graded work still goes through workflow.js |
| One small task, workflow feels heavy | dispatch a lone subagent and accept its report | still workflow.js with one task — a self-report is not a verification |
| Tasks look like they need to talk to each other | reach for agent teams | **On a run that writes, no teams** — for the mechanical reason given under *IMPLEMENT runs in waves* above, not as a style preference. Tasks needing to talk means the plan under-specifies the boundary; fix the task table, re-hash. **The ban does not apply to `readOnly`**, where nothing writes and a team is the default (CLARIFY axis 7); see *Where the agent team lives* |
| Fan-out estimate > ~50 agents | widen the workflow anyway | split into sequenced work runs, one gate each |
| Want a reviewer from another model family | bolt an advisory reviewer on beside the gate | answer CLARIFY axis 6 with that provider: `lensProvider` moves the lens itself, so its findings gate |
| Consume only `tasksThatFlagged` | treat an empty list on FAIL as nothing to fix | Consume `mechanicalThatFailed`, `rulesThatFailed`, `lensesThatFlagged` and `planFindings` too. An audit with `tasks: []` has no task owner channel. |
| A mechanical check failed | guess the nearest task, drop the check or force FULL | Follow the lens's route to its owner; checks always re-run. An unattributed failure falls back to FULL. |
| A blocking lens finding stands | scope by file before reading its owner | Prefer `ownerTask`: a task id enters `tasksThatFlagged`, `"plan"` enters `planFindings`. Redispatch supplies `taskFixes` to the selected implementer. |
| Pass an array of lenses | retain parallel readers and their refuters | Pass one `lens` object; merge the dimensions into its prompt. Arrays and the retired argument throw. Measurement: `references/convergence.md`'s 2026-09-30 postscript. |
| A finding's `file` reads `src/a.go:135` | map the location as a path | Prefer `ownerTask`; separate `file` and `line`. Redispatch strips a trailing `:135`/`:135-140`/`:135:8` before its fallback path map. |
| `planFindings` is non-empty | redispatch the unchanged brief | Unchanged hash exits 3. Amend the dispatch spec's writable paths or requirement, re-hash, then redispatch; all-plan routing with carried task records permits a zero-implementer round. |
| A FULL fix round has proven RED records | re-probe an unchanged command, or trust an old proof for an amended command | Redispatch carries proven `red-green` adjudications from round 2 only when `record.command === task.redCommand`. Matching proofs skip both probe gates; changed or missing commands are re-probed. |
| The lens ruled a carried claim closed | drop it without reading the evidence | Only an evidenced closure removes it; silence or an empty closure remains open. Read `carried[]`, not just fresh findings. |
| A `scoredChecks` composite comes back low | add a threshold or `blockBelow` so it fails the run, or read the score into some other gate | no such knob exists and adding one is not a configuration choice this parameter left open — gating on a composite chases redundancy minors. Read the score; gate on `mechanicalChecks` and on `critical｜major` lens findings, which can be wrong in only one direction |
| `mechanicalRun: 0` in the score table | read it as "mechanics clean" | the phase was skipped; nothing was checked |
| `lensesReported: 0` in the score table | read its zero findings as a clean dimension | the one review never reported; the gate synthesizes a `critical`, fails, and leaves every carried finding open. Re-run it — an unreviewed deliverable is not a reviewed one |
| tuicr quit with 0 comments, 0 reviewed files | treat as approval | `unreviewed` — ask the user |
| Phase 5 on a `readOnly` run | `-w` over a tree nothing wrote to | there is no diff, so that always returns `unreviewed` — write `.work/<run-id>/findings.md` and review it with `--file`, per *The read-only path* |
| A `readOnly` run returned FAIL | send it to the fix loop | that is the audit's successful outcome — it found defects. Take it to Phase 5; fixing is a separate writing run with its own plan and gate |
| PR review surface mid-loop | push new commits to the branch | don't — tuicr sessions key on head_sha; finish the loop first |
| Plan edited after approval | keep going | agents will halt on hash mismatch anyway — re-hash and restart Phase 4. `scripts/work-redispatch.sh <plan> <args.json> [--dispatch] [--full] [--no-lint] [--no-red-probe]` does the re-hash, refuses when the args name a different plan, and rotates a stale `result.json` so a previous verdict cannot be read as this run's. With `--dispatch` it runs both dispatch gates on the final args and exits 3 on a major/critical or a refused red probe, and exits 4 past `maxRounds`, spending no round and rotating nothing in either case |
| Change lens cost or coverage after approval | silently downgrade `lens.model` or drop a dimension | The lens counts as one agent. Model, effort and prompt changes belong in the dispatch spec and Run sizing before re-hashing. |
| A lens ref is huge and slow to read | distil it into a summary ref | a condensed copy of `work`'s doctrine drifts and is what `spine-fidelity` exists to catch — the optimisation flags itself. The lens reads its refs once per round; never fork what it reads |
| The plan looks wrong and you want an agent to review it | point the lens at the plan markdown and block on what it finds | that loop does not terminate — the fix for round *n* is new surface round *n+1* finds real defects in (see *Plan review*). Plan review is `plan-lint.ts` + `plan-preflight.ts` over the args, and anything a reader would have caught belongs there as a rule |
| An acceptance clause already passes at baseline | ship it — the criterion holds | `acceptance-green-at-baseline`: nothing distinguishes "the work landed" from "the work was never started". Give the task a `redCommand`, or state a clause the work has to make true |
| Red gate is `grep -q <thing that should not exist>` | call it red because it exits 1 | that is `could-not-run` — no test framework ran. A red gate must produce real test output; write the assertion as a test |
| workflow.js throws on args | patch args from memory | re-derive from `.claude/plans/<slug>.md` |
| `.claude/plans/<slug>.md` doesn't resolve | copy the plan in from `~/.claude/plans/`, or dispatch the path anyway | resolve the real path and hash it there — plan mode fixes the plan's path at entry, so a session predating the `plansDirectory` setting still writes to `~/.claude/plans/`. Set the setting for next session; never copy (two files drift), never dispatch a path you haven't confirmed resolves |
