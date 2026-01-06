---
name: dev-delegate
description: "Subagent delegation for implementation. Dispatches fresh Task agents with two-stage review."
---

**Announce:** "I'm using dev-delegate to dispatch implementation subagents."

## Where This Fits

```
Main Chat                          Task Agent
─────────────────────────────────────────────────────
dev-implement (orchestrates)
  → dev-ralph-loop (per-task loops)
    → dev-delegate (this skill)
      → spawns Task agent ──────→ follows dev-tdd
                                  uses dev-test tools
```

**Main chat** uses this skill to spawn Task agents.
**Task agents** follow `dev-tdd` (TDD protocol) and use `dev-test` (testing tools).

## Core Principle

**Fresh subagent per task + two-stage review = high quality, fast iteration**

- Implementer subagent does the work (following dev-tdd)
- Spec reviewer confirms it matches requirements
- Quality reviewer checks code quality
- Loop until both approve

## When to Use

Called by `dev-implement` inside each ralph loop iteration. Don't invoke directly.

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

## TDD Protocol (MANDATORY)

Follow the dev-tdd skill - RED-GREEN-REFACTOR:

1. **RED**: Write a failing test FIRST
   - Run it, SEE IT FAIL
   - Document: "RED: [test] fails with [error]"

2. **GREEN**: Write MINIMAL code to pass
   - Run test, SEE IT PASS
   - Document: "GREEN: [test] passes"

3. **REFACTOR**: Clean up while staying green

**If you write code before seeing RED, you're not doing TDD. Stop and restart.**

## Testing Tools

For test options (pytest, Playwright, ydotool), see dev-test skill.

Tests must EXECUTE code and VERIFY behavior. Grepping is NOT testing.

## If Unclear
Ask questions BEFORE implementing. Don't guess.

## Output
Report:
- RED: What test failed and how
- GREEN: What made it pass
- Test command and output
- Commit SHA
- Any concerns
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

## CRITICAL: Do Not Trust the Report

The implementer finished suspiciously quickly. Their report may be incomplete,
inaccurate, or optimistic. You MUST verify everything independently.

**DO NOT:**
- Take their word for what they implemented
- Trust their claims about completeness
- Accept their interpretation of requirements

**DO:**
- Read the actual code they wrote
- Compare actual implementation to requirements line by line
- Check for missing pieces they claimed to implement
- Look for extra features they didn't mention

## Review Checklist
1. Does implementation meet ALL requirements?
2. Is anything MISSING from the spec?
3. Is anything EXTRA not in the spec?

## Output Format
- COMPLIANT: All requirements met, nothing extra (after verifying code yourself)
- ISSUES: List what's missing or extra with file:line references

Be strict. "Close enough" is not compliant. Verify by reading code.
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

**Main chat invokes:**
- `dev-implement` → `dev-ralph-loop` → `dev-delegate` (this skill)

**Task agents follow:**
- `dev-tdd` - TDD protocol (RED-GREEN-REFACTOR)
- `dev-test` - Testing tools (pytest, Playwright, ydotool)

After all tasks complete with passing tests, `dev-implement` proceeds to `dev-review`.
