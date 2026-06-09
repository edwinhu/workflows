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
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-post-subagent-guard.py"
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-pre-subagent-clear.py"
    - matcher: "Read"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.py"
    - matcher: "Grep"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.py"
    - matcher: "Glob"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.py"
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.py"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.py"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-no-main-chat-code-guard.py"
    - matcher: "Write|Edit|Agent|Workflow"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_DESCRIPTION="Plan review"
            GATE_REMEDY="Return to ds-plan and run ds-plan-reviewer; implementation is gated until PLAN.md is APPROVED."
            GATE_BLOCKED_TOOLS=Write,Edit,Agent,Workflow
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
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
</EXTREMELY-IMPORTANT>

## Delegation

<EXTREMELY-IMPORTANT>
**YOU MUST NOT WRITE ANALYSIS CODE IN MAIN CHAT. This is not negotiable.**

You orchestrate the **`ds-implement` ultracode workflow**, which reads the hardened PLAN.md Task Breakdown table, builds the data-flow DAG, and runs each dependency level's tasks output-first (one ds-analyst/ds-engineer per task, writing directly to the project). You drive the level loop; the workflow's implementers do the analysis/ETL.

```
0. Set the goal (once): /goal All tasks in PLAN.md are marked [x], each task's Verify
   assertion exits 0, and .planning/VALIDATION.md status is `validated`. Stop after [N] turns.

LOOP (one turn per level, under the active /goal):
  1. Workflow(name="ds-implement", args={
       "projectDir": "<absolute project root (cwd)>",
       "pluginRoot": "<resolve ${CLAUDE_SKILL_DIR}/../../workflows>"
     })
     → runs the lowest level's pending tasks output-first, returns { overallPass, level,
       tasksRemaining, tasks, findings, tasksThatFailed, reviews }. Outputs are already on disk.
  2. GROUND-TRUTH: run ds-validate-coverage (or the full pipeline) on the level's outputs —
     per-task Verify ran in isolation; this confirms requirement coverage / no regression.
  3. If result.overallPass AND coverage clean: mark this level's PLAN rows [x], log to
     LEARNINGS.md, END THE TURN (the /goal re-fires for the next level, or closes if
     tasksRemaining=0). No pause.
  4. If result.overallPass is false: read result.findings, fix the cause, re-invoke with
     onlyChecks=result.tasksThatFailed + priorReviews=result.reviews. An R4 (schema change,
     new data source, methodology pivot) is critical — STOP and escalate to the user.
```

The legacy per-task `ds-delegate` template is now embedded in the workflow's implementer prompt; `ds-delegate` remains for ad-hoc single-task dispatch outside this phase. **If you're about to write analysis code directly, STOP — the workflow's implementers do that, and `ds-no-main-chat-code-guard` forbids you (you may only touch `.planning/`).**

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


## Implementation Strategy Choice

After prerequisites pass and PLAN.md verified, check for parallelization potential:

**Skip this choice when:**
- PLAN.md has fewer than 4 tasks
- All tasks are dependent (every task is `after N` with no independent groups)
- Tasks form a pipeline (clean → merge → aggregate → model)
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not available

**Otherwise, ask the user:**

```python
AskUserQuestion(questions=[{
  "question": "How should we implement the analysis tasks in PLAN.md?",
  "header": "Strategy",
  "options": [
    {"label": "Sequential (Default)", "description": "One task at a time with output-first verification. Safest, most DS work is sequential."},
    {"label": "Agent team (parallel)", "description": "Spawn analyst per independent task group. Only for truly independent analysis branches (descriptive stats by subgroup, model comparisons). Requires reconciliation."}
  ],
  "multiSelect": false
}])
```

**If Sequential:** Proceed to [Implementation Process](#implementation-process) below (current behavior).

**If Agent team:** Skip to [Agent Team Implementation (Parallel)](#agent-team-implementation-parallel).


## SAS Language Routing

If PLAN.md specifies `Implementation Language: SAS` or `Mixed`, load SAS enforcement BEFORE dispatching any SAS tasks. Paste the enforcement block into every SAS subagent prompt.

> **Full SAS enforcement rules:** See [references/sas-enforcement.md](references/sas-enforcement.md)

## Implementation Process Flowchart

```
┌─────────────────────────┐
│  Read PLAN.md + Load    │
│  ds-delegate + ETL refs │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  For each task in PLAN  │◄──────────────────────┐
│  (in dependency order)  │                       │
└───────────┬─────────────┘                       │
            ▼                                     │
┌─────────────────────────┐                       │
│  Dispatch Task agent    │                       │
│  (per ds-delegate)      │                       │
└───────────┬─────────────┘                       │
            ▼                                     │
┌─────────────────────────┐     ┌──────────────┐  │
│  Read agent output      │────→│ Output wrong │  │
│  Verify output present  │     │ or missing?  │  │
│  + reasonable            │     └──────┬───────┘  │
└───────────┬─────────────┘            │           │
            │ OK                       ▼           │
            │                 ┌──────────────────┐ │
            │                 │ STOP. Investigate │ │
            │                 │ Log issue. Fix.   │ │
            │                 │ Re-verify.        │ │
            │                 └──────────────────┘ │
            ▼                                     │
┌─────────────────────────┐                       │
│  Log to LEARNINGS.md    │                       │
│  (Task N: COMPLETE)     │                       │
└───────────┬─────────────┘                       │
            ▼                                     │
        More tasks? ──── YES ─────────────────────┘
            │
            NO
            ▼
┌─────────────────────────┐
│  Exit Gate: Compare     │
│  PLAN.md vs LEARNINGS   │
│  (all tasks accounted?) │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  Invoke ds-validate     │
└─────────────────────────┘
```

**This flowchart IS the specification.** If the narrative below and this flowchart disagree, the flowchart wins.

## Topic Change Protocol

**If user sends an off-topic message during implementation, follow C6 from ds-common-constraints.md:**

1. **Announce:** "Pausing ds-implement to address your request."
2. **Handle:** Process the request (normal tools allowed outside the loop).
3. **Announce:** "Resuming ds-implement. Reading state files for current progress."
4. **Reload:** Read LEARNINGS.md and PLAN.md to restore context.
5. **Resume:** Continue from where you left off.

**Do NOT silently switch context. Silent switches kill the implementation loop.**

## Implementation Process

### Step 1: Read Plan, Load Shared Enforcement, and Delegation Skill

Auto-load all constraints matching `applies-to: ds-implement`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py ds-implement`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

```
Read(".planning/PLAN.md")
```

Read `${CLAUDE_SKILL_DIR}/../../skills/ds-delegate/SKILL.md` and follow its instructions.

Follow the task order defined in the plan. Use ds-delegate's templates for every task.

**ETL Strategy Enforcement — load domain-specific references based on PLAN.md:**

If PLAN.md contains an `## ETL Strategy` section, the user made decisions during planning that MUST be enforced during implementation. Check each subsection and load the corresponding enforcement:

| PLAN.md Section | Enforcement Reference | Inject Into |
|-----------------|----------------------|-------------|
| `row_pk` / `event_key` declared (any data with a grain) | ETL enforcement (`skills/ds-implement/references/etl-enforcement.md`) § Key & Grain Carry-Through | Every data load/transform subagent prompt |
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

### Step 2: Execute Each Task via Delegation

For each task in PLAN.md:
1. Dispatch analyst subagent (per ds-delegate pattern)
2. Verify outputs are present and reasonable
3. Dispatch methodology reviewer (for statistical tasks)
4. Log findings to LEARNINGS.md

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

| Thought | Reality |
|---------|---------|
| "Task done, should check in with user" | You're wasting context. User wants ALL tasks done. Keep going. |
| "User might want to see intermediate results" | You're assuming wrong. User will see results at the END. Continue. |
| "Natural pause point" | You're making excuses. Only pause when ALL tasks complete or you're blocked. |
| "Should summarize this step" | You're procrastinating. Summarize AFTER all tasks. Keep moving. |

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

## Agent Team Implementation (Parallel)

> **Full protocol:** See [references/agent-team-protocol.md](references/agent-team-protocol.md) for prerequisites, spawn prompt template, lead monitoring, reconciliation (3 passes), and usage guidelines.

Key points:
1. Run foundation tasks sequentially FIRST, then spawn parallel teammates
2. Each teammate gets exclusive data scope and output files
3. After all teammates complete, lead performs 3 reconciliation passes (Collect, Verify, Methodology)
4. **Default is sequential.** Only use agent teams for 4+ tasks with true independence (different datasets/subsets, no shared output files)

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
