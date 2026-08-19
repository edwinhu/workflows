---
name: craft
description: Structured task loop with human review. Use when the user says "craft this", "run a craft loop", "do this properly", "clarify plan and verify this", "structured task with human review", "/craft", or wants a substantial change taken through clarification, an approved plan, delegated implementation with independent verification, and a tuicr human-review loop.
argument-hint: 'the task to run through the loop'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# craft — clarify → plan → goal → workflow → human review

A structured loop for tasks worth doing properly: clarify with the user, draft a plan they
edit and approve, self-set a goal, run `workflow.js` — dispatched through farm-out — to implement
and independently verify, then put the result in front of the human in tuicr. Human rejection
routes back to CLARIFY.

```
 ┌────────── human REJECT / criteria wrong ──────────────────────────────┐
 ▼                                                                       │
CLARIFY ─► PLAN ─► GOAL ─► workflow.js ──PASS──► HUMAN REVIEW (tuicr) ──┤
 (ask)    (draft,  (self-   IMPLEMENT, then       │ approved → done   │
           user     send)   VERIFY ∥ MECHANICAL   │ findings → fix ─► re-run
           edits)           ∥ third-party (opt-in,│            workflow.js (subset)
                            advisory) → JS gate   │
                              ▲    │
                              └─fix┘ FAIL — re-run selector is tasksThatFlagged
                                    + mechanicalThatFailed + lensesThatFlagged
```

**Plan review is computed and happens before dispatch, not inside it** — `plan-lint.ts` over the
built args and `plan-preflight.ts` executing their commands at baseline, enforced by
`craft-dispatch.sh` while the run is still armed. No agent reads the plan markdown for defects
(see *Plan review*).

Everything lives in this skill directory — `workflow.js`, `references/third-party.md`,
`scripts/craft-dispatch.sh` (Phase 3+4 in one call), `scripts/craft-pending.sh` (is a dispatch
owed?), `scripts/goal-self-send.sh`, `scripts/human-review-gate.sh`, `scripts/craft-result.sh`.
Nothing here depends on any plugin.

**The gate has a test suite; run it after touching `workflow.js`** — `node --check` proves only that
the file parses. `scripts/workflow-harness.mjs` executes the script for real against stubbed hooks,
and `scripts/workflow.test.ts` asserts the invariants that decide PASS/FAIL: fail-closed on every
dead agent, the three `redCommand` verdicts, `overallPass === false` implying a non-empty selector,
the `readOnly` n/a dimensions. `scripts/plan-review.test.ts` guards the computed plan-review rules
and the absence of the judged layer. Add both to `mechanicalChecks` on a run that edits the spine:

```bash
bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/   # absolute path: a bare relative path is
# read as a NAME FILTER and exits 1 having matched nothing — identical to a real failure
```

## State

Two locations, one owner each:

| Path | Holds | Owner |
|---|---|---|
| `.claude/plans/<slug>.md` | the approved plan — **the run's authority**, the file that gets hashed | plan mode (native); craft only reads and hashes it |
| `.craft/<run-id>/` | args, verdict JSON, and `plan-<hash12>.md` — the archived bytes each round ran under | craft |

`plansDirectory` is `"./.claude/plans"`, resolved relative to the project root, so the plan is
project-local and craft hashes it in place — no copy. `run-id` is a short date-slug like
`0806-fix-auth`. Both `.craft/` and `.claude/plans/` want to be gitignored — add them before the
first run if the repo would otherwise track them. Clean up `.craft/<run-id>/` when the run
completes, unless the user wants provenance kept; leave the plan file alone either way, it's plan
mode's. **The plan file is not durable and craft does not own it** — plan mode memoizes one slug per
session, so re-entering plan mode overwrites the plan in place, and the directory is gitignored. So
dispatch archives the bytes it hashed to `.craft/<run-id>/plan-<hash12>.md` (content-addressed: an
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
6. **Third-party review?** — none (default) / codex / gemini / both. *This is the only opt-in
   moment; a plan approved without the opt-in line never runs third-party.*
7. **Read-only runs only — use an agent team for discovery? (default yes.)** Ask this axis only
   when the run is an audit (`readOnly: true`); for a run that writes, the answer is always no and
   the axis is skipped. The honest tradeoff: a team of communicating auditors catches **cross-file**
   defects that isolated lenses structurally cannot see — each lens judges alone and no lens holds
   two files at once. The cost is that a team's findings are **correlated**, so refutation must stay
   **outside** the team. Answering no is a real option; it costs discovery breadth, not gate
   integrity. For where the team runs and how its findings reach the gate, see *Where the agent team
   lives*.

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
  Review lenses:     criteria-vs-artifacts, scope-fidelity   (+ one line per added lens, with the risk it covers)
  Mechanical checks: <name> — `<exact command>`              (omit the section if none)
  Scored checks:     <key> — <what it scores>, ADVISORY: never gates  (opt-in, no default; omit if none)
  Test-first:        <task id> — `<redCommand>`               (one line per red-gated task; omit if none)
  Red dispositions:  <task id> — <why this task carries no red gate>  (one line per dispositioned task; omit if none)
  Third-party review: codex                                   (only if opted in at CLARIFY)
  ```

Every task fans out to 1 implementer + 1 verifier, plus 2 probes if it carries a `redCommand`; every
lens to 1 reviewer + up to `refutersPerLens` refuters; **every `priorFindings` entry costs one
refuter**; every `scoredChecks` item costs one agent, advisory or not. If that runs past ~50, the
plan is too coarse-grained for one gate: split it into sequenced craft runs.

**This is enforced, not advised.** `workflow.js` computes its own fan-out floor
(`2·tasks + 2·redGatedTasks + lenses + mechanicalChecks + scoredItems + priorFindings + thirdParty`)
at arg-validation and **throws before dispatching anything** if it exceeds `maxAgents` (default 50);
the error prints the per-dimension breakdown. Raising `maxAgents` is legitimate; raising it silently
at dispatch time is what the throw prevents, because sizing is the user's call at approval time.

**Sizing lives in the plan because it shapes the gate.** Choosing lenses or dropping a mechanical
check after approval would weaken the verdict without changing a byte the user signed off on — the
hash covers the `craft:dispatch` spec block, so anything that decides PASS/FAIL has to be inside it.

**An audit needs a plan too.** `readOnly` still requires `planPath` + `specHash`, and the plan it
hashes is a **charter**, not a work order: what is being audited, which lenses judge it, which
mechanical checks run, and the standing instruction that nothing may be written. The task table may
be empty. Do **not** shortcut by hashing the artifact under audit instead: the AUTHORITY block tells
every agent the hashed file is its *only authority*, so hashing the audited file would tell each lens
that the thing it is judging is the standard it judges against.

**Arm the run before calling ExitPlanMode.** The plan must carry a dispatch block — every
`workflow.js` arg except `planPath`/`specHash`, which `craft-dispatch.sh` injects because a block
cannot state its own hash:

```
<!-- craft:dispatch
{"runId": "0813-slug", "goalTurns": 12, "args": { … }}
-->
```

Writing it is what arms the run, and the plan is the only file plan mode may write — which is also
the only thing that survives approval. **Claude Code clears the context when a plan is approved near
the ceiling** and re-seeds a bare `Implement the following plan:` session with no craft in it, which
will otherwise implement in the main thread. While a plan is armed and no `.craft/*/args.json`
records its hash, `~/.claude/hooks/main-thread-guard.sh` denies Edit/Write/Agent in that project —
resolving the project from the nearest ancestor of `cwd`, so a `cd` cannot disarm it — and blocks the
turn from ending once; both name the dispatch command. It denies only what some task's
`writablePaths` covers (`craft-dispatch.sh --covers`, failing closed when the spec cannot decide):
a path no implementer may write is not the run's output, which is what leaves the **red suite
authorable** here and nowhere else. A `readOnly` run never writes, so
there the Stop nudge is the only thing that fires. Derive the prose Run sizing block from the JSON;
`craft-dispatch.sh` prints the fan-out it computes, so drift shows up before anything is dispatched.

The user edits the plan file and approves via ExitPlanMode. Then **hash the plan where plan mode
actually wrote it** — resolve the path, don't assume it:

```bash
PLAN=$(ls -t .claude/plans/*.md 2>/dev/null | head -1)   # project-local, the configured location
[ -n "$PLAN" ] || PLAN=$(ls -t ~/.claude/plans/*.md | head -1)   # fallback: the default location
bash ~/.claude/skills/workflows/skills/craft/scripts/craft-dispatch.sh --spec-hash "$PLAN"   # 64-hex spec hash
```

Whichever it resolves to is `planPath`. **Never copy the plan** — one file, hashed in place, is the
run's authority. A copy creates a second file that can drift from the one the user edits. (The run
dir's `plan-<hash12>.md` is not that: it is a dead snapshot named by its own hash, written by
dispatch and never read as authority, so nothing can edit it or drift from it.)

**Ensure `plansDirectory` is set.** Plans belong inside `projectDir`, alongside the work and the
agents. `plansDirectory` is [relative to the project
root](https://code.claude.com/docs/en/settings), so `"./.claude/plans"` puts them there:

```bash
rg -n '"plansDirectory"' .claude/settings.json ~/.claude/settings.json 2>/dev/null
```

If neither tier sets it, add `"plansDirectory": "./.claude/plans"` to the project's
`.claude/settings.json` and gitignore `.claude/plans/`. Setting it at the user tier covers every
project at once, which is usually what you want.

**It takes effect next session, not this one.** Plan mode fixes the plan's path when you enter it, so
a session that started before the setting was live still writes to `~/.claude/plans/` — which is why
the snippet above resolves the real path instead of asserting one. Do not stop the run over it, and
do not copy the file to make the path look right.

The plan's `craft:dispatch` spec block is the sole authority every dispatched agent gets; the prose
around it explains but never binds. Nothing re-derives it: the agents re-run `--spec-hash` themselves
and stop on mismatch, so an amended spec halts the run instead of silently changing the contract,
while fixing a typo in the rationale costs nothing.

## Phase 3 — GOAL

**Self-send a `/goal`.** No file — the plan holds the success criteria and it's what's hashed.
What `/goal` adds is mechanical: after each turn a separate evaluator model checks the condition,
and if it doesn't hold **the session starts another turn instead of returning control to the user**.
That is what runs craft's outer loop (gate FAIL → fix → re-run; tuicr findings → fix → re-review)
without the user prompting each step. `workflow.js` can't do this — it returns a verdict once.

**`craft-dispatch.sh` does Phase 3 and Phase 4 in one call** — it reads the armed plan's dispatch
block, injects `planPath`/`specHash`, writes `args.json`, self-sends the goal below, and starts
`workflow.js` detached. Run it and skip to the Monitor; the rest of these two phases is what it
does and why, and what to check when it reports something odd:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-dispatch.sh   # armed plan; or pass one
```

It needs nothing from the session's context, which is the point: a run whose context was cleared at
plan approval is recovered by this one command, with no re-exploration.

**The plan-review gates run before `args.json` is written, exiting 3 with the run still armed and
every artifact byte-identical.** Tier 1 is `plan-lint.ts` on the built args. The two probe gates
execute disjoint command sets, each command exactly once: **tier 2 runs every active task's
`redCommand`** through the script's own classifier, refusing `red-not-red` (exit 0 — the gate already
passes) and `could-not-run` (exit 127, a missing runner, `pytest` exit 4/5, or no test output at
all), so only non-zero *with* a real test result proceeds; **tier 2b runs every `mechanicalChecks`
cmd** at baseline via `plan-preflight.ts --only mechanical`, where only a `critical` refuses.
Acceptance commands are `plan-preflight`'s third probe kind and **no dispatch gate runs them** — run
`--only acceptance` by hand on a quiet tree, before arming.
`--no-red-probe` drops tier 2, `--no-mech-probe` drops tier 2b, `--no-lint` drops all of them, and
`CRAFT_RED_PROBE_TIMEOUT` / `CRAFT_MECH_PROBE_TIMEOUT` (300s each) bound their own tier's commands.
A task whose work is already COMPLETE can satisfy neither gate —
a `redCommand` is refused `red-not-red`, omitting it is refused `redcommand-missing` — so it declares
`redDisposition` instead; both scripts echo `red: N gated, M dispositioned` with each disposition,
beside the wave graph.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/goal-self-send.sh \
  "/goal workflow.js has returned PASS for .claude/plans/<slug>.md at its current hash, and the tuicr gate has returned approved, or stop after N turns"
```

**Name the plan by PATH, never by a fixed sha256.** A pinned digest self-invalidates the first time
the FAIL loop does what this file prescribes: fix, **amend the plan, re-hash**, re-dispatch. The run
then PASSes against a hash the condition does not name, and the evaluator correctly reports the goal
unmet on finished work. The path is stable; the hash is the thing the loop is expected to change.

**Write the condition so the transcript can prove it.** The evaluator judges only what has been
surfaced in the conversation — it runs no commands and reads no files. "The acceptance criteria
hold" is unjudgeable; "the gate returned PASS and tuicr returned approved" is judgeable, because
both verdicts get printed. Include a turn clause to bound the run.

**On a `readOnly` run the condition must not name PASS.** Phrase it as *"workflow.js has returned a
verdict for `<planPath>` and the tuicr gate has returned approved"* — satisfied by either
verdict. A PASS-conditioned goal would keep starting turns driving toward an outcome the run is
forbidden to produce, because the only way to turn an audit's FAIL into a PASS is to fix what it
found, and a read-only run writes nothing.

Two mechanics worth knowing: setting a goal **starts a turn immediately** (that turn is Phase 4),
and only one goal can be active per session.

**Send it as the last action of the turn, then stop.** The message lands in *our own* input queue
and cannot be processed until this turn ends — so there is nothing to wait for, and blocking on it
would deadlock. Do **not** dispatch Phase 4 in the same turn: the goal would be set after the gate
already ran. Let the turn end; the `/goal` turn is Phase 4.

**Exit 0 means submitted, not processed.** The script sends the paste and the Enter separately, then
watches the pane's input line: a [swallowed Enter](../agent-spawn/references/prompt-delivery.md)
leaves the text sitting there, so it retries — **bounded** at three presses over about five seconds,
then exit 5 saying the text is still in the box. It refuses outright (exit 6) if the box is non-empty
when it starts, the guard against pasting into a message the user is mid-way through typing.
Transports are tried in order: our own herdr pane, then `agent-msg` for Remote-Control sessions.
Refusals are fail-closed — every non-zero path exits **before** anything is sent, except the two
"send attempted and failed" cases (exit 5).

Whether the queued line is *acted on* is unknowable from here — that needs the turn to end. Exit
non-zero (no transport, or the Enter never took) is **not fatal**: the loop is written down here,
it just needs the user to prompt each step. Clear on final approval:
`goal-self-send.sh "/goal clear"`.

If any of this is in the way, print the `/goal …` line and let the user submit it. One keystroke,
no race, no ordering constraint.

## Phase 4 — workflow.js

The args, annotated — write them to the args file as **plain JSON**, no comments, since `farm.ts`
`JSON.parse`s it:

```js
{
  projectDir, planPath: "<the path $PLAN resolved to in Phase 2>", specHash: "<64-hex>",
  goal: "<one sentence>",
  tasks: [{id, name, work, writablePaths, acceptance, refs, redCommand|redDisposition}, ...], // from the plan's task table
  thirdParty: ["codex"],          // ONLY if the plan carries the opt-in line; else omit
  mechanicalChecks: [{name: "node-check", cmd: "node --check foo.js"}, ...],  // optional
  scoredChecks: [{key, items, prompt, schema, components, passthrough, refs, agentType}, ...], // optional; advisory, never gates
  reviewLenses: [{key, prompt, refs, agentType}, ...],            // optional; default is 2 lenses
  // Standard, and the one to carry on any multi-task plan. `craft-dispatch.sh` PRINTS the wave shape
  // `dependsOn` produces; this asks whether it has to be that shape. MAJOR-capped, so it never blocks:
  // {key: "plan-parallelism", agentType: "Explore", refs: [],
  //  prompt: "Judge ONLY the approved plan's dependsOn edges. MAJOR at most, never CRITICAL — this is advisory. Given each task's `work`, `writablePaths` and `refs`: is any dependsOn edge unnecessary — could the two tasks run in the same wave? One finding per edge you would remove, naming the dependent, the dependency, and what the dependent actually needs from the dependency; if that is a BEHAVIOUR (an exit code, an observable effect) rather than a file the dependency writes, say so — an edge is a READ ordering, so a behaviour need is not one. Be specific or silent: a finding that names no concrete pair and no concrete reason is not a finding, and 'consider parallelising' is not one. Never argue for removing a test-first edge — the task that writes a failing test before the task that makes it pass — collapsing that means writing a test beside its fix, which is exactly what red-gating exists to prevent. Report nothing if every edge is load-bearing."},
  authorityExtra: "<domain rule appended to every agent's AUTHORITY block>",  // optional
  implementerAgentType: "…", verifierAgentType: "Explore",        // optional
  readOnly: true,                                                 // optional; audit an existing tree
  priorFindings: [{title, severity, detail, file, lens}, ...],    // optional; discoveries made outside this run
  freezeFindingSet: true, maxRounds: 3,                           // optional; set by craft-redispatch.sh, not by hand
  maxAgents: 50, refutersPerLens: 8,                              // optional; fan-out ceilings — throws if the floor exceeds maxAgents
  refuterModel: "sonnet", refuterEffort: "medium",                // optional; null on either inherits the session default
}
```

**Dispatch through farm-out, never the built-in `Workflow` tool** — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies it unconditionally, so an in-session call is
dead. `farm.ts` sets `FARM_OUT_CHILD=1`, which is what lets its child make the call.
`craft-dispatch.sh` runs exactly this and prints the wait loop with the run's paths filled in; what
follows is what it does, for when you are reading its output or a dispatch has gone wrong.

```bash
R=.craft/<run-id>; mkdir -p "$R"          # farm.ts refuses if --out's directory does not exist
# write the args object above to "$R/args.json" as JSON
# DETACHED, never foreground: a real gate runs 20-60 min and a foreground tool call caps out
# and kills it mid-run, as does a harness-tracked background task.
setsid nohup bun ${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts/farm.ts \
  --workflow ${CLAUDE_PLUGIN_ROOT}/skills/craft/workflow.js \
  --args "$PWD/$R/args.json" --out "$PWD/$R/result.json" --cwd "$PWD" \
  > "$R/run.log" 2>&1 < /dev/null &
# Wait for it: craft-result.sh is one-shot and knows nothing about the dispatch. Watch BOTH the
# artifact and the process — a watcher that only greps for success is silent through a crash — and
# key liveness on THIS run's --out path, or a concurrent dispatch reads as proof ours is alive.
# `[f]` stops pgrep matching its own command line.
while :; do
  [ -s "$PWD/$R/result.json" ] && break
  pgrep -f "[f]arm\.ts .*$R/result\.json" > /dev/null \
    || { echo "dispatch died with no verdict — see $R/run.log" >&2; exit 1; }
  sleep 30
done
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-result.sh "$PWD/$R/result.json"
```

**Run that wait as a `Monitor`, not a foreground Bash call** — Bash caps at 10 minutes and a gate
runs 20-60. Pass the loop body as Monitor's `command` with `persistent: true` (no deadline), keeping
both terminal states: result written, and process gone without one. Then call `craft-result.sh` when
it fires. Fall back to the loop across turns only where Monitor is unavailable — Bedrock, Vertex,
Foundry, or `DISABLE_TELEMETRY`/`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set. A Monitor dies with
the session; the detached run does not, so `/goal` remains the notifier that survives a restart.

`farm.ts` exits 2 on a malformed call (`--workflow` without `--out`, an `--args` file that is not
readable JSON) and non-zero when `--out` came back missing or not a JSON object. `craft-result.sh`
then refuses (exit 2) unless the file is one object carrying `overallPass`, `verdict`, `scoreTable`,
`findings`, `tasksThatFlagged`, `mechanicalThatFailed` and `lensesThatFlagged` with the right types,
and prints the verdict and the score table on success. All three selectors are required: a return
dropping one channel would make a FAIL carried solely by that channel read as a clean run.

**State the residual plainly: mechanical claims are adjudicated, the rest is shape, not fidelity.**
A model transcribes the workflow's returned object into `--out`, so a fabricated object with the
right keys — outside the re-run mechanical claims — passes both checks. Reconcile the score table
against the plan's Run sizing: counts that cannot be squared with what the run was sized to dispatch
make the result unverified, not a PASS.

| param | type | effect |
|---|---|---|
| `readOnly` | `boolean` (default `false`) | Audit mode. **No Implement phase and no per-task verifiers are dispatched**, so `tasks[]` may be empty or absent (it is still required when `readOnly` is false). Lenses ∥ mechanical ∥ third-party run as usual, and **every dispatched leg** — lenses, refuters, mechanical probes and third-party runners — defaults to the `Explore` agent type, structurally no Edit/Write, unless a per-lens `agentType` says otherwise. `Explore` keeps `Bash`, so a probe can still run its command. **Residuals**, all from `Bash`, and this list is open rather than exhaustive: a `mechanicalChecks` `cmd` runs VERBATIM; any reference this spine tells a leg to follow can itself instruct a write; and `authorityExtra` and `reviewLenses[].prompt` are caller-supplied free text handed to every Bash-capable leg. What the agent type pins is the agent's volition — never what it is *told* to do. Anything a `readOnly` run hands a leg must itself be read-only. `meta.phases` is a **static five-entry literal** (`Implement, Verify, Mechanical, Third-party, Gate`) in both modes — the harness parses `meta` without running the script and rejects any computed value, so a mode-specific phase list is not expressible. `Implement` is therefore advertised and then never opened on a `readOnly` run; that is `workflow.js`'s own progress display and is cosmetic. Craft's lifecycle **Phase 1–5** (CLARIFY, PLAN, GOAL, workflow.js, HUMAN REVIEW) is a different axis and is unaffected. The task dimensions become **n/a** (`null`), not empty-and-clean: see the score-table note below. |
| `priorFindings` | `[{title, severity, detail, file?, lens?}]` | Findings discovered **outside** this run — typically by a main-chat agent team. They are not trusted: each is refuted by the same adversarial path a lens finding takes (same schema, same default-to-refuted-when-ambiguous, same fail-closed rule that a dead refuter keeps the finding), and only survivors reach the gate, where they are gated identically to lens findings. An entry with no `lens` is attributed to the reserved key `unattributed` — the same key an unkeyed `reviewLenses` entry falls back to, since it is the same situation — so a survivor always names a `lensesThatFlagged` entry. Set `lens` explicitly to get a more specific label. **`file?` is the path the finding is _about_** — it is rendered into the refuter's prompt as `[path]` for context and is never opened by craft. It is **not** a location craft reads findings from; for where a team actually writes them, see *Where the agent team lives*. `severity` must be `critical｜major｜minor`; a malformed entry throws at arg-validation, before any agent is dispatched. An optional `agentType` on an entry overrides the refuter's agent type for that finding alone. **Each entry costs one refuter agent**, and the fan-out is bounded by nothing but the array you pass — so the count feeds the ~50-agent ceiling below. A `minor` entry cannot change the verdict (only `critical｜major` reach `survivingBlocking`), so it spends a full agent to move a display counter: submit `critical`/`major` unless you specifically want the minor counted. `scoreTable` then carries `priorFindingsSubmitted` / `priorFindingsSurviving`. |
| `mechanicalChecks` | `[{name: string, cmd: string}]` | Adds a `Mechanical` phase running in parallel with Verify. One low-effort probe agent per check runs `cmd` **verbatim** and reports `{name, exitCode, output}`; **the JS reads the exit code** — no agent asserts a pass. Fail closed: a dead or skipped probe is `exitCode: -1`, which counts as failed. Missing `name` or `cmd` throws. **A probe's report is still a claim, and the claim is adjudicated in a shell**: craft-result.sh re-runs EVERY declared check — a claimed failure included, since the file is a model's transcription of the gate object — and refuses (exit 2) when the observed exit code disagrees, or when a claimed non-zero exit sits beside `overallPass: true`. Re-running one command to confirm a claim is cheap and re-running N is not — which is why a workflow declares **one** mechanical entry point whose exit code is its whole mechanical verdict, never a list of commands (a list also drops a check silently, and nothing reports a check it never knew about). **`overallPass` in `result.json` is NOT the verdict and must never be read directly, without exception** — the verdict is `craft-result.sh`'s exit code (0 pass, 1 fail, 2 refused), and any caller that reads the file another way is a defect. |
| `scoredChecks` | `[{key, items, prompt, schema, components, refs, agentType?}]` (default off) | Weighted 0–10 scores, one agent per `items` entry, running in parallel with Verify. **The agent returns RAW COUNTS and craft computes every score in JS** from the caller-declared `components`, so no agent ever sees the formula it is scored by — an agent that reports its own score inflates it. **It is advisory and structurally cannot gate**: `overallPass` is computed without reading any scored value, there is no threshold and no `blockBelow`, it adds no selector channel, and even a dead agent does not flip the verdict. An unmeasured, dead or partially-reported item scores `null` with a reason — never `base`, never `0`. Absent or `[]` opens no phase and dispatches nothing, and the return then carries `scores: []` with `scoresRun`/`scoresReported` as `null` (n/a — render it as such, never `0`). A schema key that is not a declared count, a score-shaped name, or a `penalties` key the schema does not declare all throw at arg-validation, before any dispatch. **`passthrough: [<field>, …]`** declares the evidence a score never reads — the numeric denominators a finding is stated against and the item lists it is built from — which a count-only whitelist cannot express; it stays a whitelist (an undeclared field is still refused, a field cannot be both a penalty and passthrough, and the score-shaped-name check applies to it too). Declared fields come back on that item's entry under **`evidence`** — nested, so nothing can collide with a component name; absent entirely when none was declared or reported; present on a `null`-scored item and never on a dead agent. Each item counts against `maxAgents`. Contract, arithmetic and worked example: [`references/scored-checks.md`](${CLAUDE_PLUGIN_ROOT}/skills/craft/references/scored-checks.md). |
| `tasks[].redCommand` | `string` (optional) | Test-first gate that is **executed**, never asserted: a probe agent runs the string verbatim before the implementer — the JS requires a **non-zero** exit — and a second probe runs it after, where the JS requires **zero**. Three failure verdicts, each fails the task and puts its id in `tasksThatFlagged`: `red-unproven` (a probe died or was skipped, `exitCode: -1`), `red-not-red` (exit 0 before, so the test proves nothing), `green-not-green` (non-zero after). Must be **one invocation** — the shell operators `` ; & \| ` $ > < ( ) { } `` and newlines throw at arg-validation, because the probe runs the string with its own authority and a shell program can fabricate RED; flags and quotes are fine, a multi-step check goes in a script you name. Costs **2 agents** against `maxAgents`; no probe is dispatched under `readOnly`. `scoreTable` then carries `redGated`, `redProven`, `redUnproven`, `redNotRed`, `greenNotGreen`, and the return carries `red` — feed it back as `priorResults.red` so a carried task keeps its adjudication instead of re-reading as unproven. It does **not** close everything: the command loads code the implementer may control, so keep `writablePaths` narrow. Absent leaves every existing caller byte-identical. |
| `tasks[].redDisposition` | `string` (optional) | The filed reason a task carries **no** red gate — for work already complete, where any `redCommand` would be refused `red-not-red`. plan-lint accepts it INSTEAD of `redCommand` (both declared is `red-both-declared`, MAJOR; neither is `redcommand-missing`, MAJOR; empty/whitespace reads as absent), and dispatch echoes it verbatim. **Its content is never validated** — non-empty is the whole check; grading prose is the non-terminating shape. Inert to workflow.js: no probe, no agent, no score field. |
| `tasks[].dependsOn` | `string[]` (task ids, optional) | A **read ordering**: declare it when this task's `refs`, tests or inputs are files another task writes. IMPLEMENT then runs in waves — concurrent within a wave, waves in order. **Absent everywhere leaves every existing caller byte-identical**: one wave, `tasks[]` order. Refused at arg-validation, before any dispatch: a non-array or self-referencing value, an **unknown id** (a typo would silently drop the ordering it was written to enforce), a **cycle** (named with every id in it — a cycle means two tasks each need the other's output), and a wave whose tasks claim **overlapping `writablePaths`** (prefix-aware). An edge to a task outside `onlyTasks` is **satisfied, not unschedulable** — a prior run implemented it and its output is on disk, so refusing it would make every scoped re-run impossible. A `redCommand` still brackets its own implementer inside a wave, never a sibling's. |
| `tasks[].refs` | `string[]` (absolute paths) | Files the implementer must Read in full before working. Absent or `[]` injects nothing into the prompt. |
| `reviewLenses[].refs` | `string[]` (absolute paths) | The rules the lens judges against. **The lens is told to read them IN FULL; its refuters are only told the paths**, with an instruction not to open them unless the finding's own quoted evidence is insufficient (and to say so if they do). A lens is one agent doing open-ended reading; refuters are one agent *per finding*, so handing each the full ref set multiplies the run's largest read by the finding count. Absent or `[]` injects nothing either way. |
| `maxAgents` | `number` (default `50`) | Hard ceiling on the fan-out floor, checked at arg-validation. **Throws before any agent is dispatched**; the error names each dimension's count. Raise it deliberately, in the plan — see the sizing note above. |
| `refutersPerLens` | `number` (default `8`) | Cap on refuters dispatched per lens — the one fan-out term `maxAgents` cannot predict, since a lens returns as many findings as it finds. Findings are refuted **severity-first**, so the cap can never spend its budget on minors and drop a critical. Anything over the cap is reported as **submitted but not refuted** and **still stands** (`refuted: false`, with the reason saying so) — the same fail-closed rule a dead refuter gets, because in both cases no refutation happened. Never silently truncated. |
| `probeModel` | `string｜null` (default `'sonnet'`) | Model for the **probe** legs — `mechanical:*`, `red:*`, `third-party:*`. A probe runs a command and reports `{name, exitCode, output}`; the JS reads the exit code and no probe asserts a pass, so there is no judgement to downgrade and the session's top tier would be spent supervising a subprocess. Probes outnumber every other non-refuter leg on a check-heavy run. Pass `null` to inherit the session model. |
| `verifierModel` | `string｜null` (default `'sonnet'`) | Model for `verify:*`. A verifier judges ONE task against ONE stated acceptance criterion, with both the criterion and the evidence handed to it — bounded, like refutation, and one per task. Pass `null` to inherit. |
| `implementerModel` / `lensModel` | `string｜null` (default inherit) | Set **deliberately**; default inherit so no caller's gate weakens silently. `lensModel` is where a downgrade costs most — lenses are the open-ended readers that find what nothing else does, so a cheaper lens is a weaker gate rather than a cheaper one. Implementers write the artifact the whole gate then judges. |
| `refuterModel` / `refuterEffort` | `string｜null` (defaults `'sonnet'` / `'medium'`) | Model and reasoning effort for refuters only. Refutation is a bounded judgement against quoted evidence, not open-ended investigation, and refuters usually outnumber every other agent kind combined. Pass `null` to omit the key and inherit the session default — what a run wanting a maximally hard gate does. Lenses, implementers and verifiers are unaffected. |
| `authorityExtra` | `string` | Appended to the `AUTHORITY` block every dispatched agent receives — implementers, verifiers, lenses, refuters. Absent leaves `AUTHORITY` byte-identical. |
| `implementerAgentType` / `verifierAgentType` / `reviewLenses[].agentType` | `string` | Passed through as `agentType`. Use to pin a structurally read-only agent (`Explore` has no Edit/Write) for judges instead of trusting a prompt that says "modify nothing". Absent passes no key at all, so the dispatcher default applies. |
| `reviewLenses` | `[{key, prompt}]` | Whole-deliverable review lenses. Defaults to 2 (`criteria-vs-artifacts`, `scope-fidelity`) when absent **or empty** — passing `[]` does not disable review. Add one per named risk the defaults can't see; unfocused lenses mostly produce findings that get refuted. On a **scoped re-run** the set may be narrowed to the dispatch's blast radius — see the scoping rule above, whose three conditions (deterministic floor intact, scope recorded in the plan, no lens whose refs or subject changed) are what make it safe rather than a silent weakening. |
| `thirdParty` | `["codex"｜"gemini"]` | Advisory only — never enters the gate arithmetic. Supply only if the plan carries the opt-in line. |
| `freezeFindingSet` + `maxRounds` | `boolean`, `int` (default 3) | The fix loop's exit condition. **Do not hand-write either: `craft-redispatch.sh --dispatch` sets them** — see *The frozen finding set and the round cap*. Under the freeze a surviving *lens* finding of blocking severity goes to the return's `residue[]` and to `scoreTable.residue` instead of `survivingBlocking`; surviving `priorFindings` still gate, and the task and mechanical channels are untouched. |
| `onlyTasks` + `priorResults` | `string[]`, `{implemented, verified, red}` | Scopes a re-run after FAIL or human findings. **Do not hand-write these: `craft-redispatch.sh --dispatch` derives both** from the previous verdict — `onlyTasks` is `tasksThatFlagged` closed under **transitive dependents** (a carried "verified" downstream of a re-run task was earned against code that no longer exists), plus any task the verdict settles no `implemented`/`verified`/`red` record for; `priorResults` carries the rest. An absent, unreadable or unparseable previous verdict falls back to a full re-run and says so. `--full` opts out. **Carry `red` too** — a red-gated task carried without it re-reads as `redUnproven` and fails a verdict the previous run already settled. |

Every knob is read off the plan's **Run sizing** block — no line there means the default stands.
Choosing one at dispatch time changes the verdict without changing the bytes the user approved.

`mechanicalChecks` are **whole-deliverable**: they always run, including under `onlyTasks`, and are
never carried forward from `priorResults` — carrying an empty set forward would be a vacuous pass.

**`reviewLenses` may be scoped to a dispatch's blast radius — and only because `mechanicalChecks`
cannot be.** Running all lenses every round is the right *default*. But a re-run that rewrites one
test file still pays every lens to re-read tens of thousands of tokens of refs to re-decide a
question nothing touched, and the review phase does not shrink under `onlyTasks` at all — measured at
~34 agents of every ~45-minute round. So a scoped dispatch may run the subset of lenses whose
**judgement could have changed**, provided all three hold:

1. **The deterministic floor is intact.** Every `mechanicalCheck` still runs, unconditionally. Lens
   scoping trades some *judgement* coverage while keeping **all** deterministic coverage — that is
   the only reason it is safe, and it is void the moment a run also trims its mechanical checks.
2. **The scope is in the approved plan's Run sizing**, naming which lenses ran, which did not, and
   why. Deciding it at dispatch time is the weaken-the-gate-after-approval move this file forbids.
3. **A lens whose refs or subject changed is NOT scoped out.** If the dispatch edited a file a lens
   reads, or the rule it judges against, that lens runs.

`scoreTable.lensesRun` reports what was dispatched, so a scoped round is visible in the verdict
rather than inferred. **A dropped lens is not a clean lens** — render it as *n/a*, never as zero
findings.

### Plan review — computed, over the args, before anything is spent

**Plan review is the review of the inputs `workflow.js` will run**, and it is finished before
dispatch. No agent reads the plan markdown looking for defects: Phase 2's rule that every claim is a
`tasks[].acceptance` clause or a `mechanicalChecks` entry makes the args object *be* the plan, so
reviewing the args reviews the whole thing. The judged layer that once did this measured 20/16/17
findings with 8/8/9 surviving across three dispatches of one plan, **zero title overlap** between
consecutive rounds and zero artifacts built — every finding real, and the reviewed surface growing in
response to its own output.

`craft-dispatch.sh` enforces two tiers on the built args, before `args.json` is written; a blocking
finding exits 3 with the run still armed and every artifact byte-identical. Both run by hand too:

```
bun ~/.claude/skills/workflows/skills/craft/scripts/plan-lint.ts      <plan.md|args.json>
bun ~/.claude/skills/workflows/skills/craft/scripts/plan-preflight.ts <plan.md|args.json> --cwd <repo> [--only acceptance]
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
  never red. Every active task is probed at dispatch, *before any task runs* — so a gate pointing at
  a file a later task creates is refused too, and a run's failing tests must exist before it starts —
  author them before dispatching, which the guard permits because no task's `writablePaths` covers a
  suite that gates the run (one that did would be `self-gating-task`).
  **A suite that never loaded is `could-not-run`, not red**: a collection or import error means the
  surface under test does not exist, and a red that only proves that proves nothing about behaviour.

  Run by hand, `plan-preflight` decides on the exit code alone — `red-gate-already-green` (0),
  `gate-command-not-found` (127), `gate-timeout` (no status); it has no could-not-run classifier,
  which reads the probe's OUTPUT and lives only in `craft-dispatch.sh`'s `red_probe_gate`.
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
from the plan file. It runs IMPLEMENT, then VERIFY ∥ MECHANICAL ∥ THIRD-PARTY (blind per-task
verifiers + review lenses with adversarial refutation, alongside the deterministic probes and the
advisory external reviewers), and returns a **JS-computed gate**. IMPLEMENT runs in the waves
`dependsOn` declares.

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
discoveries in as `priorFindings`. Discovery gets the team; refutation and the gate stay outside it.

It also cannot run in this session: the guard denies the `Agent` tool outside its allowlist
(`Explore`, `Plan`, `librarian`, `codex:rescue`, `statusline-setup`, `plugin-dev:*`), so named
teammates are only spawnable inside a farm-out child. Run it through `farm-team.sh`, with **one
`--expect` per teammate**:

```bash
# --cwd places the LEAD; --expect resolves against the CALLER's cwd, so keep those absolute.
bash ${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts/farm-team.sh --cwd "$PWD" \
  --prompt-file "$PWD"/.craft/<run-id>/team.txt \
  --expect "$PWD"/.craft/<run-id>/findings/<lens>.json \
  --expect "$PWD"/.craft/<run-id>/findings/<other-lens>.json
```

**The file is the record, the message is the signal.** Teammate delivery is not fully reliable
(`.claude/rules/agent-teams.md`), so each teammate writes **exactly one** file to
`.craft/<run-id>/findings/<lens>.json` before going idle, holding a JSON array:

```json
[{ "title": "…", "severity": "critical|major|minor", "detail": "…", "file": "src/app.rs" }]
```

Omit `lens` — it is the filename, and the lead stamps it while concatenating `findings/*.json` into
`priorFindings`. **A teammate that found nothing writes `[]`**: that is what makes "found nothing"
distinguishable from "died", and it is the whole reason the file exists rather than the message.

**The file count is the runner's exit code, not the lead's diligence.** One `--expect` per teammate
makes `farm-team.sh` exit non-zero naming every findings file that is missing or empty. Do not start
Phase 4 on a non-zero exit — name the teammate to the user. Do not file the missing teammate as a
`priorFinding` either: entries there are refuted with *default to refuted when ambiguous*, and no
evidence in the tree can confirm a negative about an agent that is gone, so the run would read clean.

On the result:

- Render the score table and verdict to the user — including `scoreTable.tasksTotal`,
  `survivingMinor` (survived refutation but too minor to block) and `thirdPartyAdvisoryFindings`
  (advisory, never in the gate arithmetic). `scoreTable.mechanicalRun` / `mechanicalPassed` are `0/0`
  when the phase was skipped — nothing checked, not everything clean.
- `scoreTable.lensesRun` / `lensesReported` are lenses **dispatched** vs lenses that came back. When
  `lensesReported < lensesRun`, each missing one contributes a synthesized `critical` finding (title:
  *lens agent died or was skipped — this review dimension did not run*) attributed to its lens key,
  so it appears in `findings` and in `lensesThatFlagged`, and fails the gate. A lens that ran and
  found nothing is counted in `lensesReported` — silence from a dead lens is never read as clean.
- **Third-party findings are advisory**: file each as a task with model attribution (`[codex] …`).
  They never block. A `status: unavailable` leg is reported as such, not as clean.
- **On a `readOnly` run** `tasksJudgedThisRun`, `implementedDone` and `verifyPassed` are `null` — the
  dimension **does not apply**, nothing was dispatched along it. That is neither zero nor clean:
  render it as *n/a*, because a `0` printed beside real counts reads as "checked and clean".
  `tasksThatFlagged` is correspondingly `[]` by design, and **both verdicts go to Phase 5** via the
  findings file — a FAIL there is not a defect to fix (see the note under the fix loop).
- **FAIL** → the re-run selector is all three of `tasksThatFlagged`, `mechanicalThatFailed` and
  `lensesThatFlagged`. Consume all three. See below. **PASS** → Phase 5.

### The FAIL fix loop — three selectors, not one

`overallPass === false` ⟺ at least one selector is non-empty. The gate fails on three independent
dimensions and two of them own no task: neither a failing mechanical check nor a surviving lens
finding — a judgment about the whole deliverable — can appear in `tasksThatFlagged`, so an empty
selector on a failing run means "re-run everything", not "nothing to fix".

| selector | what it names | how you fix it |
|---|---|---|
| `tasksThatFlagged` | task ids that were not done, failed verification, or whose implementer/verifier never reported | fix the work, re-invoke with `onlyTasks: [<those ids>]` + `priorResults: {implemented, verified, red}` from the last run — dropping `red` makes every carried red-gated task re-read as unproven |
| `mechanicalThatFailed` | `{name, exitCode, output}` for each check whose exit code was not 0 | **re-run the CHECK, not a task.** Fix the underlying issue the command reported, then re-invoke with the same `mechanicalChecks` — they always re-run, including under `onlyTasks`, so no extra selector arg is needed |
| `lensesThatFlagged` | distinct `lens` keys of findings that survived refutation (`findings[]` carries the detail) | **re-run the LENS, not a task.** Fix what the finding reported, then re-judge by re-invoking with those lenses still in `reviewLenses` — a lens judges the whole deliverable, so it re-runs on every invocation and needs no extra selector arg |

So a FAIL is handled as: fix the work behind `tasksThatFlagged`, fix whatever each entry in
`mechanicalThatFailed` reported (`exitCode: -1` means the probe died or was skipped — unchecked,
never passed), fix each surviving finding and let its lens in `lensesThatFlagged` re-judge it, then
re-invoke with `onlyTasks` scoped to the flagged ids **and** the unchanged `mechanicalChecks` and
`reviewLenses`. If all three selectors are empty on a FAIL, that is a bug in your reading of the
result — re-run everything. **A defect in the PLAN is not a gate verdict**: it is caught by tiers 1
and 2 before dispatch, and the remedy is to amend the plan file, re-hash it (`--spec-hash`) and
re-dispatch — amending by **REPLACEMENT, never accretion**, since a plan that grows every round
manufactures new surface for the next one. `plan-lint` computes this: a `work` cell carrying more
than one `ROUND <n>` marker is a MAJOR (`work-accretion`), and a tier-1 MAJOR refuses the dispatch.

### The frozen finding set and the round cap

**"This round's lenses raised nothing" is not an exit condition.** Findings never repeat between
rounds and generation does not fall as fixes land, so that test is a draw from a constant-rate
generator — see `references/convergence.md`. The exit condition is instead **"is the round-1 blocking
set closed?"**, which is finite and shrinks.

`craft-redispatch.sh --dispatch` implements it; do not hand-wire any of it:

- On the advance to **round 2** it carries the previous verdict's surviving blocking findings into
  `priorFindings` and sets `freezeFindingSet`. **Once** — never re-derived, or the carried set tracks
  the generator instead of freezing against it. Each entry is adversarially refuted every round, so a
  fixed finding is one the refuter can now refute; that is what "closed" means.
- From round 2, a fresh **lens** finding is reported as `residue` and does not gate. It is real and it
  is not lost — it is the input to a follow-up run's `priorFindings`.
- `maxRounds` **defaults to 3**. The dispatch that would exceed it exits 4, spends no round, rotates
  no result and prints what is still open as a paste-ready `priorFindings` block. Another round after
  that is a human's decision (add `"maxRounds": <n>` to `args.json`), not the loop's.
- At round ≥ 3, or when the run dir's oldest archive is over 2 h old, it prints
  `scripts/converge-check.ts` — a computed diagnosis over the run's own `result-round*.json`
  (blocking sequence, generation slope, repeat rate, deliverable-vs-gate split, accretion markers).
  **Advisory**: it explains why a run had to be stopped, it does not stop one. Run it by hand any
  time: `bun ~/.claude/skills/workflows/skills/craft/scripts/converge-check.ts <run-dir> [--json]` — exit 0
  CONVERGING, 1 NOT CONVERGING with reasons, 2 too short to judge.

### Text-only findings: fix inline, confirm with `readOnly`

When **every** surviving finding is a text defect in an already-built artifact — a doc that
contradicts the code, a command template that is wrong as written — re-dispatching implementers
rebuilds finished work to re-judge a few sentences. Instead:

1. **Fix the text inline.** The orchestrator may edit it; no implementer is needed.
2. **Verify each finding directly**, by the evidence the finding itself names — diff the two files,
   run the corrected command and show its exit code. Not "it looks right now".
3. **Confirm with a `readOnly` re-judge, sized to the fix — ONE reader, not the fleet.**
   `readOnly: true`, `tasks: []`, the unchanged `mechanicalChecks`, and **a single lens scoped to the
   findings that were fixed and the text that changed**: does each named defect actually close, and
   did the edit introduce a new contradiction? Record it in the plan's Run sizing and re-hash — the
   gate changed shape, so the user's approved sizing must say so.

   Do **not** re-run the whole `reviewLenses` set: four lenses plus refuters is up to ~40 agents to
   confirm a few sentences, against ~10 for one scoped lens and the probes. Refutation stays at full
   strength on that one lens — the cap is what makes an unrefuted finding stand. The probes stay
   dispatched rather than run inline: the JS gates on a probe's exit code, and an orchestrator running
   its own checks is back to self-report.

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

```bash
# 30-minute timeout; NEVER run_in_background; NEVER relaunch on timeout (the TUI is still open)
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/human-review-gate.sh -w --no-update-check
# or: -r <range> / pr <N> per the plan's review surface
```

### The read-only path — review the findings file, not the tree

A `readOnly` run changes no files, so `-w` opens an empty diff and tuicr returns `unreviewed`, which
the table below calls *not approval*. So on a `readOnly` run the orchestrator **first writes
`.craft/<run-id>/findings.md` from the object `workflow.js` returned**, then reviews that file:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/human-review-gate.sh \
  --file .craft/<run-id>/findings.md --no-update-check
```

The orchestrator writes it because **a Workflow script cannot**: its sandbox has no filesystem and no
Node API — the hooks are `agent`/`parallel`/`pipeline`/`log`/`phase`/`workflow`/`args`/`budget`.
(`human-review-gate.sh` forwards its args verbatim to tuicr, so `--file` needs no script change.)

`.craft/` is gitignored, so this file does not survive the machine. **A findings document worth
keeping must be moved somewhere tracked** — say so to the user when the audit found anything.

### What the findings file must contain — transcription, not judgement

The agent writing this file is the agent that ran the audit. If it summarises in its own voice, the
audit becomes self-reported — exactly the pattern the gate exists to prevent, reintroduced one step
after the gate. So: counts come from `scoreTable` verbatim, findings from `findings[]` verbatim, the
verdict from `verdict`. **Organise; do not grade.**

| section | source | rule |
|---|---|---|
| verdict + one-line scope | `verdict`, `judged` | verbatim |
| coverage | `scoreTable.lensesRun` vs `lensesReported` | **name every lens that did not report.** A missing dimension is not a clean one, and omitting it is silence that reads as clean |
| refutation | `scoreTable.lensFindings` and `refuted` | both numbers, so the kill rate is visible: 14 findings / 0 survivors is not the same run as one that found nothing |
| surviving findings | `findings[]` (already filtered to `!refuted`) | grouped by severity, each carrying its `lens` |
| refuted findings | `refuted[]` | title + `refuteReason` — kept, not dropped |
| mechanical | `mechanical[]` | `name`, `exitCode`, `output` |
| not checked | the plan's scope vs what actually ran | explicit, not omitted |

Blocks until the user quits tuicr, then prints one verdict JSON:

| verdict | meaning | action |
|---|---|---|
| `approved` | files marked reviewed, no new notes | clear goal, clean `.craft/`, done — offer commit/ship |
| `findings` | new human annotations | tactical loop below |
| `rejected` | a note contains `REJECT`, or PR is request-changes | strategic loop below |
| `unreviewed` | opened-and-quit, nothing touched | **not approval** — ask the user what they want |

**Tactical loop (findings, plan unchanged):** convert each comment to a task; fix via
workflow.js re-run scoped with `onlyTasks` (or directly for one-liners, then still re-verify via
the workflow); reply to each annotation in-session:
`tuicr review add --username "Claude" --session <slug> --target-file <path> --line <n> "<reply>"`;
relaunch the gate script.

**Strategic loop (REJECT):** the interpretation was wrong, not the execution. Clear the goal,
keep `.craft/<run>/` as provenance, start a fresh run-id, return to Phase 1 CLARIFY with the
rejection notes as input. **Cap: two rejections** → stop, summarize both misses, and escalate/
descope with the user rather than guessing a third time.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Trivial edit (one file, obvious) | run the full loop | say it's overkill; just do it |
| Verifier needed for a task | let the implementer self-certify | separate verifier agent, blind to the report |
| Task is test-first | let the implementer report "RED confirmed", or make RED a review lens | give the task a `redCommand` — probes execute it on both sides of the implementer and the JS reads the two exit codes. A lens runs after the work and structurally cannot observe RED |
| Sizing not in the approved plan | pick lenses/checks at dispatch time | it shapes the gate — put it in the plan, re-hash, then dispatch |
| Tasks feel like they could run in parallel | fan out implementers yourself, or give each a worktree | declare `dependsOn` and let IMPLEMENT wave them — concurrent within a wave, and arg-validation refuses a wave whose `writablePaths` overlap, so safety is checked rather than trusted. Worktrees stay out: `workflow.js` cannot merge them (no filesystem), and a merge agent's silent slip reads as an implementer's omission |
| A task reads a file another task writes | rely on `tasks[]` array order | array order is not a contract the script enforces — declare `dependsOn: ['<id>']`. An unknown id and a cycle both throw before dispatch; an edge to a task outside `onlyTasks` is treated as satisfied, since a prior run put its output on disk |
| `goal-self-send.sh` exits non-zero | retry it, or stall the run | not fatal — proceed; the loop is written down, it just needs the user to prompt each step |
| Session opens on `Implement the following plan:` | implement it in the main thread | the context was cleared at approval — this is Phase 4, not the work. `craft-dispatch.sh` needs nothing you lost. Same answer when an Edit is denied for an armed run |
| Just self-sent the goal | dispatch Phase 4 in the same turn | stop — our own queued message can't be read until the turn ends; the `/goal` turn is Phase 4 |
| Goal condition names a file check | `/goal the tests in the plan pass` | the evaluator reads only the transcript — phrase it as a verdict that gets printed |
| Recon would flood the conversation | read every file into this context | scout with a subagent during CLARIFY/PLAN — graded work still goes through workflow.js |
| One small task, workflow feels heavy | dispatch a lone subagent and accept its report | still workflow.js with one task — a self-report is not a verification |
| Tasks look like they need to talk to each other | reach for agent teams | **On a run that writes, no teams** — for the mechanical reason given under *IMPLEMENT runs in waves* above, not as a style preference. Tasks needing to talk means the plan under-specifies the boundary; fix the task table, re-hash. **The ban does not apply to `readOnly`**, where nothing writes and a team is the default (CLARIFY axis 7); see *Where the agent team lives* |
| Fan-out estimate > ~50 agents | widen the workflow anyway | split into sequenced craft runs, one gate each |
| Third-party found a "critical" | let it flip the gate | file as advisory task; gate stays JS-only |
| Treating tasksThatFlagged as the whole selector | re-run only the flagged task ids — or, if that list is empty on a FAIL, conclude there is nothing to fix | **The selector has three dimensions and only one of them owns tasks.** A failing mechanical check and a surviving lens finding each own no task, so neither can appear in `tasksThatFlagged`; an empty selector on a failing run means "re-run everything". Consume all three — `tasksThatFlagged` **and** `mechanicalThatFailed` **and** `lensesThatFlagged`. **On a `readOnly` run `tasksThatFlagged` is `[]` by design** (no task channel exists), so there the selector is the other two and at least one is guaranteed non-empty on a FAIL |
| A mechanical check failed | re-run the task nearest to it, or drop the check | fix what the command reported and re-invoke with the same `mechanicalChecks` — a failed check re-runs the CHECK |
| A lens finding survived refutation | hunt for the task to blame, or re-run everything | `lensesThatFlagged` names the lens; fix what `findings[]` reported and let that lens re-judge — a surviving finding re-runs the LENS |
| A `scoredChecks` composite comes back low | add a threshold or `blockBelow` so it fails the run, or read the score into some other gate | no such knob exists and adding one is not a configuration choice this parameter left open — gating on a composite chases redundancy minors. Read the score; gate on `mechanicalChecks` and on `critical｜major` lens findings, which can be wrong in only one direction |
| `mechanicalRun: 0` in the score table | read it as "mechanics clean" | the phase was skipped; nothing was checked |
| `lensesReported < lensesRun` in the score table | read the missing lens's zero findings as a clean dimension | that lens never ran; the gate synthesizes a `critical` finding for it and fails. Re-run it — an unreviewed dimension is not a reviewed one |
| tuicr quit with 0 comments, 0 reviewed files | treat as approval | `unreviewed` — ask the user |
| Phase 5 on a `readOnly` run | `-w` over a tree nothing wrote to | there is no diff, so that always returns `unreviewed` — write `.craft/<run-id>/findings.md` and review it with `--file`, per *The read-only path* |
| A `readOnly` run returned FAIL | send it to the fix loop | that is the audit's successful outcome — it found defects. Take it to Phase 5; fixing is a separate writing run with its own plan and gate |
| PR review surface mid-loop | push new commits to the branch | don't — tuicr sessions key on head_sha; finish the loop first |
| Plan edited after approval | keep going | agents will halt on hash mismatch anyway — re-hash and restart Phase 4. `scripts/craft-redispatch.sh <plan> <args.json> [--dispatch] [--full] [--no-lint] [--no-red-probe]` does the re-hash, refuses when the args name a different plan, and rotates a stale `result.json` so a previous verdict cannot be read as this run's. With `--dispatch` it runs both dispatch gates on the final args and exits 3 on a major/critical or a refused red probe, and exits 4 past `maxRounds`, spending no round and rotating nothing in either case |
| Review phase dominates every round | drop lenses, cheapen `lensModel`, or cut `refutersPerLens` | scope the lens SET to the dispatch's blast radius, recorded in the plan — the deterministic floor keeps running, so you trade judgement coverage and keep all mechanical coverage. Cheapening the lens model buys a weaker gate, not a cheaper one, and cutting refuters multiplies the survivors you then verify by hand |
| A lens ref is huge and slow to read | distil it into a summary ref | a condensed copy of craft's doctrine drifts and is what `spine-fidelity` exists to catch — the optimisation flags itself. Scope how often the lens runs; never fork what it reads |
| The plan looks wrong and you want an agent to review it | dispatch a lens that reads the plan markdown and blocks on what it finds | that loop does not terminate — the fix for round *n* is new surface round *n+1* finds real defects in (see *Plan review*). Plan review is `plan-lint.ts` + `plan-preflight.ts` over the args, and anything a reader would have caught belongs there as a rule |
| An acceptance clause already passes at baseline | ship it — the criterion holds | `acceptance-green-at-baseline`: nothing distinguishes "the work landed" from "the work was never started". Give the task a `redCommand`, or state a clause the work has to make true |
| Red gate is `grep -q <thing that should not exist>` | call it red because it exits 1 | that is `could-not-run` — no test framework ran. A red gate must produce real test output; write the assertion as a test |
| workflow.js throws on args | patch args from memory | re-derive from `.claude/plans/<slug>.md` |
| `.claude/plans/<slug>.md` doesn't resolve | copy the plan in from `~/.claude/plans/`, or dispatch the path anyway | resolve the real path and hash it there — plan mode fixes the plan's path at entry, so a session predating the `plansDirectory` setting still writes to `~/.claude/plans/`. Set the setting for next session; never copy (two files drift), never dispatch a path you haven't confirmed resolves |
