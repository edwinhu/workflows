---
name: dev-brainstorm
description: "REQUIRED Phase 1 of /dev workflow. Uses Socratic questioning to understand requirements before exploration."
---

**Announce:** "I'm using dev-brainstorm (Phase 1) to gather requirements."

## First: Activate Workflow

Before anything else, activate the dev workflow:

```bash
mkdir -p /tmp/claude-workflow-$PPID && touch /tmp/claude-workflow-$PPID/dev_mode && echo "✓ Dev workflow activated"
```

This enables workflow-specific hooks (sandbox enforcement, TDD checks, etc.).

## Contents

- [The Iron Law of Brainstorming](#the-iron-law-of-brainstorming)
- [What Brainstorm Does](#what-brainstorm-does)
- [Process](#process)
- [Red Flags - STOP If You're About To](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Brainstorming (Questions Only)

Refine vague ideas into clear requirements through Socratic questioning.
**NO exploration, NO approaches** - just questions and requirements.

<EXTREMELY-IMPORTANT>
## The Iron Law of Brainstorming

**ASK QUESTIONS BEFORE ANYTHING ELSE. This is not negotiable.**

Before exploring codebase, before proposing approaches, you MUST:
1. Ask clarifying questions using AskUserQuestion
2. Understand what the user actually wants
3. Define success criteria

Approaches come later (in /dev-design) after exploring the codebase.

**If you catch yourself about to explore the codebase before asking questions, STOP.**
</EXTREMELY-IMPORTANT>

### Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The requirements seem obvious" | Your assumptions are often wrong | ASK questions to confirm |
| "Let me just look at the code to understand" | Code tells you HOW, not WHY | ASK what user wants first |
| "I can gather requirements while exploring" | You'll get distracted and miss key questions | QUESTIONS FIRST, exploration later |
| "User already explained everything" | Users always leave out critical details | ASK clarifying questions anyway |
| "I'll ask if I need more info" | You won't know what you don't know | ASK questions NOW, not later |
| "Quick peek at the code won't hurt" | Codebases bias your thinking | STAY IGNORANT until requirements clear |
| "I can propose approaches based on description" | You haven't seen the codebase yet | WAIT for dev-design phase |

### Honesty Framing

**Guessing user requirements is LYING about what they want.**

Asking questions is cheap. Building the wrong thing is expensive. Every minute spent clarifying requirements saves hours of wasted implementation.

### No Pause After Completion

After writing `.claude/SPEC.md` and completing brainstorm, IMMEDIATELY invoke:
```
Skill(skill="workflows:dev-explore")
```

DO NOT:
- Summarize what you learned
- Ask "should I proceed?"
- Wait for user confirmation
- Write status updates

The workflow phases are SEQUENTIAL. Complete brainstorm → immediately start explore.

## What Brainstorm Does

| DO | DON'T |
|----|-------|
| Ask clarifying questions | Explore codebase |
| Understand requirements | Spawn explore agents |
| Define success criteria | Look at existing code |
| Write draft SPEC.md | Propose approaches (that's design) |
| Identify unknowns | Create implementation tasks |

**Brainstorm answers: WHAT do we need and WHY**
**Explore answers: WHERE is the code** (next phase)
**Design answers: HOW to build it** (after exploration)

## Process

### 1. Ask Questions First

Use `AskUserQuestion` immediately:
- **One question at a time** - never batch
- **Multiple-choice preferred** - easier to answer
- Focus on: purpose, constraints, success criteria

Example questions:
- "What problem does this solve?"
- "Who will use this feature?"
- "What's the most important requirement?"
- "Any constraints (performance, compatibility)?"

### 2. Define Success Criteria

After understanding requirements:
- Turn requirements into measurable criteria
- Use checkboxes for clear pass/fail
- Confirm with user

### 3. Write Draft SPEC.md

Write initial spec to `.claude/SPEC.md`:

```markdown
# Spec: [Feature Name]

> **For Claude:** After writing this spec, use `Skill(skill="workflows:dev-explore")` for Phase 2.

## Problem
[What problem this solves]

## Requirements
- [Requirement 1]
- [Requirement 2]

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Constraints
- [Any limitations or boundaries]

## Automated Testing (MANDATORY)

> **For Claude:** Use `Skill(skill="workflows:dev-test")` for automation options.

- **Framework:** [pytest / playwright / jest / etc.]
- **Command:** [e.g., `pytest tests/ -v`]
- **Core functionality to verify:** [what MUST be tested automatically]

### What Counts as a Real Automated Test

| ✅ REAL TEST (execute + verify) | ❌ NOT A TEST (never acceptable) |
|---------------------------------|----------------------------------|
| pytest calls function, checks return value | grep/ast-grep finds function exists |
| Playwright clicks button, verifies result | Check logs say "success" |
| ydotool simulates user, screenshot verifies | Read source code structure |
| API call returns expected response | "Code looks correct" |
| CLI invocation produces expected output | Structural pattern matching |

**THE TEST MUST EXECUTE THE CODE AND VERIFY RUNTIME BEHAVIOR.**

Grepping is not testing. Log checking is not testing. Code review is not testing.

## Open Questions
- [Questions to resolve during exploration]
```

**Note:** No "Chosen Approach" yet - that comes after exploration and design phases.

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Spawn explore agent | Exploring before understanding | Ask questions first |
| Read source files | Looking at code before requirements | Ask what user wants |
| Propose approaches | Too early - need to explore first | Save for /dev-design |
| Create task list | Planning before understanding | Finish brainstorm first |

## Output

Brainstorm complete when:
- Problem is clearly understood
- Requirements defined
- Success criteria defined
- `.claude/SPEC.md` written (draft)
- Open questions identified for exploration

## Phase Complete

**REQUIRED SUB-SKILL:** After completing brainstorm, IMMEDIATELY invoke:
```
Skill(skill="workflows:dev-explore")
```
