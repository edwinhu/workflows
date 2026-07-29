---
name: ds-implement
description: "Phase 3 of the /ds workflow — analysis task execution. Invoked by the ds-plan chain; not user-invocable."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Skill, TodoWrite, Agent
hooks:
  PostToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-post-subagent-guard.ts"
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-pre-subagent-clear.ts"
    - matcher: "Read"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Grep"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Glob"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.ts"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.ts"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.ts"
    - matcher: "Write|Edit|Agent|Workflow"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_DESCRIPTION="Plan review"
            GATE_REMEDY="Return to ds-plan and run ds-plan-reviewer; implementation is gated until PLAN.md is APPROVED."
            GATE_BLOCKED_TOOLS=Write,Edit,Agent,Workflow
            bun ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.ts
---

## Overview

Apply output-first verification at every step of analysis implementation. This is Phase 3 of the `/ds` workflow.

## Contents

- [The Iron Law of DS Implementation](#the-iron-law-of-ds-implementation) - EVERY step MUST produce visible output
- [Delegation](#delegation) - Main chat orchestrates, subagents analyze
- [What Output-First Means](#what-output-first-means)
- [Output-First Facts](#output-first-facts)
- [SAS Language Routing](#sas-language-routing) - Load SAS enforcement when PLAN.md specifies SAS
- [Implementation Process](#implementation-process)
- [Verification Patterns](#verification-patterns) - See `references/verification-patterns.md`
- [Common Failures](#common-failures-to-avoid)
- [Gate: Exit Implementation](#gate-exit-implementation)

# Implementation (Output-First Verification)

Implement analysis with mandatory visible output at every step.
**NO TDD** - instead, every code step MUST produce and verify output.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Implementation

**EVERY CODE STEP MUST PRODUCE VISIBLE OUTPUT. This is not negotiable.**

Before moving to the next step, you MUST:
1. Run the code
2. See the output (print, display, plot)
3. Verify output is correct/reasonable
4. Document in `.planning/LEARNINGS.md`
5. Only THEN proceed to next step

This applies even when YOU think:
- "I know this works"
- "It's just a simple transformation"
- "I'll check results at the end"
- "The code is straightforward"

**If you're about to write code without outputting results, STOP.**

### The step's output MUST include its DQ line

"Visible output" means the numbers a reader needs to judge the step, not just
that it ran. Every step that filters, joins or aggregates emits the checks from
`references/ds-checks.md` that apply to it — **inline, as the step runs** — not
deferred to a validation phase that may never reference them.

```python
# after every filter / join / aggregate:
print(f"[DQ] {name}: {n_before:,} -> {n_after:,} rows ({100*(n_after-n_before)/n_before:+.1f}%)")
print(f"[DEN] rate={n_flag:,}/{n_base:,}={100*n_flag/n_base:.3f}%  base={100*n_base/n_total:.1f}% of rows")
print(f"[ENUM] ran: DQ1 DQ3 DQ4 UNI  |  N/A: DQ6 (no before/after shape here)")
```

**A check that exists but is never invoked is worth nothing.** The failure this
prevents is not a missing check — it is a documented one that nothing calls:

> A pipeline's own SKILL.md instructed that timed runs include the detector sweep.
> No script referenced the detector module, so every runtime ever published
> described a dataset of unmeasured quality. When finally wired, the sweep ran 7
> of 17 available detectors; four of the remaining ten fired on first execution,
> one of which had been diagnosed by hand, days earlier, as a novel finding.

So the scaffold **generates the invocation**, not a note asking someone to add it.
If a step cannot emit a DQ line, say which check is N/A and why (see ENUM) —
silence is indistinguishable from a pass.
</EXTREMELY-IMPORTANT>

## Delegation

<EXTREMELY-IMPORTANT>
**YOU MUST NOT WRITE ANALYSIS CODE IN MAIN CHAT. This is not negotiable.**

You **COMPILE** the hardened PLAN.md Task Breakdown into a lean, project-specific runner
(`.planning/run.js`), then **RUN** it. The compiled runner topo-sorts the data-flow DAG, runs
independent tasks **in parallel**, gates each on its `Verify` exit code (an independent probe — never
self-report), and **pauses** at decision points (planned `⏸ PAUSE:` markers and runtime R4 blocks),
returning control to you with the data the human needs. You drive compile + the run/pause loop; the
runner's implementers do the analysis/ETL. **There is no per-level round-trip and no LLM re-parse of
PLAN.md** — the compile is deterministic (`ds_compile.py`), so PLAN is parsed exactly once.

```
0. Set the goal (once): /goal All tasks in PLAN.md are marked [x], each task's Verify
   assertion exits 0, and .planning/VALIDATION.md status is `validated`. Stop after [N] turns.

COMPILE (once; re-run only when PLAN.md changes):
  Resolve the compiler (cache first, repo fallback) and emit the runner:
    CC=$(command ls -d ~/.claude/plugins/cache/*/workflows/*/scripts/ds/ds_compile.py 2>/dev/null | sort -V | tail -1)
    [ -z "$CC" ] && CC="${CLAUDE_SKILL_DIR}/../../scripts/ds/ds_compile.py"
    uv run python3 "$CC" .planning/PLAN.md --project "$(pwd)"        # → .planning/run.js
  (Deterministic, no LLM. Fails loudly if the table is not compilable — fix PLAN.md and recompile.)

LOOP (under the active /goal), carrying decisions across pauses:
  1. r = Workflow({ scriptPath: "<abs cwd>/.planning/run.js",
                    resumeFromRunId: <prev runId, if resuming>,
                    args: { projectDir: "<abs cwd>",
                            decisions: { <taskId>: "<human's call>", ... },   // grows each pause
                            clearedPauses: [ <taskIds already decided> ],
                            onlyChecks: [ <task ids to force re-run>, ] } })   // optional
     → the runner runs to the next pause point or to completion. Outputs are already on disk.
       Returns { returnReason, pauseKind?, atTask?, payload?, overallPass, tasksRemaining,
                 tasksThatFailed, findings, reviews, scoreTable }.
       returnReason ∈ { 'done' | 'hard-fail' | 'pause-human' | 'yield-for-recheck' }. SWITCH on it:
  2. If returnReason === 'pause-human':  present r.payload (the decision + the implementer's deviation
       notes + key numbers) to the user. Get the call, then ROUTE BY pauseKind + DECISION TYPE:
       - DECLARED pause (pauseKind="declared") approved as-planned: add atTask to clearedPauses,
         re-invoke (step 1) to resume past it.
       - R4 / dynamic pause (pauseKind="R4") — TWO kinds of decision, route correctly:
           • GATE-CHANGING (the resolution changes the GRAIN / KEY / SCHEMA — i.e. the Verify
             assertion ITSELF must change): EDIT PLAN.md's Verify (+ any affected Outputs/Expected
             cells) to encode the decision, then RE-COMPILE run.js, then re-run. `args.decisions`
             ALONE is INSUFFICIENT here — the implementer will (correctly) RE-BLOCK on the stale
             gate. This is the muni reality: resolving the grain to `+seqno` meant EDITING the
             assertion, not just telling the implementer. (For a methodology pivot that reshapes the
             plan, hand back to ds-plan to edit, then recompile.)
           • BEHAVIOR-ONLY (winsor scope, sample nuance the Verify does NOT assert — gate unchanged):
             re-invoke with decisions[atTask]=<the call>; no PLAN edit needed.
       - BACKSTOP: if you mis-route a gate-changing decision as behavior-only, the implementer
         re-blocks on the stale gate (`status="blocked"`, "Verify must be updated") — it fails LOUD,
         not silent. Re-route to the PLAN-edit path. Never edit the data to satisfy a stale gate.
  3. If returnReason === 'done' (always overallPass):  GROUND-TRUTH — run ds-validate-coverage
       (per-requirement coverage / no-regression; the runner's per-task Verify ran in isolation). Then
       mark the PLAN rows [x], log to LEARNINGS.md, write IMPLEMENT_COMPLETE.md, proceed to ds-validate.
  4. If returnReason === 'hard-fail':  read r.findings, fix the cause (in PLAN.md / the code via a
       fresh runner invocation), re-invoke with onlyChecks=r.tasksThatFailed.
     (ds emits no 'yield-for-recheck'; ds-validate-coverage runs once at step 3, OUTSIDE the runner.)
```

The per-task implementer protocol (output-first, deviation rules R1–R4, ETL enforcement) lives in the
fragment's implementer prompt (`workflows/templates/ds-task.js`, spliced into the shared `run-core.js`); `ds-delegate` remains for
ad-hoc single-task dispatch outside this phase. **If you're about to write analysis code directly,
STOP — the runner's implementers do that, and `ds-no-main-chat-code-guard` forbids you (you may only
touch `.planning/`).**

### Delete & Restart Protocol

| Scenario | Action |
|----------|--------|
| You wrote > 3 lines of analysis code in main chat | DELETE immediately. Restart via Task agent. |
| You ran a cell, realized it should have been in Task agent | DELETE the cell output and cell. Re-do via Task agent. |
| You started a transformation in main chat | STOP. DELETE what you've done. Spawn Task agent instead. |
| "Just finish this quick analysis here" | STOP — if it's quick enough to finish, it's quick enough for a Task agent. Delete and restart. |

**Helpfulness Check:** If you kept main-chat code "because it worked," you bypassed the orchestration protocol. Working code written in the wrong place skips verification and review — it is anti-helpful to the user. Delete it.
</EXTREMELY-IMPORTANT>

## What Output-First Means

| DO | DON'T |
|-------|----------|
| Print shape after each transform | Chain operations silently |
| Display sample rows | Trust transformations work |
| Show summary stats | Wait until end to check |
| Verify row counts | Assume merges worked |
| Check for unexpected nulls | Skip intermediate checks |
| Plot distributions | Move on without looking |

**The Mantra:** If not visible, it cannot be trusted.

### Output-First Facts

- "The merge worked fine" without printed numbers is an unverified claim — show the counts, compared against `.planning/PLAN.md` expected output.
- Combined operations hide which step failed: when the error surfaces at the end, the root cause is buried under every later transform and cannot be isolated. One operation per verification cycle.
- A "COMPLETE" logged in `.planning/LEARNINGS.md` without verified output is a false claim that review inherits — the task may have silently failed, and the user acts on results that don't exist. Logging a verified completion takes 30 seconds; an unlogged step is invisible to review.
- An agent's summary can gloss over errors its full output reports — deferring the read means running blind. Read agent output immediately and verify claims against the actual data.


## Implementation Strategy: derived from the DAG, not chosen

**Do NOT ask the user sequential-vs-parallel.** The compiled runner derives parallelism from the
`Deps` DAG: tasks in the same dependency level (no path between them) run concurrently via
`parallel()`; dependent tasks serialize. Independent branches (e.g. muni T2 ∥ T5) parallelize
automatically; a clean pipeline (clean → merge → aggregate → model) serializes automatically. There
is no manual agent-team reconciliation to manage — each task writes its own declared `Outputs` and is
gated independently. Your job is COMPILE then the run/pause loop above.


## SAS Language Routing

If PLAN.md specifies `Implementation Language: SAS` or `Mixed`, load SAS enforcement BEFORE dispatching any SAS tasks. Paste the enforcement block into every SAS subagent prompt.

> **Full SAS enforcement rules:** See [references/sas-enforcement.md](references/sas-enforcement.md)

## Implementation Process Flowchart

```
┌──────────────────────────────┐
│ COMPILE (once, deterministic) │   ds_compile.py PLAN.md → .planning/run.js
│ no LLM; fails if not compilable│
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐◄────────────── resume (clearedPauses + decisions) ──┐
│ RUN  Workflow(scriptPath=     │                                                    │
│      .planning/run.js)        │   runner: topo-sort DAG → run each level's tasks   │
│                               │   in parallel, output-first; gate each on its      │
│                               │   Verify exit code via an independent probe        │
└───────────────┬──────────────┘                                                    │
                ▼                                                                    │
        ┌───────────────┐                                                            │
        │ rr='pause-human'│ yes ─▶ present r.payload (decision + deviations + nums)  │
        └──────┬────────┘            │                                               │
               │ 'done'              ├─ APPROVE ─▶ clearedPauses+=atTask; ───────────┘
               ▼                     │            decisions[atTask]=answer
        ┌───────────────┐            └─ METHODOLOGY change ─▶ ds-plan edits PLAN ─▶ RE-COMPILE
        │ rr='done'?     │     ('hard-fail' ─▶ read findings, fix, onlyChecks, re-run)
        └──────┬────────┘
               │ (always overallPass)
               ▼
┌──────────────────────────────┐
│ GROUND-TRUTH: ds-validate-    │   per-requirement coverage / no-regression
│ coverage → mark PLAN rows [x] │
│ → IMPLEMENT_COMPLETE.md       │
└───────────────┬──────────────┘
                ▼
        Invoke ds-validate
```

**This flowchart IS the specification.** If the narrative below and this flowchart disagree, the
flowchart wins. The runner's per-task discipline (output-first, deviation rules R1–R4, ETL
enforcement) is carried in the template's implementer prompt; the sections below describe that
discipline (what each implementer does) — they are NOT a separate main-chat dispatch loop.

## Topic Change Protocol

**If user sends an off-topic message during implementation, follow C6 from ds-common-constraints.md:**

1. **Announce:** "Pausing ds-implement to address your request."
2. **Handle:** Process the request (normal tools allowed outside the loop).
3. **Announce:** "Resuming ds-implement. Reading state files for current progress."
4. **Reload:** Read LEARNINGS.md and PLAN.md to restore context.
5. **Resume:** Continue from where you left off.

**Do NOT silently switch context. Silent switches kill the implementation loop.**

## Implementation Process

### Step 1: Read Plan, Load Shared Enforcement, then COMPILE

Auto-load all constraints matching `applies-to: ds-implement`:

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts ds-implement`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

```
Read(".planning/PLAN.md")
```

Then run **COMPILE** (see the Delegation block above) to emit `.planning/run.js`, and drive the
run/pause loop. You do NOT dispatch per-task agents from main chat — the compiled runner does, using
the output-first protocol embedded in its implementer prompt (the `ds-delegate` template). Load
`ds-delegate` only for ad-hoc single-task work outside this phase.

**ETL Strategy Enforcement — these PLAN.md decisions ride into the runner's implementer prompts:**

If PLAN.md contains an `## ETL Strategy` section, the user made decisions during planning that MUST be enforced during implementation. Check each subsection and load the corresponding enforcement:

| PLAN.md Section | Enforcement Reference | Inject Into |
|-----------------|----------------------|-------------|
| `row_pk` / `event_key` declared (any data with a grain) | ETL enforcement (`skills/ds-implement/references/etl-enforcement.md`) § Key & Grain Carry-Through | Every data load/transform subagent prompt |
| `Filters & Parameters` table present | parameter-transparency: reference the named config location by name, NO inline literals (see [Parameter Centralization](#parameter-centralization-no-inline-literals)) | Every subagent prompt that filters/caps/winsorizes/windows data |
| `Implementation Language: SAS` or `Mixed` | SAS ETL enforcement (`skills/wrds/references/sas-etl.md`) | Every SAS subagent prompt |
| `Filter Strategy` table present | ETL enforcement (`skills/ds-implement/references/etl-enforcement.md`) § Filter Push-Down | Subagent prompts for data loading tasks |
| `Parallelism Plan` table present | ETL enforcement (`skills/ds-implement/references/etl-enforcement.md`) § Parallelism | Implementation strategy choice |
| `Data Flow` with intermediates | ETL enforcement (`skills/ds-implement/references/etl-enforcement.md`) § Caching | Subagent prompts for tasks producing/consuming intermediates |
| `Scale-Up Testing Plan` table present | ETL enforcement (`skills/ds-implement/references/etl-enforcement.md`) § Scale-Up + domain reference (e.g., `gemini-batch/references/scale-up-testing.md`) | Before any batch submission task |

**To load these references, discover the plugin cache path first:**
- Read `${CLAUDE_SKILL_DIR}/../../skills/wrds/references/sas-etl.md` and follow its instructions.
- Read `${CLAUDE_SKILL_DIR}/../../skills/ds-implement/references/etl-enforcement.md` and follow its instructions.

**If PLAN.md has NO ETL Strategy section:** Skip this — proceed directly to Step 2.

### Context Monitoring

Before starting each task, check context availability:

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed with task |
| Warning | 25-35% | Complete current task, then invoke ds-handoff |
| Critical | ≤25% | Invoke ds-handoff immediately — no new tasks |

**At Warning level:** After current task completes, invoke:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-handoff/SKILL.md` and follow its instructions.

**Why:** A multi-task analysis pipeline with 20% context remaining produces degraded output. Better to handoff cleanly and resume fresh.

### Step 2: Run the compiled runner (it executes the tasks)

You do not dispatch per task. Each iteration of the run/pause loop:
1. `Workflow({ scriptPath: ".planning/run.js", args: {...} })` runs the next slice of the DAG —
   the runner produces each task's `Outputs`, then an independent probe gates it on the `Verify`
   exit code.
2. On `returnReason==='pause-human'`, present the payload and resolve the decision (APPROVE → resume;
   methodology → edit PLAN + recompile). On `'hard-fail'`, fix the cause and re-run with onlyChecks.
3. On `returnReason==='done'`, run ds-validate-coverage (ground truth) and log per-task results to LEARNINGS.md.

### Step 3: Log to LEARNINGS.md

Document every significant step:

```markdown
## Task N: [Description] - COMPLETE

**Input:** [Describe input state]

**Operation:** [What was done]

**Output:**
- Shape: [final shape]
- Key findings: [observations]

**Verification:** [How you confirmed it worked]

**Next:** [What comes next]
```

### Task Summary (MANDATORY after each task)

After a task passes review, append a structured summary to LEARNINGS.md:

```yaml
## Task N: [task description]

---
task: N
status: completed
implements: [DATA-01, STAT-03]
affects: [notebooks/analysis.py, data/processed/]
key-files:
  created: [list of new files]
  modified: [list of changed files]
deviations: {r1: 0, r2: 1, r3: 0, r4: 0}
---

One-liner: [SUBSTANTIVE summary — not "Task complete" but "Merged CRSP-Compustat panel with winsorized returns at 1%/99%"]

Changes: [what was added/modified and why]
Output: [output files produced and their contents]
```

**One-liner rule:** Must be SUBSTANTIVE. Good: "Panel regression with firm and year FE, clustered SEs, 3 robustness checks". Bad: "Completed task 3".

## Dataset Construction Diagram (Maintain As You Build)

If PLAN.md has a `## Dataset Construction Diagram` (the master-datasets mermaid flowchart: raw → merges → filters → master datasets → exhibits), it is a **required doc deliverable** the pipeline must keep current. PLAN.md's diagram is the *intended* construction; the docs carry the construction that *actually ran*.

- After a master-build task lands, update the diagram in the analysis docs (e.g. `docs/INVESTIGATION` or the analysis README/notebook header) with the real merge keys and the actual row-drops each filter produced (the profiled numbers, not the planned estimates).
- If the built pipeline diverges from the plan (an extra filter, a different join key, a master split in two), update the diagram AND note the divergence in LEARNINGS.md. A stale diagram that contradicts the code is worse than none — the reader trusts the picture over the script.
- Keep master nodes as `[(rounded)]` and label every edge with its key or filter+row-drop. An edgeless box diagram hides the sample funnel, which is the one thing the diagram exists to show.

This is cheap to edit per-task and expensive to reconstruct from memory at write-up time. The final diagram is what ds-handoff records and ds-review checks against the code.

## Parameter Centralization (No Inline Literals)

If PLAN.md has a `## Filters & Parameters` table, it names a single config location (default: a plain `src/config.py` of named constants with rationale in inline comments). Every task subagent MUST read parameters from that location by name and write **NO inline numeric literals** for any analysis decision — filters, bands, caps, winsorization levels, date windows, min-obs counts.

- **Inject the config-location instruction into every implementation subagent prompt:** "All filter/threshold/cap/window values come from `<config location>` referenced by name. Do NOT hard-code numeric literals for analysis decisions — if a value you need is missing from the config, ADD it there (with a Filters & Parameters row), don't inline it."
- `df[df.price > 100]` is a magic number; `df[df.price > MIN_PRICE]` is correct. Loop indices, unit conversions (`* 100` for percent), and array offsets are not parameters — leave them inline.
- When a task introduces a new parameter not in the inventory, the subagent ADDS it to the config location AND appends a row to the `## Filters & Parameters` table (constant · value · applied in · rationale/source · principled? · disposition). A new convenience (⚠) parameter needs a disposition (robustness panel / verified-redundant / display-only) — log it for ds-review; principled (✓) requires a cited source or a validation result.
- A scattered literal is a `[Rule 2 - Missing Critical]` deviation: centralize it (move to config, reference by name), verify the output is unchanged, and track it.

A magic number that reaches the final pipeline is a replication landmine the reviewer will flag — centralizing as you write costs one import; retrofitting after literals scatter costs an audit pass (the exact rework Edwin's muni magic-numbers audit is paying down).

## Verification Patterns

See [references/verification-patterns.md](references/verification-patterns.md) for detailed code patterns for:
- Data loading, filtering, merging
- Aggregation and model training
- Batch pipeline scale-up testing (submission, validation, cost extrapolation)
- Quick reference table by operation type

See [references/etl-enforcement.md](references/etl-enforcement.md) for ETL strategy enforcement:
- Filter push-down (database vs application vs hybrid)
- Parallelism (Task agents vs SGE vs sequential)
- Intermediate caching (parquet vs CSV vs SQLite)
- Scale-up testing domain routing

## Scale-Up Testing Protocol (Batch/ETL Operations)

**Triggers when PLAN.md includes a Scale-Up Testing Plan table.** NO FULL BATCH WITHOUT A SUCCESSFUL TEST BATCH. This is not negotiable.

Three stages: Test (~10 items, always required) -> Intermediate (~100, if total >500) -> Large (~1,000, if total >5,000). Each stage has quality gates that must pass before scaling up.

> **Full protocol, scale-up facts, and red flags:** See [references/scale-up-testing.md](references/scale-up-testing.md)

## Common Failures to Avoid

| Failure | Why It Happens | Prevention |
|---------|----------------|------------|
| Silent data loss | Merge drops rows | Print row counts before/after |
| Hidden nulls | Join introduces nulls | Check null counts after joins |
| Wrong aggregation | Groupby logic error | Display sample groups |
| Type coercion | Pandas silent conversion | Verify dtypes after load |
| Off-by-one | Date filtering edge cases | Print min/max dates |

## If Output Looks Wrong

1. **STOP** - do not proceed
2. **Investigate** - print more details
3. **Document** - log the issue in LEARNINGS.md
4. **Ask** - if unclear, ask user for guidance
5. **Fix** - only proceed after output verified

**Never hide failures.** Bad output documented is better than silent failure.

## No Pause Between Tasks

<EXTREMELY-IMPORTANT>
**After completing task N, IMMEDIATELY start task N+1. You MUST NOT pause.**

The user sees results at the END and is waiting for completion, not interim check-ins — a courtesy pause costs a full turn round-trip and delivers nothing. Pause only when ALL tasks are complete or you are blocked.

**Your pausing between tasks is procrastination disguised as courtesy.**
</EXTREMELY-IMPORTANT>

## Autonomous Execution: Re-Read & Blocker Handling

**Dynamic plan re-read.** After each task completes, RE-READ `.planning/PLAN.md` before starting the next task. A prior task (or a Rule-2/Rule-3 deviation) may have inserted, reordered, or removed tasks. Trusting a stale in-memory task list silently skips dynamically-added work. The on-disk PLAN.md is the source of truth.

**Blocker handling.** When a task cannot proceed (subagent reports failure it cannot auto-fix under R1-R3, missing dependency, environment error), do NOT silently stop. Present the blocker with three options and act on the choice:

| Option | When | Action |
|--------|------|--------|
| **Retry** | Transient / fixable cause | Re-dispatch the task subagent with the blocker context added |
| **Skip** | Task is non-blocking for downstream work | Mark the task `blocked` in PLAN.md, log to LEARNINGS.md, continue to the next independent task |
| **Stop** | Blocker invalidates the plan (R4-class) | Invoke ds-handoff, escalate to the user |

In autonomous/auto-advance mode, default to **Retry once**, then **Skip** if still blocked and the task is non-critical, then **Stop**. Record the chosen path in LEARNINGS.md.

## Deviation Rules

When subagents encounter unplanned issues during implementation, follow this 4-rule system:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Data integrity bugs, wrong joins, type errors, off-by-one in date ranges, NaN propagation, index alignment errors | Fix → verify output with output-first protocol → track `[Rule 1 - Bug]` | Auto |
| **R2: Missing Critical** | Missing null handling, no dedup check after merge, missing row count verification, no dtype validation, missing outlier handling | Add → verify → track `[Rule 2 - Missing Critical]` | Auto |
| **R3: Blocking** | Missing dependency/package, wrong file path, data file unavailable, API rate limit, memory error on large data | Fix blocker → verify proceeds → track `[Rule 3 - Blocking]` | Auto |
| **R4a: Data Assumption** | Data doesn't match expected shape/schema/distribution — expected panel but got cross-section, unexpected nulls in key column, different date range than specified, unexpected categories | **STOP** → present finding with evidence → track `[Rule 4a - Data Assumption]` | **Ask user** |
| **R4b: Methodology Change** | Analysis approach needs changing — different model needed, different sample definition, different variable construction, need to add/remove control variables | **STOP** → present decision with alternatives → track `[Rule 4b - Methodology]` | **Ask user** |

**Priority:** R4a/R4b (STOP) > R1-R3 (auto) > unsure → escalate as R4.

**Edge cases:**
- Unexpected nulls in non-key column → R2 (add handling)
- Unexpected nulls in key/ID column → R4a (data assumption violated)
- Package version mismatch → R3 (blocking)
- Need different statistical test → R4b (methodology change)
- Wrong merge type (left vs inner) → R1 (bug)
- Data has different granularity than expected → R4a (assumption)

**Tracking format per task:**
Each task summary in `.planning/LEARNINGS.md` should end with:
**Deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **R4 escalations:** [list or "none"].

## Agent Team Implementation (Parallel) — SUPERSEDED by the compiled runner

The compiled `.planning/run.js` already runs independent tasks (same DAG level) in parallel via
`parallel()` and gates each independently — there is no manual agent-team to spawn or reconcile. This
section is retained only for ad-hoc work **outside** the `/ds` implement phase (e.g. a one-off
`ds-delegate` fan-out). Within the phase, do COMPILE + the run/pause loop; do not hand-roll an agent
team.

> Legacy protocol (ad-hoc use only): [references/agent-team-protocol.md](references/agent-team-protocol.md).

## Gate: Exit Implementation

**Checkpoint type:** human-verify (all tasks pass — machine-verifiable)

<EXTREMELY-IMPORTANT>
**You MUST NOT proceed to review without verifying ALL tasks are complete. This is not negotiable.**

Before proceeding to validation, execute this gate:

1. **IDENTIFY**: Read `.planning/PLAN.md` — list every task by number and name
2. **RUN**: Read `.planning/LEARNINGS.md` — find entries for each task
3. **READ**: For each task, confirm LEARNINGS.md contains:
   - A "Task N: [Name] - COMPLETE" entry
   - Verified output (shape, stats, or sample)
   - No unresolved issues flagged
4. **VERIFY**: Count tasks in PLAN.md vs completed entries in LEARNINGS.md. They MUST match.

**Staleness Check:** LEARNINGS.md must be updated in THIS session, not reused from prior work.
- Does each task entry reference current outputs (file paths, cell numbers)?
- If LEARNINGS.md is stale from a prior session, UPDATE it with fresh entries before claiming completion.

**Stale LEARNINGS.md = false gate pass = unverified work = the user gets results no one actually checked.**

5. **CLAIM**: Only if all tasks accounted for, write the completion sentinel, then proceed to validation:

```
Write(".planning/IMPLEMENT_COMPLETE.md", """---
status: COMPLETE
tasks_total: [N]
date: [ISO 8601]
---
All PLAN.md tasks complete and verified in LEARNINGS.md. ds-validate may proceed.
""")
```

**If ANY task is missing from LEARNINGS.md, implement it before proceeding.** Do NOT write the sentinel until the task counts match.

**Claiming all tasks are done without checking LEARNINGS.md against PLAN.md is NOT HELPFUL — missing tasks mean incomplete analysis the user relies on.**
</EXTREMELY-IMPORTANT>

## Phase Complete

After passing the exit gate (sentinel written), IMMEDIATELY discover and read the validation phase:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-validate/SKILL.md` and follow its instructions. Follow its instructions to validate outputs before review.

**This gate is hook-enforced:** ds-validate declares a PreToolUse `phase-gate-guard.py` hook that blocks its validator dispatch until `.planning/IMPLEMENT_COMPLETE.md` exists with `status: COMPLETE`.
