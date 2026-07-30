---
name: dev-test-gaps
description: "This skill should be used when validating test coverage against requirements, after implementation tasks complete (Phase 5.5 of /dev workflow). Invoked automatically by dev-implement before review phase."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
---

Announce: "Using dev-test-gaps (Phase 5.5) to validate test coverage against requirements."

**Iteration topology:** parallel fan-out (one test-gap-auditor per MISSING requirement)

**Load shared enforcement:**

Read `${CLAUDE_SKILL_DIR}/../../references/constraints/dev-common-constraints.md`.

### Context Monitoring

Before spawning each batch of test-gap-auditors, check remaining context (a large requirement set + parallel auditors can exhaust it):

| Level | Remaining | Action |
|-------|-----------|--------|
| Normal | >35% | Spawn next auditor(s) |
| Warning | 25-35% | Finish the current auditor, write VALIDATION.md (status: draft), then invoke dev-handoff |
| Critical | ≤25% | Write VALIDATION.md immediately, invoke dev-handoff — resume fresh |

At Warning/Critical: Read `${CLAUDE_SKILL_DIR}/../../skills/dev-handoff/SKILL.md` and follow its instructions.

## Contents

- [The Iron Law of Test-Only](#the-iron-law-of-test-only)
- [Coverage Facts](#coverage-facts)
- [The Process](#the-process)
- [Phase 1: Read Requirements and Plan](#phase-1-read-requirements-and-plan)
- [Phase 2: Scan Test Infrastructure](#phase-2-scan-test-infrastructure)
- [Phase 3: Map Coverage](#phase-3-map-coverage)
- [Phase 4: Classify Coverage](#phase-4-classify-coverage)
- [Phase 5: Fill Gaps](#phase-5-fill-gaps)
- [Phase 6: Produce VALIDATION.md](#phase-6-produce-validationmd)
- [Exit Criteria](#exit-criteria)

# Test Gap Validation

<EXTREMELY-IMPORTANT>
## The Iron Law of Test-Only

**NEVER MODIFY IMPLEMENTATION CODE. TESTS ONLY OR ESCALATE. This is not negotiable.**

Your job is to validate that tests exist for every requirement, and fill gaps by writing NEW tests. You do NOT fix bugs, refactor code, or touch implementation files.

| Allowed | NOT Allowed |
|---------|-------------|
| Read implementation code (for understanding) | Edit implementation code |
| Write new test files | Modify existing implementation files |
| Update existing test files (add cases) | "Quick fix" to make a test pass |
| Create test fixtures/helpers | Change production code to be "more testable" |
| Escalate implementation bugs | Silently work around implementation bugs |

**If a test fails because the implementation is wrong, ESCALATE. Do not fix the implementation.**
</EXTREMELY-IMPORTANT>

## Coverage Facts

- A passing suite proves what IS tested, not what ISN'T — "tests pass, so coverage must be fine" asserts coverage that was never measured, an unverified claim presented as fact. The coverage map (every requirement explicitly classified) is the only evidence.
- TDD during implementation gives *task-level* coverage; this phase checks *requirement-level* coverage. Gaps hide between tasks — a requirement split across tasks, or covered by no task at all. Treating this phase as redundant after TDD conflates the two granularities.
- A requirement that cannot be tested without refactoring the implementation is escalated as "untestable without refactor" — refactoring here would modify implementation code, which violates the Iron Law above.

## The Process

```
1. READ requirements from .planning/SPEC.md
2. READ tasks from .planning/PLAN.md
3. SCAN test infrastructure (framework, config, patterns)
4. MAP each requirement → test coverage
5. CLASSIFY: COVERED / PARTIAL / MISSING
6. FILL gaps by spawning test-gap-auditor agent for MISSING requirements
7. PRODUCE .planning/VALIDATION.md with full coverage map
```

## Phase 1: Read Requirements and Plan

Read `.planning/SPEC.md` and extract every testable requirement:

```
For each requirement in SPEC.md:
  - Extract the requirement ID (e.g., AUTH-01, UI-02) from the Requirements table
  - Note the requirement description
  - Note the scope (v1/v2/out-of-scope) — only v1 requirements need coverage
  - Note the acceptance criteria from Success Criteria (mapped by ID)
```

Read `.planning/PLAN.md` and extract:
- Testing strategy (framework, commands)
- Task-to-requirement mapping
- Test file locations mentioned

**Output:** A list of requirements to validate, each with acceptance criteria.

## Phase 2: Scan Test Infrastructure

Detect the project's test setup:

```bash
# Detect test framework and config
ls package.json pyproject.toml Cargo.toml pixi.toml setup.cfg 2>/dev/null
```

Then read the relevant config to identify:
- **Framework:** pytest, jest, vitest, cargo test, etc.
- **Config file:** jest.config.*, pytest.ini, pyproject.toml [tool.pytest], etc.
- **Test directories:** tests/, __tests__/, spec/, test/
- **Run command:** npm test, pytest, cargo test, etc.
- **Existing test patterns:** How are tests structured? (describe/it, test functions, test classes)

```bash
# Find test files
fd -e test.ts -e test.js -e spec.ts -e spec.js -e _test.py -e _test.go -e _test.rs . 2>/dev/null || fd test . tests/ __tests__/ spec/ test/ 2>/dev/null | head -30
```

Read 2-3 existing test files to understand patterns (naming, imports, assertions, fixtures).

**Output:** Test infrastructure summary table.

## Phase 3: Map Coverage

For each requirement extracted in Phase 1:

1. **Search for test coverage:**
   - Grep test files for keywords from the requirement
   - Look for test names that reference the requirement
   - Check if acceptance criteria are asserted

2. **Read candidate test files** to confirm they actually exercise the requirement (not just mention it)

3. **Record the mapping:** requirement ID -> test file -> specific test(s)

## Phase 4: Classify Coverage

For each requirement, assign a classification:

| Classification | Criteria |
|---------------|----------|
| **COVERED** | Test exists, exercises the requirement, asserts correct behavior |
| **PARTIAL** | Test exists but: missing edge cases, incomplete assertions, or only tests happy path |
| **MISSING** | No test exercises this requirement |

### Classification Red Flags

These do NOT count as COVERED:

- Test file exists but test is `.skip()`'d or `@pytest.mark.skip`
- Test imports the module but never calls the function
- Test checks type/existence but not behavior
- Test only uses mocks (no integration with real code)
- Test name references requirement but assertions are trivial

## Phase 5: Fill Gaps

For each MISSING requirement, spawn a test-gap-auditor agent using `subagent_type="workflows:test-gap-auditor"`:

**Tool Restrictions (pass structurally, not just in prose):** dispatch with an explicit allowed-tools list so the restriction is enforced by the harness, not honor-system —

```
allowed_tools=["Read", "Glob", "Grep", "Bash", "Write", "Edit"]
```

The auditor can Write/Edit **test files ONLY**. It MUST NOT modify implementation source code. If it discovers an implementation bug, it escalates — it does not fix. (Write/Edit are granted because tests are its deliverable; the test-files-only scope is enforced by the agent's own system prompt + the Auditor Constraints below.)

**Agent prompt template:**

```
You are a test auditor. Your ONLY job is to write tests.

REQUIREMENT: [requirement description from SPEC.md]
ACCEPTANCE CRITERIA: [from SPEC.md]
TEST FRAMEWORK: [detected framework]
TEST PATTERNS: [patterns from existing tests]
TEST DIRECTORY: [where tests live]

RULES:
1. Write a test that exercises this requirement
2. Follow the existing test patterns in the project
3. Run the test and confirm it passes
4. If the test FAILS because the implementation is buggy, DO NOT fix the implementation
   - Report the failure
   - Include the error output
   - Mark as FAIL (escalated)
5. You have max 3 debug iterations to get the test working
   - Iteration 1: Write and run test
   - Iteration 2: Fix test issues (imports, setup, fixtures)
   - Iteration 3: Final attempt
   - After 3 failures: report FAIL (escalated)

OUTPUT: Report back with:
- Test file path
- Test name(s)
- PASS or FAIL (escalated)
- If FAIL: error output and whether it's a test issue or implementation bug
```

### Auditor Constraints

<EXTREMELY-IMPORTANT>
**The test-gap-auditor agent MUST NOT modify implementation code.**

If the auditor reports that a test fails due to an implementation bug:
1. Record it as FAIL (escalated) in VALIDATION.md
2. Do NOT spawn another agent to fix it
3. Do NOT fix it yourself
4. The escalation will be addressed in the review phase

**Fixing implementation bugs is dev-implement's job, not dev-test-gaps'.**
</EXTREMELY-IMPORTANT>

### Auditor Iteration Rules

```
Attempt 1: Write test → Run
  PASS → Done (record as gap filled)
  FAIL (test bug) → Fix test → Attempt 2
  FAIL (impl bug) → Escalate immediately

Attempt 2: Fixed test → Run
  PASS → Done (record as gap filled)
  FAIL (test bug) → Fix test → Attempt 3
  FAIL (impl bug) → Escalate immediately

Attempt 3: Fixed test → Run
  PASS → Done (record as gap filled)
  FAIL → Escalate (max iterations)
```

### Post-Subagent Boundary (after auditors return)

<EXTREMELY-IMPORTANT>
**When the test-gap-auditors return, you VERIFY their work — you do not investigate or re-debug it.** (Mirrors dev-implement's orchestrator boundary and C1b.)

| Orchestrator CAN (verification) | Orchestrator CANNOT (investigation — delegate it) |
|----------------------------------|----------------------------------------------------|
| Read the test file(s) the auditor wrote; run the test command | Debug a failing test's logic yourself |
| Record PASS / FAIL(escalated) into the coverage map | `grep`/`rg` implementation source to chase the bug |
| Re-dispatch an auditor for a still-MISSING requirement | Fix implementation code (that is dev-implement's job) |

**If an auditor escalated an impl bug, record FAIL(escalated) — do NOT investigate or fix it here.**
</EXTREMELY-IMPORTANT>

## Phase 6: Produce VALIDATION.md

After all requirements are mapped and gaps addressed, create `.planning/VALIDATION.md`:

```markdown
---
status: [draft | validated | gaps_found]
coverage: [N/M requirements covered]
---
# Test Coverage Validation

## Test Infrastructure
| Property | Value |
|----------|-------|
| Framework | [detected] |
| Config | [path] |
| Run command | [command] |

## Coverage Map
| Req ID | Requirement | Test File | Status | Notes |
|--------|-------------|-----------|--------|-------|
| CAT-01 | [description] | [test path] | COVERED/PARTIAL/MISSING | [details] |

## Gaps Filled
| Req ID | Requirement | Test File | Result |
|--------|-------------|-----------|--------|
| CAT-01 | [description] | [new test path] | PASS/FAIL (escalated) |

## Summary
- Requirements: N total
- Covered: X
- Partial: Y
- Missing: Z (W filled, V escalated)
```

### Status Rules

| Condition | Status |
|-----------|--------|
| All requirements COVERED, no escalations | `validated` |
| All requirements COVERED after gap-filling, no escalations | `validated` |
| Any PARTIAL or MISSING remain, or any escalations | `gaps_found` |
| Validation in progress | `draft` |

## Exit Criteria

**Checkpoint type:** human-verify (VALIDATION.md status is machine-verifiable)

**Validation passes (proceed to review):**
- `.planning/VALIDATION.md` exists with status `validated`
- All requirements classified as COVERED
- All gap-filling tests pass
- No escalations

**Validation fails (gaps found):**
- `.planning/VALIDATION.md` exists with status `gaps_found`
- Report to dev-implement orchestrator:
  - Which requirements have gaps
  - Which tests failed due to implementation bugs (escalations)
  - Recommendation: re-run specific implementation tasks or escalate to user

## Run Final Test Suite

Before setting status to `validated`, run the FULL test suite one final time:

```bash
# Run whatever test command was detected in Phase 2
[detected test command]
```

- ALL tests must pass (including newly written ones)
- If any test fails, investigate: is it a test issue or implementation bug?
- Test issues: fix the test (within the 3-iteration limit)
- Implementation bugs: escalate

**Only set status to `validated` after the full suite passes.**

## Gate: Exit Test-Gap Validation (MANDATORY)

<EXTREMELY-IMPORTANT>
**`status: validated` is a RUNTIME claim. Writing it without executing the suite this turn is a fabricated gate.** dev-review trusts VALIDATION.md as a structural marker; an unexecuted `validated` ships untested requirements behind a green light.

Run the canonical 5-step gate before chaining to dev-review:

```
1. IDENTIFY: `.planning/VALIDATION.md` exists; every requirement classified COVERED; no escalations.
2. RUN:      execute the full test command from Phase 2 THIS turn (not "tests passed earlier").
3. READ:     read the suite output — total / passed / failed / skipped counts.
4. VERIFY:   zero failures, zero unexpected skips, all requirements COVERED.
5. CLAIM:    only if 1-4 hold, write status: validated and chain to dev-review.
```

**If any step fails, status stays `gaps_found` (or `draft`). A structural check (`grep status: validated`) is NOT the same as runtime evidence — see C3 (Structural vs Runtime Verification).**
</EXTREMELY-IMPORTANT>
