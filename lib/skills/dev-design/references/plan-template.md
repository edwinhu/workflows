# PLAN.md Template

Use this template when writing `.claude/PLAN.md` after user approves an approach.

```markdown
# Implementation Plan: [Feature]

> **For Claude:** REQUIRED SUB-SKILL: Invoke `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-implement/SKILL.md")` to implement this plan.
>
> **Per-Task Ralph Loops:** Assign each task its OWN ralph loop. Do NOT combine multiple tasks into one loop.
>
> **Delegation:** Main chat orchestrates, Task agents implement. Use `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-delegate/SKILL.md")` for subagent templates.

## Chosen Approach
[Name]: [Brief description]

## Rationale
- [Why this approach fits]
- [Trade-offs accepted]

## Testing Strategy (MANDATORY - GATE)

> **This section MUST be complete BEFORE implementation.**
> **If any field is empty, implementation CANNOT proceed.**

| Field | Value | Status |
|-------|-------|--------|
| **Framework** | [pytest / jest / playwright / etc.] | [ ] Filled |
| **Test Command** | [e.g., `pytest tests/ -v`] | [ ] Filled |
| **First Failing Test** | [Description of what test will fail first] | [ ] Filled |
| **Test File Location** | [e.g., `tests/test_feature.py`] | [ ] Filled |
| **Testing Skill** | [dev-test-electron / dev-test-playwright / etc.] | [ ] Filled |

## REAL Test Criteria (MANDATORY - PREVENTS FAKE TESTS)

> **A test that doesn't replicate user workflow is a FAKE test.**
> **If this section is empty or incorrect, you WILL write fake tests.**

| Criteria | Value | Verified |
|----------|-------|----------|
| **User workflow to replicate** | [e.g., "highlight -> click panel -> see status"] | [ ] |
| **Protocol/transport** | [e.g., "WebSocket" - must match production] | [ ] |
| **UI elements to interact with** | [e.g., "Claude terminal panel"] | [ ] |
| **What user sees/verifies** | [e.g., "'X lines selected' in status"] | [ ] |
| **Code path exercised** | [e.g., "selection -> WebSocket -> panel update"] | [ ] |

### Fake Test Prevention Checklist

Before implementation, verify:

```
[ ] Test uses SAME protocol as production (not a different one)
[ ] Test follows user's EXACT workflow (not a shortcut)
[ ] Test interacts with ACTUAL UI elements (not direct function calls)
[ ] Test verifies what USER sees (not internal state)
[ ] Test uses the SPECIFIED testing skill (not your own approach)
```

**If ANY box is unchecked -> You WILL write fake tests. Fix now.**

### Test Strategy in Design

The PLAN.md must specify REAL tests (not fake ones). See `lib/references/real-test-enforcement.md` for the Iron Law of REAL Tests and detection tables.

### The Iron Law of This Plan

**NO TASK STARTS UNTIL ITS TEST IS WRITTEN.**

For each task below:
1. Write the test FIRST (RED)
2. Run the test, see it FAIL
3. Implement the code (GREEN)
4. Refactor if needed

**If you skip the test, DELETE your implementation and start over.**

### What Counts as a REAL Test

| REAL (execute + verify) | NOT A TEST (never do this) |
|----------------------------|-------------------------------|
| pytest calls function | grep for function exists |
| Playwright clicks button | ast-grep finds pattern |
| API request checks response | Log says "success" |
| Screenshot comparison | "Code looks correct" |

**Every task MUST have a test that EXECUTES the code and VERIFIES behavior.**

### Rationalization Prevention (No Tests)

If you catch yourself thinking these thoughts, STOP:

| Thought | Reality |
|---------|---------|
| "No test infrastructure exists" | Add it as Task 0. That's the plan now. |
| "This is hard to test" | Use E2E tools (Playwright, ydotool). Ask user. |
| "I'll add tests later" | No. TDD means tests FIRST. |
| "Just this one task without tests" | No exceptions. Ever. |
| "Manual testing is in SPEC.md" | That's wrong. Fix it or ask user. |
| "User approved manual testing" | Push back. TDD is the workflow. |

### Rationalization Prevention (Fake Tests)

See `lib/references/real-test-enforcement.md` for fake test detection red flags and rationalization patterns.

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
> **TDD ENFORCEMENT:** Every task with code MUST have a failing test written BEFORE implementation.
>
> Pattern: `Skill(skill="ralph-loop:ralph-loop", args="Task N: [name] --max-iterations 10 --completion-promise TASKN_DONE")`
>
> **Task Dependencies:** Mark each task's `Deps` column: `---` = no dependencies (parallelizable), `after N` = must follow task N. Tasks with `---` or the same dependency can run in parallel when using agent team mode in dev-implement.

| Task | Deps | Ralph Loop | Failing Test (write FIRST) | Verify Command |
|------|------|------------|----------------------------|----------------|
| 0. Test infrastructure (if needed) | --- | `"Task 0: Test setup" -> TASK0_DONE` | N/A (meta-task) | `pytest --version` or `npm test -- --version` |
| 1. Add types | after 0 | `"Task 1: Add types" -> TASK1_DONE` | N/A (types only) | `tsc --noEmit` |
| 2. Service method | after 1 | `"Task 2: Service method" -> TASK2_DONE` | `test_validate_session()` - write test, see RED, then implement | `pytest tests/test_auth.py -v` |
| 3. Route handler | after 1 | `"Task 3: Route handler" -> TASK3_DONE` | `test_api_endpoint()` - write test, see RED, then implement | `pytest tests/test_api.py -v` |
```
