---
name: ds-fix
version: 1.0
description: "This skill should be used when the user asks to 'fix analysis', 'wrong results', 'notebook error', 'reviewer feedback', 'data changed', 'debug notebook', or needs mid-analysis course-correction for wrong results, notebook errors, or data changes."
---

**Announce:** "Using ds-fix for mid-analysis course correction."

## Where This Fits

```
/ds (entry) → brainstorm → plan → implement → review → verify
                                    ↑
/ds-fix (midpoint) ─────────────────┘
```

This is the re-entry point. Jump back into a DS workflow that needs fixing.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Editing

**DIAGNOSE BEFORE FIXING. This is not negotiable.**

Before changing ANY analysis code, you MUST:
1. Load the workflow context
2. Identify WHAT is wrong (specific, not vague)
3. Identify WHY it's wrong (root cause)
4. Only THEN fix it (with output-first verification)

**If you're about to change code without diagnosing first, STOP.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "I'll just re-run everything" | Brute force hides root cause | Trace to the specific failing step |
| "The data probably changed" | Your guess isn't a diagnosis | Compare data profiles before/after |
| "Let me tweak the parameters" | Tweaking without understanding is p-hacking | Understand WHY parameters are wrong first |
| "I'll fix it and check later" | You're skipping output-first | Fix AND verify in the same step |

## Step 1: Load Context

Read workflow state:

```
Read(".claude/SPEC.md")
Read(".claude/PLAN.md")
Read(".claude/LEARNINGS.md")
```

If no workflow state exists, suggest starting with `/ds` instead.

## Step 2: Diagnose

Identify the issue category:

| Category | Symptoms | Route To |
|----------|----------|----------|
| **Runtime Error** | Traceback, cell failure, import error | Debug Protocol |
| **Wrong Results** | Numbers don't match expectations, sanity checks fail | Re-analysis Protocol |
| **Unclear Root Cause** | 3+ plausible explanations, mysterious data quality issues | Competing Hypothesis Investigation |
| **Reviewer Feedback** | Specific methodology concerns, requested changes | Revision Protocol |
| **Data Change** | New data available, source updated, schema changed | Re-profiling Protocol |
| **Scope Change** | New questions, expanded requirements | Spec Update → re-plan |

Ask user if ambiguous:

```
AskUserQuestion(questions=[
  {
    "question": "What needs fixing in your analysis?",
    "header": "Issue type",
    "options": [
      {"label": "Runtime error", "description": "Code fails, traceback, import error"},
      {"label": "Wrong results", "description": "Numbers don't look right, sanity checks fail"},
      {"label": "Unclear root cause", "description": "Multiple plausible explanations, mysterious data quality"},
      {"label": "Reviewer feedback", "description": "Specific changes requested by reviewer"},
      {"label": "Data/scope change", "description": "New data, updated requirements, new questions"}
    ],
    "multiSelect": false
  }
])
```

## Step 3: Fix by Category

### Runtime Error → Debug Protocol

1. Identify the failing cell/script
2. Read the error traceback
3. Check LEARNINGS.md for prior context on this step
4. Fix with output-first verification:
   - Print state BEFORE the failing operation
   - Fix the operation
   - Print state AFTER
   - Verify output matches expectations from PLAN.md

For notebook-specific errors, load notebook-debug patterns:

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/notebook-debug/SKILL.md")
```

### Wrong Results → Re-analysis Protocol

<EXTREMELY-IMPORTANT>
**Trace backwards. Do NOT guess forward.**

The bug is at the FIRST step where output diverges from expected. Find that step.
</EXTREMELY-IMPORTANT>

1. Identify WHICH results are wrong
2. Trace backwards through the pipeline:
   - Check final output → is the aggregation wrong?
   - Check intermediate data → is the transformation wrong?
   - Check input data → is the loading/filtering wrong?
3. Find the FIRST step where output diverges from expected
4. Fix that step with output-first verification
5. Re-run downstream steps and verify

### Reviewer Feedback → Revision Protocol

1. Document each piece of feedback as a task
2. For each task:
   - Locate the relevant code/output
   - Apply the change
   - Verify with output-first protocol
   - Document in LEARNINGS.md
3. After all changes, re-run review checks:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-review/SKILL.md")
```

### Data/Scope Change → Re-profiling Protocol

1. Profile the new data (shape, dtypes, distributions)
2. Compare to original data profile in LEARNINGS.md
3. Identify what changed (schema, volume, distributions)
4. Update PLAN.md if pipeline steps need changing
5. Re-run affected pipeline steps with output-first verification
6. Update LEARNINGS.md with new observations

### Scope Change → Spec Update

If the question itself changed:

1. Update SPEC.md with new objectives
2. Review PLAN.md — which tasks are still valid?
3. Add new tasks for new objectives
4. Return to implement phase for new tasks

### Unclear Root Cause → Competing Hypothesis Investigation

When 3+ plausible explanations exist, sequential investigation failed, or contradictory evidence is found, use the competing hypothesis protocol.

Read the full protocol: `references/competing-hypothesis.md`

Key steps:
1. Generate 3-5 competing hypotheses (Data Quality, Methodology, Implementation, Domain)
2. Spawn investigation team (one agent per hypothesis)
3. Scientific debate with cross-examination
4. Evidence synthesis with confidence scoring (≥90 to proceed)
5. Fix implementation via ds-delegate

## Step 4: Verify Fix

After fixing, apply output-first verification:

1. Re-run the fixed step: verify output shape, sample, stats
2. Re-run downstream steps: verify no cascading issues
3. Check against SPEC.md success criteria
4. Update LEARNINGS.md with fix documentation

## Delegation

Main chat orchestrates. Task agents do the fixing:

```
Task(subagent_type="general-purpose", prompt="""
Fix [SPECIFIC ISSUE] in the analysis.

Context:
- Read .claude/LEARNINGS.md for prior steps
- Read .claude/PLAN.md for task details
- Read .claude/SPEC.md for objectives

Fix Protocol:
1. Trace to root cause (do NOT guess)
2. Fix with output-first verification
3. Print state BEFORE and AFTER fix
4. Re-run downstream steps
5. Update LEARNINGS.md

Report: what was wrong, what was fixed, verification output.
""")
```

## When Fix Requires Rethinking

If the fix reveals the analysis approach is fundamentally wrong:

1. Document findings in LEARNINGS.md
2. Report to user: "The approach needs rethinking because [specific reason]"
3. Suggest returning to `/ds` for re-planning

Don't try to salvage a broken approach with patches. A fresh plan costs less than cascading fixes.
