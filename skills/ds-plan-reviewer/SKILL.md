---
name: ds-plan-reviewer
description: "Internal skill used by ds-plan at Phase 2 exit gate. Dispatches a reviewer subagent to verify PLAN.md quality before implementation. NOT user-facing."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-reviewer-readonly-guard.py"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-reviewer-readonly-guard.py"
---

# Plan Document Reviewer (Data Science)

**Purpose:** Catch plan gaps BEFORE they survive into implementation. Bad task decomposition, missing data profiling, and spec misalignment cost 10x more to fix during implementation than during review.

## When to Dispatch

After Phase 2 (ds-plan) writes `.planning/PLAN.md` and before Phase 3 (ds-implement) begins.

```
Phase 2: ds-plan -> PLAN.md written
  -> [THIS SKILL] Dispatch plan reviewer subagent
  -> For plans with >15 tasks: review per-chunk
  -> Issues found? Fix PLAN.md -> re-dispatch reviewer
  -> Approved? -> Phase 3: ds-implement
```

<EXTREMELY-IMPORTANT>
## The Iron Law of Plan Review

**NO IMPLEMENTATION WITHOUT REVIEWED PLAN. This is not negotiable.**

A bad plan that survives into implementation means:
- Subagents struggling with tasks that lack intermediate output definitions
- Missing data profiling steps discovered mid-analysis
- Spec requirements silently dropped
- Rework when task ordering ignores data dependencies

**Catching a plan gap NOW costs 1 minute. Catching it during implementation costs hours.**
</EXTREMELY-IMPORTANT>

### Plan-Review Facts

- User approval covers the approach, not task granularity — an approved plan can still have vague tasks, missing profiling steps, and silently dropped requirements. The reviewer checks what the user didn't.
- Implementation subagents receive only the task text — they don't know the spec, and they execute vague tasks literally, producing wrong analysis. Every task must define what it produces and what proves completion.
- ds-implement enforces output-first per step, but a task with no task-level verification criterion has no one checking its overall outcome — per-step output discipline does not substitute for it.
- A plan that resembles a prior analysis is not thereby complete — prior plans had different data sources; each task is checked against THIS spec's requirements.

## Chunking Rule

**If PLAN.md has >15 tasks:** Break into ordered chunks using `## Chunk N: <name>` headings. Each chunk should be logically self-contained (e.g., "data cleaning", "feature engineering", "analysis", "visualization"). Review each chunk separately.

**If PLAN.md has <=15 tasks:** Review the entire plan in one pass.

**Why chunk:** Monolithic review of large documents produces shallow feedback. Focused review per chunk catches more issues.

## Dispatch Template (Single Plan or Per-Chunk)

Use this Task invocation to dispatch the plan reviewer:

```
Agent(
  subagent_type="general-purpose",
  description="Review DS plan document",
  allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
  prompt="""
You are a data science plan document reviewer. Verify this plan is complete, matches the spec, and is ready for implementation.

**Tool Restrictions:** The plan reviewer is READ-ONLY. It reads `.planning/PLAN.md` and `.planning/SPEC.md`, evaluates against checklist, returns verdict. It MUST NOT use Write or Edit.

**Plan to review:** .planning/PLAN.md [-- Chunk N only, if chunked]
**Spec for reference:** .planning/SPEC.md

Read BOTH files, then evaluate the plan against ALL categories below.

## What to Check

| Category | What to Look For |
|----------|------------------|
| **Executable table (BLOCKING)** | The Task Breakdown MUST be the machine-executable table `Task \| Deps \| Outputs \| Expected Output \| Verify \| Implements`, one row per task, every column filled. Tasks recorded as prose `### Task N` headers, or any row missing Deps/Outputs/Expected Output/Verify/Implements, is **BLOCKING** — ds-implement can't parse a data-flow DAG or per-task verify gate from it. (`ds-plan-executable-guard.py` also blocks the approval write; flag it here so it's fixed first.) |
| Completeness | TODOs, placeholders, incomplete tasks, missing steps |
| Spec Alignment | Plan covers ALL spec requirements, no scope creep, no requirements silently dropped |
| **Master Datasets** | For any project with 3+ shared-sample exhibits: a `## Master Datasets` table names the minimal canonical datasets with grain + unique keys; an `## Exhibit → Dataset Map` maps EVERY planned exhibit to a master (none reading raw sources directly); a mermaid `## Dataset Construction Diagram` shows raw → merges → filters → masters → exhibits with keys/filters on edges. Each master must be built by a real Task Breakdown row. Per-exhibit ad-hoc pulls (exhibits not tracing to a shared master) is a flag — it manufactures exhibits that disagree. |
| **Parameter Transparency** | If the analysis has any sample filters or tuning parameters: a `## Filters & Parameters` table names a single config location and lists every parameter (constant · value · applied in · rationale/source · principled? · disposition). Principled (✓) requires a cited source OR a validation result — not "seemed reasonable". Every convenience (⚠) row MUST carry a disposition (robustness panel / verified-redundant / display-only) tracing to a Task Breakdown task. Missing table, no named config location, or ⚠ parameters with no disposition is a flag — scattered magic numbers are a replication hazard. |
| Data Profiling | Data profile section present with shape, types, quality issues documented |
| Task Decomposition | Tasks atomic enough for a single subagent, clear boundaries, steps actionable |
| Task Ordering | Dependencies correct (cleaning before analysis), no circular dependencies |
| Intermediate Outputs | Each task defines what it produces and what proves completion |
| Output-First Verification | Each task includes verification steps (print shape, check nulls, sample output) |
| ETL Strategy | If data > 1M rows or multiple sources: filter strategy, parallelism plan, caching documented |
| Reproducibility | Random seeds, package versions, data snapshots documented where relevant |

## CRITICAL - Look Especially Hard For:

- Any TODO markers or placeholder text
- Steps that say "similar to X" without actual content
- Tasks missing intermediate output definitions (what does this task produce?)
- Tasks missing verification steps (how do you know it worked?)
- Missing data profiling tasks (should always come before analysis)
- Data cleaning tasks that lack strategy for each quality issue found in profiling
- Spec requirements not covered by ANY task (silently dropped)
- Exhibits that read raw sources directly instead of a declared master dataset (per-exhibit pulls that will silently disagree)
- A master dataset named in the map with no Task Breakdown row that builds it, or a planned exhibit absent from the Exhibit → Dataset Map
- A Dataset Construction Diagram whose edges omit the merge keys / filter row-drops (decoration, not a spec)
- Inline numeric literals implied by task descriptions instead of a named config location (magic numbers)
- Parameters marked principled (✓) on "seemed reasonable" rather than a cited source or a validation result
- Convenience (⚠) parameters with no disposition (robustness panel / verified-redundant / display-only) in the Task Breakdown
- Tasks too large for a single subagent (>100 lines of change or multiple distinct operations)
- ETL strategy missing when data is large (>1M rows) or from multiple sources
- Missing output verification plan section

## Output Format

## Plan Review

**Status:** APPROVED | ISSUES_FOUND

**Issues (if any):**
- [Task X, Step Y]: [specific issue] - [why it matters for implementation]

**Spec Coverage Check:**
- [Requirement 1]: Covered by Task N | NOT COVERED
- [Requirement 2]: Covered by Task N | NOT COVERED

**Recommendations (advisory - don't block approval):**
- [suggestions for improvement that aren't blocking]
""")
```

## Handling Reviewer Output

### If APPROVED

**1. Write the structural gate sentinel** (ds-implement refuses to start without it — a PreToolUse `phase-gate-guard.py` hook checks this file):

```
Write(".planning/PLAN_REVIEWED.md", """---
status: APPROVED
reviewed: plan
date: [ISO 8601]
---
Plan reviewed and APPROVED by ds-plan-reviewer. ds-implement may proceed.
""")
```

**2. Proceed immediately to Phase 3 (ds-implement).** Discover and load:
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-implement/SKILL.md` and follow its instructions.

### If ISSUES_FOUND
1. **Clear any stale sentinel** so the gate cannot pass on an old approval:
   `Write(".planning/PLAN_REVIEWED.md", "---\nstatus: ISSUES_FOUND\nreviewed: plan\n---\nPlan has open issues; ds-implement is gated.")`
2. Fix the specific issues in `.planning/PLAN.md`
3. Re-dispatch the reviewer (same template)
4. Repeat until APPROVED or max 5 iterations

### If 5 Iterations Without Approval
Escalate to user:
```
"Plan reviewer has flagged issues 5 times. Remaining issues:
[list issues]
Should I: (A) Fix these, (B) Proceed with known gaps, (C) Rethink the plan?"
```

## Model Tier Hints

When the reviewed plan proceeds to implementation, add model tier guidance to task dispatch:

| Task Complexity | Model Tier | Signals |
|----------------|------------|---------|
| Mechanical | Cheapest capable | Data loading, simple filtering, descriptive stats, file format conversion |
| Integration | Standard | Merges/joins across sources, aggregations, visualization, data reshaping |
| Architecture/Review | Most capable | Feature engineering strategy, model selection, statistical assumption validation, methodology review |

**Routing is real** -- apply via the Agent tool's `model` parameter at dispatch (omit to inherit the session model for judgment-heavy tasks).

## Gate Function

**Checkpoint type:** human-verify (plan quality is machine-verifiable)

```
1. IDENTIFY: `.planning/PLAN.md` exists
2. DISPATCH: Send to reviewer subagent (per-chunk if >15 tasks)
3. READ: Reviewer returns APPROVED or ISSUES_FOUND
4. VERIFY: If ISSUES_FOUND, fix and re-dispatch (max 5)
5. CLAIM: When ALL chunks APPROVED, write `.planning/PLAN_REVIEWED.md` (`status: APPROVED`), THEN proceed to ds-implement

**This gate is hook-enforced, not advisory:** ds-implement declares a PreToolUse `phase-gate-guard.py` hook that blocks Write/Edit/Agent until `.planning/PLAN_REVIEWED.md` exists with `status: APPROVED`. A user who invokes `/ds-implement` directly without a reviewed plan is structurally blocked.
```
