---
name: dev-brainstorm
description: "REQUIRED Phase 1 of /dev workflow. Uses Socratic questioning to understand requirements before exploration."
---

**Announce:** "I'm using dev-brainstorm (Phase 1) to gather requirements."

## First: Activate Workflow

Before anything else, activate the dev workflow. This enables workflow-specific hooks (sandbox enforcement, TDD checks, etc.).

**Activate dev workflow by creating timestamp file:**

```bash
mkdir -p /tmp/claude-workflow-$PPID && touch /tmp/claude-workflow-$PPID/dev_mode && echo "✓ Dev workflow activated"
```

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

Before exploring codebase, before proposing approaches, follow these requirements:
1. Ask clarifying questions using AskUserQuestion
2. Understand what the user actually wants
3. Define success criteria

Approaches come later (in /dev-design) after exploring the codebase.

**If YOU catch YOURSELF about to explore the codebase before asking questions, STOP.**
</EXTREMELY-IMPORTANT>

### Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The requirements seem obvious" | Your assumptions are often wrong | ASK questions to confirm |
| "Let me just look at the code to understand" | Code tells HOW, not WHY | ASK what user wants first |
| "I can gather requirements while exploring" | You'll waste time on distraction and miss critical questions | QUESTIONS FIRST, exploration later |
| "User already explained everything" | You'll find users always leave out critical details | ASK clarifying questions anyway |
| "I'll ask if I need more info" | You cannot know unknown unknowns without asking | ASK questions NOW, not later |
| "Quick peek at the code won't hurt" | You'll let codebases bias your thinking | STAY IGNORANT until requirements clear |
| "I can propose approaches based on description" | You need exploration to precede design | WAIT for dev-design phase |

### Honesty Framing

**Guessing user requirements is LYING about what they want.**

Asking questions is cheap. Building the wrong thing is expensive. Every minute spent clarifying requirements saves hours of wasted implementation.

### No Pause After Completion

After writing `.claude/SPEC.md` and completing brainstorm, immediately invoke the next phase:

**Invoke the explore phase:**

```bash
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-explore/SKILL.md")
```

DO NOT:
- Summarize what was learned
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

Use `AskUserQuestion` immediately with these principles:
- **One question at a time** - never batch
- **Multiple-choice preferred** - easier to answer
- Focus on: purpose, constraints, success criteria

Example questions to ask:
- "What problem does this solve?"
- "Who will use this feature?"
- "What's the most important requirement?"
- "Any constraints (performance, compatibility)?"

### 2. Ask About Testing Strategy (MANDATORY)

<EXTREMELY-IMPORTANT>
**THE TESTING QUESTION IS NOT OPTIONAL. This is the moment to prevent "no tests" rationalization.**

After understanding what to build, immediately ask:

```python
AskUserQuestion(questions=[{
  "question": "How will we verify this works automatically?",
  "header": "Testing",
  "options": [
    {"label": "Unit tests (pytest/jest/etc.)", "description": "Test functions/methods in isolation"},
    {"label": "Integration tests", "description": "Test component interactions"},
    {"label": "E2E automation (Playwright/ydotool)", "description": "Simulate real user interactions"},
    {"label": "API tests", "description": "Test HTTP endpoints directly"}
  ],
  "multiSelect": true
}])
```

**If user says "manual testing only" → This is a BLOCKER, not a workaround.**

| User Says | Your Response |
|-----------|---------------|
| "Manual testing" | "That's not acceptable for /dev workflow. What's blocking automated tests?" |
| "No test infrastructure" | "Let's add one. What framework fits this codebase?" |
| "Too hard to test" | "What specifically is hard? Let's solve that first." |
| "Just this once" | "No exceptions. TDD is the workflow, not optional." |

**Why this matters:** If you don't ask about testing NOW, you'll rationalize skipping it later.
</EXTREMELY-IMPORTANT>

### 3. Define Success Criteria

After understanding requirements AND testing strategy, define measurable success criteria:
- Turn requirements into measurable criteria
- Use checkboxes for clear pass/fail
- Confirm criteria with user
- **Include at least one testable criterion per requirement**

### 4. Write Draft SPEC.md

Write the initial spec to `.claude/SPEC.md`:

```markdown
# Spec: [Feature Name]

> **For Claude:** After writing this spec, use `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-explore/SKILL.md")` for Phase 2.

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

## Testing Strategy (MANDATORY - USER APPROVED)

> **For Claude:** Use `Skill(skill="workflows:dev-test")` for automation options.
>
> **⚠️ NO IMPLEMENTATION WITHOUT TESTS. If this section is empty, STOP.**

- **User's chosen approach:** [From AskUserQuestion in Phase 1: unit/integration/E2E/API]
- **Framework:** [pytest / playwright / jest / etc.]
- **Command:** [e.g., `pytest tests/ -v`]
- **First failing test (describe it):** [What test will you write FIRST?]
- **Core functionality to verify:** [what MUST be tested automatically]

### The Iron Law of Testing

**If no automated test strategy exists, implementation CANNOT proceed.**

This is NOT a suggestion. This is a gate. If you find yourself thinking "let me implement first, then add tests" - STOP. You're violating TDD.

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

### No Test Infrastructure? That's a BLOCKER.

If the project has no tests, your first task is to ADD test infrastructure, not skip testing.

| Situation | Response |
|-----------|----------|
| "Project has no tests" | Add test framework as Task 0 |
| "Hard to test (DOM/UI/etc)" | Use E2E tools: Playwright, ydotool, screenshot comparison |
| "No time for tests" | TDD saves time. No shortcuts. |
| "User said manual testing" | Push back. Ask what's blocking automation. |

## Open Questions
- [Questions to resolve during exploration]
```

**Note:** No "Chosen Approach" yet - that comes after exploration and design phases.

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Spawn explore agent | You're exploring before understanding | Ask questions first |
| Read source files | You're looking at code before requirements are clear | Ask what user wants |
| Propose approaches | You're jumping ahead - you need exploration first | Save for /dev-design |
| Create task list | You're planning before you understand the requirements | Finish brainstorm first |

## Output

Brainstorm complete when:
- Problem is clearly understood
- Requirements defined
- Success criteria defined
- `.claude/SPEC.md` written (draft)
- Open questions identified for exploration

## Phase Complete

**REQUIRED SUB-SKILL:** After completing brainstorm, immediately invoke the explore phase:

**Start explore phase - Phase 2:**

```bash
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-explore/SKILL.md")
```
