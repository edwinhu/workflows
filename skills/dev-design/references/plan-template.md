# PLAN.md Template

Use this template when writing `.planning/PLAN.md` after user approves an approach.

*All paths below are relative to this skill's base directory.*
```markdown
# Implementation Plan: [Feature]

> **For Claude:** REQUIRED SUB-SKILL: Discover and read `skills/dev-implement/SKILL.md` via cache lookup to implement this plan.
>
> **Cross-Turn Iteration via `/goal`:** Set one `/goal` for the implementation phase whose condition covers all tasks in PLAN.md plus the Testing Strategy command. Work through tasks sequentially across turns under that active goal.
>
> **Delegation:** Main chat orchestrates, Task agents implement. Discover and read `skills/dev-delegate/SKILL.md` via cache lookup for subagent templates.
>
> **Cache lookup pattern:**
>Read `${CLAUDE_SKILL_DIR}/../../TARGET/PATH` and follow its instructions.

## Chosen Approach
[Name]: [Brief description]

## Rationale
- [Why this approach fits]
- [Trade-offs accepted]

## Global Constraints

> **Recommended, not required (backward-compatible).** Rules that bind EVERY task —
> invariants no single task may break (naming conventions, error-handling policy,
> "all timestamps UTC", "no new runtime deps without R4", security rules). `task-brief.sh`
> copies this block verbatim into every per-task brief, so each implementer/reviewer
> sees the cross-cutting rules without re-reading the whole plan. A plan with no
> Global Constraints still parses and produces valid (constraint-free) briefs.

- CON-1: [invariant binding every task]
- CON-2: [invariant binding every task]

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

The PLAN.md must specify REAL tests (not fake ones). See `references/constraints/real-test-enforcement.md` for the Iron Law of REAL Tests and detection tables.

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

### TDD Facts

- Missing test infrastructure is not an exemption — adding it becomes Task 0 of the plan.
- "Hard to test" has tooling answers (Playwright, ydotool, E2E harnesses); if none fit, ask the user. Silently planning an untested task hands the user the debugging later — counterproductive on its own terms.
- Manual testing in SPEC.md — even user-approved — does not override TDD. Push back or fix the SPEC.

### Fake Test Detection

See `references/constraints/real-test-enforcement.md` for fake test detection facts and red flags.

## Files to Modify
| File | Change |
|------|--------|
| `src/auth/service.ts` | Add `validateSession()` method |
| `src/routes/api.ts` | Add new endpoint |

## New Files
| File | Purpose |
|------|---------|
| `src/auth/types.ts` | Session type definitions |

## Implementation Order — MANDATORY EXECUTABLE TABLE

> **This table is the machine-executable spec.** `dev-implement` reads it directly: it topologically sorts `Deps` into dependency levels, runs each level's tasks in parallel (one worktree-isolated implementer per task), merges, and gates each task on its `Verify Command` exit code. **A plan without a complete table is not executable — `dev-plan-executable-guard.py` blocks `PLAN_REVIEWED.md` until every row is filled.**
>
> **Every task MUST be one table row** — do NOT carry the work in prose `### Phase` headings (a phase label, if useful, lives in the task name). Every column is REQUIRED for every code task:
>
> | Column | Rule |
> |--------|------|
> | **Task** | `N. <name>` — N is a unique integer, referenced by `Deps` |
> | **Deps** | the DAG: `---` (no deps, parallelizable) or `after N` / `after N,M` (fan-in). Must reference real task numbers; no cycles |
> | **Files** | every file the task creates/edits (comma-separated, repo-relative). Drives conflict detection + worktree merge — same-level tasks with disjoint Files run in parallel; overlapping Files serialize |
> | **Failing Test** | the test written FIRST (TDD RED). `N/A` only for types-only / meta tasks |
> | **Verify Command** | the deterministic command whose exit-0 IS the per-task gate (`pytest tests/test_x.py -v`, `tsc --noEmit`). NEVER empty for a code task |
> | **Implements** | SPEC.md requirement ID(s). Must trace to a real ID in the Requirements table |
>
> **TDD:** every code task writes its Failing Test before implementation. **`/goal` pattern:** `/goal All tasks in PLAN.md pass their Verify Command, full suite green, VALIDATION.md status = validated. Stop after [N] turns.`
> **>15 tasks:** group with a `Phase`/`Chunk` prefix in the task name (e.g. `3. [core] route handler`); the reviewer reviews per group. The table stays single + flat so `Deps` remains the one source of ordering truth.

| Task | Deps | Files | Failing Test (write FIRST) | Verify Command | Implements |
|------|------|-------|----------------------------|----------------|------------|
| 0. Test infrastructure | `---` | `package.json, vitest.config.ts` | N/A (meta) | `npm test -- --version` | `INFRA-01` |
| 1. Add types | `after 0` | `src/auth/types.ts` | N/A (types only) | `tsc --noEmit` | `AUTH-01` |
| 2. Service method | `after 1` | `src/auth/service.ts, src/auth/service.test.ts` | `test_validate_session()` | `pytest tests/test_auth.py -v` | `AUTH-01, AUTH-02` |
| 3. Route handler | `after 1` | `src/routes/api.ts, src/routes/api.test.ts` | `test_api_endpoint()` | `pytest tests/test_api.py -v` | `API-01` |

> Tasks 2 and 3 share `Deps: after 1` and touch disjoint Files → `dev-implement` runs them **in parallel** (same level), merges, then runs the full suite.

## Task Interfaces

> **Recommended, not required (backward-compatible).** One block per task naming exactly
> what it **Consumes** (inputs/symbols/files it depends on) and **Produces** (the
> contract downstream tasks rely on). `task-brief.sh` folds a task's block into its brief,
> so an implementer knows its boundary without reading sibling tasks. Keep the parsed
> Implementation Order table flat — interfaces live here as prose sub-blocks, NOT as
> extra table columns. Heading MUST be `### Task N` (the parser matches on the number).

### Task 1
- Consumes: —
- Produces: `src/auth/types.ts` — `Session` type (used by Tasks 2, 3)

### Task 2
- Consumes: `src/auth/types.ts` (`Session`)
- Produces: `validateSession(req): Session | null` in `src/auth/service.ts`

### Task 3
- Consumes: `src/auth/types.ts` (`Session`)
- Produces: `POST /api/session` route in `src/routes/api.ts`
```
