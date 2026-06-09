---
name: writing-precis-reviewer
description: "Internal skill used by writing-setup at exit gate. Dispatches a reviewer subagent to verify PRECIS.md quality before outlining. NOT user-facing."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Agent
---

# Precis Document Reviewer

**Purpose:** Catch precis gaps BEFORE they survive into outlining and drafting. A vague thesis that survives into outlining means every section wanders, every draft rewrites, and the document never coheres.

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-precis-reviewer`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-precis-reviewer`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

## When to Dispatch

After writing-setup writes `.planning/PRECIS.md` and before `.planning/OUTLINE.md` creation begins.

```
Step 2: Interview → PRECIS.md written
  → [THIS SKILL] Dispatch precis reviewer subagent
  → Issues found? Fix PRECIS.md → re-dispatch reviewer
  → Approved? → Step 3: Create OUTLINE.md
```

<EXTREMELY-IMPORTANT>
## The Iron Law of Precis Review

**NO OUTLINE WITHOUT REVIEWED PRECIS. This is not negotiable.**

A bad precis that survives into outlining means:
- Sections that don't advance a clear thesis
- Claims that overlap or repeat each other
- Counterarguments that are strawmen, easily dismissed
- Scope that balloons because boundaries were never set
- An audience nobody specific, so the prose speaks to nobody

**Catching a precis gap NOW costs 1 minute. Catching it during drafting costs a full rewrite.**
</EXTREMELY-IMPORTANT>

## Dispatch Template

Use this Task invocation to dispatch the precis reviewer:

```
Agent(
  subagent_type="general-purpose",
  description="Review PRECIS document",
  prompt="""
You are a precis document reviewer. Verify this precis is sharp, complete, and ready to guide outlining and drafting.

**Tool restrictions:** You may ONLY use Read, Grep, and Glob tools. Do NOT use Write, Edit, or Bash. Your job is to evaluate, not fix.

**Precis to review:** .planning/PRECIS.md

Read the precis file, then evaluate against ALL categories below.

## What to Check

| Category | What to Look For |
|----------|------------------|
| Thesis Specificity | Is it a real claim? Or vague like "X is important" / "X matters" / "X is complex"? A thesis must be arguable — someone reasonable could disagree. |
| Claim Distinctness | Are claims genuinely different? Or do 2+ claims say the same thing in different words? Each claim must advance a separate leg of the argument. |
| Counterargument Substance | Are counterarguments steel-manned? Or strawmen that no serious reader would hold? Each objection must be one a smart opponent would actually raise. |
| Scope Clarity | Are IN and OUT lists specific? Or vague ("we cover the main issues")? Scope must draw clear boundaries. |
| Audience Specificity | Is the audience a real group? Or "anyone interested"? The audience must be specific enough to guide tone, assumed knowledge, and purpose. |
| Source Support | Do the listed sources actually support the claims? Are there claims without any source backing? |
| Completeness | Any TODOs, TBDs, placeholders, or empty sections? |
| Internal Consistency | Do claims contradict each other? Does scope conflict with thesis? |

## CRITICAL — Look Especially Hard For:

- Thesis that is a topic statement, not a claim ("This paper examines..." is NOT a thesis)
- Claims that are really the same point rephrased
- Counterarguments that no informed person would actually make
- Scope IN that is so broad the document would be a book
- Scope OUT that is empty or vague
- Audience described as "general readers" or "anyone interested"
- Any TODO or TBD markers
- Missing sections

## Output Format

## Precis Review

**Status:** APPROVED | ISSUES_FOUND

**Issues (if any):**
- [Section]: [specific issue] - [why it matters for outlining]

**Recommendations (advisory — don't block approval):**
- [suggestions for improvement that aren't blocking]
""")
```

## Handling Reviewer Output

### If APPROVED

Write the gate artifact so downstream phases can verify the gate ran:

```
Write(".planning/PRECIS_REVIEWED.md", """---
status: APPROVED
date: [ISO 8601]
reviewer: precis-reviewer-subagent
---
# Precis Review: APPROVED

[Include reviewer's approval summary here]
""")
```

Proceed immediately to Step 3 (create OUTLINE.md) in writing-setup.

### If ISSUES_FOUND

Staged improvement criteria per iteration:

| Iteration | Focus | Expected Improvement |
|-----------|-------|---------------------|
| 1 | Fix blocking issues (vague thesis, missing claims) | Thesis becomes arguable, claims become distinct |
| 2 | Fix secondary issues (weak counterarguments, vague scope) | Counterarguments steel-manned, scope boundaries clear |
| 3 | Fix refinement issues (audience specificity, source mapping) | All sections complete and internally consistent |
| 4-5 | Polish (if still needed) | Edge cases, consistency between sections |

Process:
1. Fix the specific issues in `.planning/PRECIS.md`
2. Re-dispatch the reviewer (same template)
3. Repeat until APPROVED or max 5 iterations

### If 5 Iterations Without Approval
Escalate to user:
```
"Precis reviewer has flagged issues 5 times. Remaining issues:
[list issues]
Should I: (A) Fix these, (B) Proceed with known gaps, (C) Rethink the precis?"
```

## Gate Function

```
1. IDENTIFY: `.planning/PRECIS.md` exists with content
2. DISPATCH: Send to reviewer subagent
3. READ: Reviewer returns APPROVED or ISSUES_FOUND
4. VERIFY: If ISSUES_FOUND, fix and re-dispatch (max 5)
5. CLAIM: Only proceed to OUTLINE.md creation when APPROVED
```
