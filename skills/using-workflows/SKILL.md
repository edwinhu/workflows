---
name: using-workflows
description: Introduction to the workflows skills library and how to use them effectively.
---

# Using Workflows Skills

Welcome! You have access to a complete development workflow library designed to help you write better code faster.

## Core Skills

### Development Workflows

**dev-implement** - Orchestrate implementation with subagents using TDD
- Use when you have an approved design and detailed plan
- Coordinates per-task loops with automated verification
- Ensures every task uses test-driven development

**dev-debug** - Systematic bug investigation and fixing
- Use when you discover a bug
- Follows 4-phase methodology: investigate → analyze → hypothesize → fix
- Requires root cause understanding before writing fixes

**dev-tdd** - Test-Driven Development protocol
- Use during any implementation or bug fix
- RED: write failing test, GREEN: minimal code, REFACTOR: improve
- Tests execute code and verify behavior (not grep)

### Common Workflows

**dev-verify** - Verification checklist before declaring work done
- Use after implementing features or fixing bugs
- Ensures tests pass, no regressions, quality gates met

**dev-review** - Code review guidelines
- Use after all tasks complete
- Checks against plan, code quality, testing coverage

## Using Skills

Load a skill using the `use_skill` tool:

```
use_skill(skill_name="dev-implement")
```

Or reference them by domain:

```
use_skill(skill_name="workflows:dev-debug")
use_skill(skill_name="dev-tdd")
```

## Workflow Patterns

### Adding a Feature

1. **Clarify** what needs to be built
2. **Design** the solution and get approval
3. **Plan** the implementation tasks
4. **Implement** using dev-implement (which uses dev-tdd)
5. **Review** using dev-review
6. **Verify** nothing broke

### Fixing a Bug

1. **Describe** the symptom
2. **Debug** using dev-debug skill (systematic 4-phase approach)
3. **Implement** the fix (automatically uses TDD)
4. **Verify** regression test passes

### When You're Stuck

- **dev-debug** for investigating mysterious failures
- **dev-verify** for checking all requirements are met
- **dev-review** for catching quality issues early

## Key Principles

### Delegation, Not Heroics

Don't write code directly in main chat. Spawn subagents for implementation.

Main chat coordinates. Subagents execute. This separation prevents context bloat and keeps you moving forward.

### Test-Driven Development Always

Every feature and bug fix starts with a failing test.

- RED: Write test, see it fail
- GREEN: Minimal code, see it pass
- REFACTOR: Clean up while staying green

If you haven't seen the test fail, you haven't verified it tests the right thing.

### Systematic Debugging

Bugs don't get fixed randomly. They get investigated:

1. Reproduce with a test
2. Trace the data flow
3. Form a specific hypothesis
4. Test the hypothesis
5. Write a regression test
6. Implement the fix
7. Verify no regressions

"It works now" is not the same as "fixed correctly". Always verify with tests.

### Evidence Over Claims

- Tests execute code (no grepping)
- Regressions are caught by full test suite
- Changes are tracked with git
- Decisions are documented in LEARNINGS.md

## Documentation Files

These files help skills coordinate:

- `.opencode/SPEC.md` or `.claude/SPEC.md` - Requirements and acceptance criteria
- `.opencode/PLAN.md` or `.claude/PLAN.md` - Implementation plan with tasks
- `.opencode/LEARNINGS.md` or `.claude/LEARNINGS.md` - Discoveries, hypotheses, decisions

## Getting Help

Each skill contains:
- What to use it for
- How to use it
- What to expect
- What to do if things go wrong

When stuck, load the relevant skill for detailed guidance.

