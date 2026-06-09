---
name: dev-plan-reviewer
description: "Internal skill used by dev-design at Phase 4 exit gate. Dispatches a reviewer subagent to verify PLAN.md quality before implementation. NOT user-facing."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob
---

# Plan Document Reviewer

**Purpose:** Catch plan gaps BEFORE they survive into implementation. Bad task decomposition, missing steps, and spec misalignment cost 10x more to fix during implementation than during review.

## When to Dispatch

After Phase 4 (design) writes `.planning/PLAN.md` and before Phase 5 (implement) begins.

```
Phase 4: Design → PLAN.md written → user approved
  → [THIS SKILL] Dispatch plan reviewer subagent
  → For plans with >15 tasks: review per-chunk
  → Issues found? Fix PLAN.md → re-dispatch reviewer
  → Approved? → Phase 5: Implement
```

<EXTREMELY-IMPORTANT>
## The Iron Law of Plan Review

**NO IMPLEMENTATION WITHOUT REVIEWED PLAN. This is not negotiable.**

A bad plan that survives into implementation means:
- Subagents struggling with tasks that are too coarse
- Missing steps discovered mid-implementation
- Spec requirements silently dropped
- Rework when task ordering is wrong

**Catching a plan gap NOW costs 1 minute. Catching it during implementation costs hours.**
</EXTREMELY-IMPORTANT>

### Plan Review Facts

- User approval covers the approach, not task granularity — the independent reviewer checks what the user might miss. Skipping the review because "the user already approved" treats two different gates as one.
- Implementation subagents don't see the spec — a gap not caught at review time is invisible to them. "I'll catch it during implementation" is deferring to agents structurally unable to catch it.

## Chunking Rule

**If PLAN.md has >15 tasks:** Break into ordered chunks using `## Chunk N: <name>` headings. Each chunk should be logically self-contained (e.g., "infrastructure", "core logic", "tests", "integration"). Review each chunk separately.

**If PLAN.md has ≤15 tasks:** Review the entire plan in one pass.

**Why chunk:** Monolithic review of large documents produces shallow feedback. Focused review per chunk catches more issues.

## Dispatch Template (Single Plan or Per-Chunk)

Use this Task invocation to dispatch the plan reviewer:

```
Agent(
  subagent_type="workflows:dev-plan-checker",
  allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
  description="Review plan document",
  prompt="""
You are a plan document reviewer. Verify this plan is complete, matches the spec, and is ready for implementation.

**Tool Restrictions:** You are READ-ONLY. You MUST NOT use Write or Edit tools. You read `.planning/PLAN.md` and `.planning/SPEC.md`, evaluate against the checklist, and return a verdict. If you find issues, you report them — the main chat fixes them.

**Plan to review:** .planning/PLAN.md [— Chunk N only, if chunked]
**Spec for reference:** .planning/SPEC.md

Read BOTH files, then evaluate the plan against ALL categories below.

## What to Check

| Category | What to Look For |
|----------|------------------|
| **Executable table (BLOCKING)** | The Implementation Order MUST be the machine-executable table `Task \| Deps \| Files \| Failing Test \| Verify Command \| Implements`, one row per task, every column filled. Work recorded as prose `### Phase` headings, or any row missing Deps/Files/Verify Command/Implements, is **BLOCKING** — `dev-implement` cannot parse a DAG or per-task gate from it. (`dev-plan-executable-guard.py` also blocks the approval write, but flag it here so it's fixed before the guard fires.) |
| Completeness | TODOs, placeholders, incomplete tasks, missing steps |
| Spec Alignment | Plan covers ALL spec requirements, no scope creep, no requirements silently dropped |
| Prose Section Audit | Scan SPEC.md Design Decisions, Discovered Protocol, Clarified Requirements, and any other prose sections for behavioral requirements missing CATEGORY-NN IDs — **BLOCKING if found** |
| Task Decomposition | Tasks atomic enough for a single subagent, clear boundaries, steps actionable |
| Task Ordering | Dependencies correct, no circular dependencies, independent tasks marked |
| File Structure | Files have clear single responsibilities, split by responsibility not layer |
| File Size | Would any new or modified file likely grow too large to reason about? |
| Task Syntax | Checkbox syntax on steps for tracking |
| Testing Strategy | Testing section filled (framework, command, first test, location, skill) |

## CRITICAL — Look Especially Hard For:

- Any TODO markers or placeholder text
- Steps that say "similar to X" without actual content
- Incomplete task definitions (missing verify command or expected output)
- Missing verification steps or expected outputs
- Files planned to hold multiple responsibilities or likely to grow unwieldy
- Spec requirements not covered by ANY task (silently dropped)
- **Behavioral requirements in SPEC.md prose sections (Design Decisions, Discovered Protocol, Clarified Requirements) that lack CATEGORY-NN IDs** — these are invisible to PLAN.md task mapping and will be silently dropped. Flag as BLOCKING.
- Tasks too large for a single subagent (>100 lines of change)

## Output Format

## Plan Review

**Status:** APPROVED | ISSUES_FOUND

**Issues (if any):**
- [Task X, Step Y]: [specific issue] - [why it matters for implementation]

**Spec Coverage Check:**
- [Requirement 1]: Covered by Task N ✅ | NOT COVERED ❌
- [Requirement 2]: Covered by Task N ✅ | NOT COVERED ❌

**Recommendations (advisory — don't block approval):**
- [suggestions for improvement that aren't blocking]
""")
```

## Handling Reviewer Output

### If APPROVED

**Write the approval marker (MANDATORY):**

Before proceeding, you MUST create `.planning/PLAN_REVIEWED.md` with the reviewer's approval evidence. This file is the structural gate that dev-implement checks before starting.

```markdown
---
status: APPROVED
reviewed_at: [ISO timestamp]
reviewer: dev-plan-reviewer
iteration: [N]
---
# Plan Review: APPROVED

## Spec Coverage Check
[Paste the reviewer's full spec coverage check output here — every requirement ID with ✅/❌]

## Issues Fixed (if any)
[List any issues fixed during review iterations]
```

**If you skip writing this file, dev-implement will REFUSE to start. This is intentional.**

Then proceed to Phase 5 (implement):

Read `${CLAUDE_SKILL_DIR}/../../skills/dev-implement/SKILL.md` and follow its instructions.

### If ISSUES_FOUND
1. Fix the specific issues in `.planning/PLAN.md`
2. Re-dispatch the reviewer (same template)
3. Repeat until APPROVED or max 5 iterations

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
| Mechanical | Cheapest capable | Isolated function, 1-2 files, clear spec, boilerplate |
| Integration | Standard | Multi-file coordination, pattern matching, debugging within scope |
| Architecture/Review | Most capable | Design judgment needed, broad codebase understanding, quality gates |

**Routing is real** — apply via the Agent tool's `model` parameter at dispatch (omit to inherit the session model for judgment-heavy tasks).

## Gate Function

```
1. IDENTIFY: `.planning/PLAN.md` exists and user approved
2. DISPATCH: Send to reviewer subagent (per-chunk if >15 tasks)
3. READ: Reviewer returns APPROVED or ISSUES_FOUND
4. VERIFY: If ISSUES_FOUND, fix and re-dispatch (max 5)
5. CLAIM: Only proceed to implement when ALL chunks APPROVED
```
