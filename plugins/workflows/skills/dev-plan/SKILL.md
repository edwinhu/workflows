---
name: dev-plan
description: This skill should be used when the user asks to "plan the implementation", "break down the tasks", "explore the codebase", or as Phase 2 of the /dev workflow after brainstorming. Creates task breakdown from codebase exploration.
---

## Contents

- [The Iron Law of Planning](#the-iron-law-of-planning)
- [What Plan Does](#what-plan-does)
- [Process](#process)
- [Output](#output)

# Planning (Exploration + Task Breakdown)

Explore the codebase and create an implementation plan based on the spec.
**Requires `.claude/SPEC.md` from /dev-brainstorm first.**

<EXTREMELY-IMPORTANT>
## The Iron Law of Planning

**SPEC MUST EXIST BEFORE PLANNING. This is not negotiable.**

Before exploring code or creating tasks, you MUST have:
1. `.claude/SPEC.md` with requirements and chosen approach
2. Clear success criteria
3. User-approved spec

**If `.claude/SPEC.md` doesn't exist, run /dev-brainstorm first.**
</EXTREMELY-IMPORTANT>

## What Plan Does

| DO | DON'T |
|-------|----------|
| Read .claude/SPEC.md | Skip brainstorm phase |
| Explore codebase | Ask requirement questions |
| Find relevant patterns | Change the spec |
| Identify files to modify | Write implementation code |
| Create ordered task list | Run tests |
| Write .claude/PLAN.md | Make completion claims |

**Brainstorm answers: WHAT and WHY**
**Plan answers: HOW and WHERE**

## Process

### 1. Verify Spec Exists

```bash
cat .claude/SPEC.md
```

If missing, stop and run `/dev-brainstorm` first.

### 2. Explore Codebase

Spawn explore agents to understand the codebase:

```
Task(subagent_type="Explore", prompt="""
Based on .claude/SPEC.md, find:
1. Existing patterns for [chosen approach]
2. Files that will need modification
3. Similar implementations to reference
4. Potential conflicts or dependencies

Report: files, patterns, and recommendations.
""")
```

### 3. Create Task Breakdown

Break implementation into ordered tasks:
- Each task should be **independently testable**
- Order by dependencies (what must come first)
- Estimate complexity (small/medium/large)

### 4. Write Plan Doc

Write to `.claude/PLAN.md`:

```markdown
# Implementation Plan: [Feature Name]

## Spec Reference
See: .claude/SPEC.md

## Codebase Analysis

### Relevant Patterns
- [Pattern 1]: Found in [file], can reuse for [purpose]
- [Pattern 2]: [description]

### Files to Modify
1. `path/to/file1` - [what changes]
2. `path/to/file2` - [what changes]

### New Files
1. `path/to/new` - [purpose]

## Task Breakdown

### Task 1: [Name] (small)
- File: `path/to/file`
- Change: [description]
- Test: [how to verify]
- Dependencies: none

### Task 2: [Name] (medium)
- File: `path/to/file`
- Change: [description]
- Test: [how to verify]
- Dependencies: Task 1

## Testing Strategy
- Unit tests: [what to test]
- Integration: [what to test]

## Risks
- [Risk 1]: [mitigation]
```

## Output

Plan complete when:
- `.claude/SPEC.md` was read and understood
- Codebase explored for patterns
- Files to modify identified
- Tasks ordered by dependency
- `.claude/PLAN.md` written
- User confirms ready for implementation

**Next step:** `/dev-implement` for TDD implementation
