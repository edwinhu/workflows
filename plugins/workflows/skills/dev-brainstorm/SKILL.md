---
name: dev-brainstorm
description: This skill should be used when the user asks to "brainstorm a feature", "discuss requirements", "clarify the design", "refine the idea", or as Phase 1 of the /dev workflow. Uses Socratic questioning to explore design before implementation.
---

## Contents

- [The Iron Law of Brainstorming](#the-iron-law-of-brainstorming)
- [What Brainstorm Does](#what-brainstorm-does)
- [Process](#process)
- [Red Flags - STOP If You're About To](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Brainstorming (Questions Only)

Refine vague ideas into clear requirements through Socratic questioning.
**NO exploration, NO planning** - just questions and design.

<EXTREMELY-IMPORTANT>
## The Iron Law of Brainstorming

**ASK QUESTIONS BEFORE ANYTHING ELSE. This is not negotiable.**

Before exploring codebase, before proposing approaches, you MUST:
1. Ask clarifying questions using AskUserQuestion
2. Understand what the user actually wants
3. Define success criteria
4. Only THEN propose approaches

**If you catch yourself about to explore the codebase before asking questions, STOP.**
</EXTREMELY-IMPORTANT>

## What Brainstorm Does

| DO | DON'T |
|-------|----------|
| Ask clarifying questions | Explore codebase |
| Understand requirements | Spawn explore agents |
| Define success criteria | Look at existing code |
| Propose 2-3 approaches | Create implementation tasks |
| Write design doc | Plan file changes |

**Brainstorm answers: WHAT and WHY**
**Plan answers: HOW and WHERE** (separate skill)

## Process

### 1. Ask Questions First

Use `AskUserQuestion` immediately:
- **One question at a time** - never batch
- **Multiple-choice preferred** - easier to answer
- Focus on: purpose, constraints, success criteria

### 2. Propose Approaches

Once requirements are clear:
- Propose **2-3 different approaches** with trade-offs
- **Lead with recommendation** (mark as "Recommended")
- Use `AskUserQuestion` for user to pick

### 3. Write Spec Doc

After approach is chosen:
- Write to `.claude/SPEC.md`
- Include: problem, requirements, success criteria, chosen approach
- **NO implementation details** - that's for /dev-plan

```markdown
# Spec: [Feature Name]

## Problem
[What problem this solves]

## Requirements
- [Requirement 1]
- [Requirement 2]

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Chosen Approach
[Description of selected approach]

## Rejected Alternatives
- Option B: [why rejected]
- Option C: [why rejected]
```

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Spawn explore agent | Exploring before understanding | Ask questions first |
| Read source files | Looking at code before requirements | Ask what user wants |
| Propose implementation | Jumping to HOW before WHAT | Define requirements first |
| Create task list | Planning before design | Finish brainstorm first |

## Output

Brainstorm complete when:
- Problem is clearly understood
- Requirements defined
- Success criteria defined
- Approach chosen from alternatives
- `.claude/SPEC.md` written
- User confirms ready for planning

**Next step:** `/dev-plan` for codebase exploration and task breakdown
