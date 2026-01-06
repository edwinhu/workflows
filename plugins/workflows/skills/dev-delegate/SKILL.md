---
name: dev-delegate
description: "Subagent delegation for implementation. Dispatches fresh Task agents with two-stage review."
---

**Announce:** "I'm using dev-delegate to dispatch implementation subagents."

## Core Principle

**Fresh subagent per task + two-stage review = high quality, fast iteration**

- Implementer subagent does the work
- Spec reviewer confirms it matches requirements
- Quality reviewer checks code quality
- Loop until both approve

## When to Use

Called by `dev-implement` for each task in PLAN.md. Don't invoke directly.

## The Process

```
For each task:
    1. Dispatch implementer subagent
       - If questions → answer, re-dispatch
       - Implements, tests, commits
    2. Dispatch spec reviewer subagent
       - If issues → implementer fixes → re-review
    3. Dispatch quality reviewer subagent
       - If issues → implementer fixes → re-review
    4. Mark task complete
```

## Step 1: Dispatch Implementer

Use this Task invocation (fill in brackets):

```
Task(subagent_type="general-purpose", prompt="""
You are implementing: [TASK NAME]

## Task Description
[PASTE FULL TASK TEXT FROM PLAN.md - don't make subagent read file]

## Context
- Project: [brief description]
- Related files: [list from exploration]
- Test command: [from SPEC.md]

## Requirements
1. Follow TDD: write failing test first, then implement
2. Run tests after each change
3. Commit when tests pass
4. Self-review before finishing

## If Unclear
Ask questions BEFORE implementing. Don't guess.

## Output
Report: what you implemented, test results, commit SHA, any concerns.
""")
```

**If implementer asks questions:** Answer clearly, then re-dispatch with answers included.

**If implementer finishes:** Proceed to spec review.

## Step 2: Dispatch Spec Reviewer

Use this Task invocation:

```
Task(subagent_type="general-purpose", prompt="""
Review spec compliance for: [TASK NAME]

## Original Requirements
[PASTE TASK TEXT FROM PLAN.md]

## Success Criteria (from SPEC.md)
[PASTE RELEVANT CRITERIA]

## Review Checklist
1. Does implementation meet ALL requirements?
2. Is anything MISSING from the spec?
3. Is anything EXTRA not in the spec?

## Output Format
- COMPLIANT: All requirements met, nothing extra
- ISSUES: List what's missing or extra

Be strict. "Close enough" is not compliant.
""")
```

**If COMPLIANT:** Proceed to quality review.

**If ISSUES:** Have implementer fix, then re-run spec review.

## Step 3: Dispatch Quality Reviewer

Use this Task invocation:

```
Task(subagent_type="general-purpose", prompt="""
Review code quality for: [TASK NAME]

## Changes to Review
Files modified: [list files]
Commit range: [BASE_SHA]..[HEAD_SHA]

## Review Focus
1. Code correctness (logic errors, edge cases)
2. Test coverage (are tests meaningful?)
3. Code style (matches project conventions?)
4. No regressions introduced

## Confidence Scoring
Rate each issue 0-100. Only report issues >= 80 confidence.

## Output Format
### Strengths
- [what's good]

### Issues (Confidence >= 80)
#### [Issue Title] (Confidence: XX)
- Location: [file:line]
- Problem: [description]
- Fix: [suggestion]

### Verdict
APPROVED or CHANGES REQUIRED
""")
```

**If APPROVED:** Mark task complete, move to next task.

**If CHANGES REQUIRED:** Have implementer fix, then re-run quality review.

## Red Flags

**Never:**
- Skip either review (spec OR quality)
- Proceed with unfixed issues
- Let implementer self-review replace actual review
- Start quality review before spec compliance passes
- Make subagent read plan file (provide full text)
- Rush past subagent questions

**If subagent fails:**
- Dispatch fix subagent with specific instructions
- Don't fix manually in main chat (context pollution)

## Example Flow

```
Me: Implementing Task 1: Add user validation

[Dispatch implementer with full task text]

Implementer: "Should validation happen client-side or server-side?"

Me: "Server-side only, in the API layer"

[Re-dispatch implementer with answer]

Implementer:
- Added validateUser() in api/users.ts
- Tests: 5/5 passing
- Committed: abc123

[Dispatch spec reviewer]

Spec Reviewer: ISSUES
- Missing: Email format validation (spec line 12)

[Tell implementer to fix]

Implementer:
- Added email regex validation
- Tests: 6/6 passing
- Committed: def456

[Re-dispatch spec reviewer]

Spec Reviewer: COMPLIANT

[Dispatch quality reviewer with commit range]

Quality Reviewer: APPROVED
- Strengths: Good test coverage, clear naming
- No issues >= 80 confidence

[Mark Task 1 complete, move to Task 2]
```

## Integration

This skill is invoked by `dev-implement` during the TDD phase.
After all tasks complete, `dev-implement` proceeds to `dev-review`.
