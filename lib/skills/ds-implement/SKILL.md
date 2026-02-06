---
name: ds-implement
description: "REQUIRED Phase 3 of /ds workflow. Enforces output-first verification at each step."
---

## Overview

Apply output-first verification at every step of analysis implementation. This is Phase 3 of the `/ds` workflow.

## Contents

- [The Iron Law of DS Implementation](#the-iron-law-of-ds-implementation) - EVERY step MUST produce visible output
- [Delegation](#delegation) - Main chat orchestrates, subagents analyze
- [What Output-First Means](#what-output-first-means)
- [Red Flags](#red-flags---stop-immediately)
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
4. Document in LEARNINGS.md
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

You orchestrate. Subagents analyze. For every task in PLAN.md, use the delegation skill:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-delegate/SKILL.md")
```

This is MANDATORY. ds-delegate contains the Task agent templates, output-first protocol details, methodology review patterns, and rationalization prevention. Do not attempt to summarize or shortcut it.

**If you're about to write analysis code directly, STOP and read ds-delegate.**

If you wrote analysis code in main chat, DELETE it immediately and dispatch a Task agent instead. Code written in main chat is contaminated by orchestrator context and must not be kept.
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

## Red Flags - STOP Immediately

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "I'll check at the end" | STOP - you're letting errors compound silently | Check after every step |
| "This transform is simple" | STOP - simple code can still be wrong | Output and verify |
| "I know merge worked" | STOP - you've assumed this before and been wrong | Check row counts |
| "Data looks fine" | STOP - you're confusing "looks" with verification | Print stats, show samples |
| "I'll batch the outputs" | STOP - you're about to lose your ability to isolate issues | Output per operation |
| "Just a quick plot in main chat" | STOP - you're about to violate delegation | Spawn a Task agent |

## Implementation Process

### Step 1: Read Plan and Delegation Skill

```
Read(".claude/PLAN.md")
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-delegate/SKILL.md")
```

Follow the task order defined in the plan. Use ds-delegate's templates for every task.

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

## Verification Patterns

See [references/verification-patterns.md](references/verification-patterns.md) for detailed code patterns for:
- Data loading, filtering, merging
- Aggregation and model training
- Quick reference table by operation type

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

## Gate: Exit Implementation

<EXTREMELY-IMPORTANT>
**You MUST NOT proceed to review without verifying ALL tasks are complete. This is not negotiable.**

Before invoking ds-review, execute this gate:

1. **IDENTIFY**: Read `.claude/PLAN.md` — list every task by number and name
2. **RUN**: Read `.claude/LEARNINGS.md` — find entries for each task
3. **READ**: For each task, confirm LEARNINGS.md contains:
   - A "Task N: [Name] - COMPLETE" entry
   - Verified output (shape, stats, or sample)
   - No unresolved issues flagged
4. **VERIFY**: Count tasks in PLAN.md vs completed entries in LEARNINGS.md. They MUST match.
5. **CLAIM**: Only if all tasks accounted for, proceed to review

**If ANY task is missing from LEARNINGS.md, implement it before proceeding.**

**Claiming all tasks are done without checking LEARNINGS.md against PLAN.md is LYING.**
</EXTREMELY-IMPORTANT>

## Phase Complete

After passing the exit gate, IMMEDIATELY invoke:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-review/SKILL.md")
```
