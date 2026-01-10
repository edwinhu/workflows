---
name: dev-design
description: "REQUIRED Phase 4 of /dev workflow. Proposes architecture approaches with trade-offs and gets user approval."
---

**Announce:** "I'm using dev-design (Phase 4) to propose implementation approaches."

## Contents

- [The Iron Law of Design](#the-iron-law-of-design)
- [What Design Does](#what-design-does)
- [Process](#process)
- [Approach Categories](#approach-categories)
- [PLAN.md Format](#planmd-format)
- [Red Flags](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Architecture Design with User Gate

Propose implementation approaches, explain trade-offs, get user approval.
**Prerequisites:** SPEC.md finalized, exploration complete, clarifications resolved.

<EXTREMELY-IMPORTANT>
## The Iron Law of Design

**USER MUST APPROVE BEFORE IMPLEMENTATION. This is not negotiable.**

After presenting approaches:
1. Show 2-3 options with trade-offs
2. Lead with your recommendation
3. **Ask user which approach**
4. **Wait for explicit approval**

Implementation CANNOT start without user saying "Yes" or choosing an approach.

**If you catch yourself about to implement without user approval, STOP.**
</EXTREMELY-IMPORTANT>

## What Design Does

| DO | DON'T |
|----|-------|
| Propose 2-3 approaches | Implement anything |
| Explain trade-offs clearly | Make the choice for user |
| Lead with recommendation | Present without opinion |
| Get explicit approval | Assume approval |
| Write PLAN.md | Skip the user gate |

**Design answers: HOW to build it and WHY this approach**
**Implement executes: the approved approach** (next phase, after gate)

## Process

### 1. Review Inputs

Before designing, ensure you have:
- `.claude/SPEC.md` - final requirements
- Exploration findings - key files, patterns
- Clarified decisions - edge cases, integrations

### 2. Propose 2-3 Approaches

Each approach should address the same requirements differently:

**Approach A: Minimal Changes**
- Smallest diff, maximum reuse
- Trade-off: May be less clean, tech debt

**Approach B: Clean Architecture**
- Best patterns, maintainability
- Trade-off: More changes, longer implementation

**Approach C: Pragmatic Balance**
- Balance of speed and quality
- Trade-off: Compromise on both

### 3. Present with Trade-offs

Use AskUserQuestion to present approaches:

```
AskUserQuestion(questions=[{
  "question": "Which architecture approach should we use?",
  "header": "Architecture",
  "options": [
    {
      "label": "Pragmatic Balance (Recommended)",
      "description": "Extend existing AuthService with new method. ~150 lines changed. Balances reuse with clean separation."
    },
    {
      "label": "Minimal Changes",
      "description": "Add logic to existing endpoint. ~50 lines changed. Fast but increases coupling."
    },
    {
      "label": "Clean Architecture",
      "description": "New service with full abstraction. ~300 lines. Most maintainable but longest to build."
    }
  ],
  "multiSelect": false
}])
```

**Key principles:**
- Lead with recommendation (first option + "Recommended")
- Concrete numbers (lines changed, files affected)
- Clear trade-offs for each
- Reference specific files from exploration

### 4. Write PLAN.md

After user chooses, write `.claude/PLAN.md`:

```markdown
# Implementation Plan: [Feature]

> **For Claude:** REQUIRED SUB-SKILL: Use `Skill(skill="workflows:dev-implement")` to implement this plan.
>
> **Per-Task Ralph Loops:** Each task below gets its OWN ralph loop. Do NOT use one loop for all tasks.
>
> **Delegation:** Main chat orchestrates, Task agents implement. Use `Skill(skill="workflows:dev-delegate")` for subagent templates.

## Chosen Approach
[Name]: [Brief description]

## Rationale
- [Why this approach fits]
- [Trade-offs accepted]

## Files to Modify
| File | Change |
|------|--------|
| `src/auth/service.ts` | Add `validateSession()` method |
| `src/routes/api.ts` | Add new endpoint |

## New Files
| File | Purpose |
|------|---------|
| `src/auth/types.ts` | Session type definitions |

## Implementation Order (with Per-Task Ralph Loops)

> **For Claude:** Each task = one ralph loop. Complete task N before starting task N+1.
>
> Pattern: `Skill(skill="ralph-loop:ralph-loop", args="Task N: [name] --max-iterations 10 --completion-promise TASKN_DONE")`

| Task | Ralph Loop | Core Test (MUST EXECUTE CODE) | Verify Command |
|------|------------|-------------------------------|----------------|
| 1. Add types | `"Task 1: Add types" → TASK1_DONE` | N/A (types only) | `tsc --noEmit` |
| 2. Service method | `"Task 2: Service method" → TASK2_DONE` | `test_validate_session()` calls method, checks return | `pytest tests/test_auth.py -v` |
| 3. Route handler | `"Task 3: Route handler" → TASK3_DONE` | Integration test hits endpoint, checks response | `pytest tests/test_api.py -v` |

### What Counts as a REAL Test

| ✅ REAL (execute + verify) | ❌ NOT A TEST (never do this) |
|----------------------------|-------------------------------|
| pytest calls function | grep for function exists |
| Playwright clicks button | ast-grep finds pattern |
| API request checks response | Log says "success" |
| Screenshot comparison | "Code looks correct" |

**Every task MUST have a test that EXECUTES the code and VERIFIES behavior.**
```

### 5. User Gate - Final Approval

After writing PLAN.md, explicit approval:

```
AskUserQuestion(questions=[{
  "question": "Ready to start implementation?",
  "header": "Approval",
  "options": [
    {"label": "Yes, proceed", "description": "Start /dev-implement with TDD"},
    {"label": "No, discuss changes", "description": "Modify the plan first"}
  ],
  "multiSelect": false
}])
```

**Only proceed to /dev-implement after "Yes, proceed".**

## Approach Categories

| Category | When to Use | Trade-off |
|----------|-------------|-----------|
| Minimal | Bug fixes, small features | Speed vs cleanliness |
| Clean | New systems, core features | Quality vs time |
| Pragmatic | Most features | Balance |

## PLAN.md Format

Required sections:
- **Chosen Approach** - What was selected and why
- **Files to Modify** - Specific paths with change descriptions
- **New Files** - If any, with purposes
- **Implementation Order** - Ordered task list with dependencies
- **Testing Strategy** - How to verify

## The Gate Function

Before starting implementation, you MUST have completed:

```
1. REVIEW → Read SPEC.md and exploration findings
2. PROPOSE → Present 2-3 approaches with trade-offs
3. ASK → Use AskUserQuestion with clear options
4. WAIT → Do NOT proceed until user responds
5. DOCUMENT → Write chosen approach to PLAN.md
6. CONFIRM → Ask "Ready to proceed?"
7. GATE → Only start /dev-implement after explicit "Yes"
```

**Skipping any step, especially WAIT and GATE, is insubordination.**

## Rationalization Prevention

These thoughts mean STOP—you're about to bypass the user gate:

| Thought | Reality |
|---------|---------|
| "User will approve this" | Assumption ≠ approval. Ask and wait. |
| "It's the obvious choice" | User decides what's obvious. Present options. |
| "Let me just start" | NO. Gate exists for a reason. Wait. |
| "User said they trust me" | Trust doesn't mean skip approval. Ask. |
| "Time pressure" | Wrong approach wastes more time. Wait for approval. |
| "Only one viable option" | Present it anyway. User may see alternatives. |
| "I'll ask forgiveness later" | No. Ask permission now. |

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Present only one approach | User has no choice | Always show 2-3 options |
| Skip trade-offs | User can't make informed decision | Explain pros/cons clearly |
| Start implementing | No approval yet | Wait for explicit "Yes" |
| Assume recommendation accepted | User might prefer different | Ask and wait for answer |

## Output

Design complete when:
- 2-3 approaches presented with trade-offs
- User chose an approach
- `.claude/PLAN.md` written with chosen approach
- **User explicitly approved** ("Yes, proceed")

## Phase Complete

**REQUIRED SUB-SKILL:** After user approves ("Yes, proceed"), IMMEDIATELY invoke:
```
Skill(skill="workflows:dev-implement")
```

Do NOT proceed without explicit user approval.
