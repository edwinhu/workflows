# Agent Team Implementation Protocol

Use this section when the user chose "Agent team (parallel)" in the strategy choice above.

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to sequential.

### 1. Prerequisites Check

Before spawning any teammates:

1. **Verify `.planning/PLAN.md`** exists with task list and `Deps` column annotations
2. **Group tasks by independence:**
   - Tasks with `Deps: —` (no dependencies) can run in parallel
   - Tasks with `Deps: after N` form dependency chains — keep these sequential within one teammate
   - Group dependent chains into a single teammate assignment
3. **Verify file scope separation:**
   - Each independent task/group should touch different files
   - If two independent tasks modify the same file, merge them into one group (prevents merge conflicts)
4. **Confirm at least 2 independent groups exist** — otherwise fall back to sequential

Example grouping from a PLAN.md:
```
Task 0: Test infra (Deps: —)       → Teammate A (must complete before others start)
Task 1: Types (Deps: after 0)      → Teammate B (after A completes)
Task 2: Service (Deps: after 1)    ─┐
Task 3: Route handler (Deps: after 1) → Teammate C (Task 2 + 3 if they share files)
Task 4: CLI command (Deps: —)      → Teammate D (independent, parallel with B/C)
```

**Foundation tasks** (like test infra or shared types) that everything depends on must complete BEFORE spawning parallel teammates. Run these sequentially first using normal ralph loops.

### 2. Create Shared Task List and Enter Delegate Mode

1. **Run foundation tasks first** (any task that all others depend on) using normal sequential ralph loops
2. After foundation tasks complete, create one `TaskCreate` per independent task/group:
   - Subject: `Implement: [Task Name(s)]`
   - Description: task details, file scope, test command
3. Press **Shift+Tab** to enter delegate mode — the lead coordinates, does NOT implement
4. Spawn one teammate per task/group

### 3. Spawn Prompt Template

Each teammate receives this self-contained prompt. **Teammates start with a blank conversation and do NOT auto-load skills.** The prompt must contain everything they need.

**Before spawning, substitute these variables:**
- `TASK_NAME` → task name(s) from PLAN.md
- `TASK_DETAILS` → full task text pasted from PLAN.md (not a file reference)
- `SPEC_CONTEXT` → relevant section of SPEC.md pasted inline
- `TEST_FRAMEWORK` → from PLAN.md Testing Strategy (e.g., pytest, jest)
- `TEST_COMMAND` → from PLAN.md Testing Strategy (e.g., `pytest tests/ -v`)
- `TEST_FILE` → test file path for this task
- `FILE_SCOPE` → specific files this teammate may modify (prevents merge conflicts)
- `PLUGIN_ROOT` → resolved base directory for skill paths (relative to this skill's base directory)

```
You are implementing one task as part of a development team. You have EXCLUSIVE
ownership of the files listed in FILE SCOPE. Do not modify files outside your scope.

## Your Assignment

Task: {TASK_NAME}

### Task Details (from PLAN.md)
{TASK_DETAILS}

### Requirements Context (from SPEC.md)
{SPEC_CONTEXT}

## File Scope (EXCLUSIVE — do not touch files outside this list)

{FILE_SCOPE}

If you discover you need to modify a file NOT in your scope, STOP and message the
lead: "Need to modify [file] which is outside my scope. Reason: [why]."

## Iron Laws of TDD (Non-Negotiable)

**YOU MUST WRITE THE FAILING TEST FIRST. YOU MUST SEE IT FAIL.**

1. **RED**: Write a failing test FIRST
   - Run it with: {TEST_COMMAND}
   - SEE IT FAIL — read the actual output
   - Document: "RED: [test] fails with [error]"

2. **GREEN**: Write MINIMAL code to pass
   - Run test again — SEE IT PASS
   - Document: "GREEN: [test] passes"

3. **REFACTOR**: Clean up while staying green

**If you write code before seeing RED, DELETE IT and start over.**

### What Counts as a REAL Test

| REAL (execute + verify) | NOT A TEST (never do this) |
|-------------------------|---------------------------|
| Test calls function and checks return value | grep for function exists |
| Test makes HTTP request and checks response | ast-grep finds pattern |
| Test clicks UI element and checks result | Log says "success" |

### Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "This is too simple for tests" | Simple tasks benefit MOST from tests |
| "I'll add tests after" | That's not TDD. Write test first. |
| "No test infra exists" | Foundation task should have set it up. If not, message lead. |

## Step 1: Load Skills

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev-tdd/SKILL.md` and follow its instructions.

If a testing skill is specified in PLAN.md (dev-test-electron, dev-test-playwright, etc.),
load that too.

## Step 2: Implement with TDD

Follow RED-GREEN-REFACTOR for each piece of functionality in your task:

1. Write failing test in {TEST_FILE}
2. Run {TEST_COMMAND} — see RED
3. Write minimal implementation
4. Run {TEST_COMMAND} — see GREEN
5. Refactor if needed

## Step 3: Commit

After all tests pass:
```
git add [your files only]
git commit -m "feat: [task description]"
```

## Step 4: Message the Lead

After committing, send a message to the lead with:

```
Finished: {TASK_NAME}

Files modified:
- [list each file with brief description of change]

Test results:
- [paste test command output summary — pass count, fail count]

Interface assumptions:
- [any assumptions about types, APIs, or contracts from other tasks]
- [or "None" if fully self-contained]

Commit: [SHA]
```

The lead uses these messages to detect interface conflicts between teammates.
Do NOT message other teammates directly — the lead coordinates all cross-task communication.

## Step 5: Self-Verification Checklist

Before marking your task complete, verify ALL of the following:

- [ ] All tests pass (run {TEST_COMMAND} one final time)
- [ ] Only files in FILE SCOPE were modified
- [ ] Implementation matches SPEC.md requirements (re-read spec context above)
- [ ] No `any` / `@ts-ignore` / type suppression / .skip() in tests
- [ ] Changes committed with descriptive message
- [ ] Lead messaged with files, test results, and interface assumptions

Only mark your task complete after all boxes pass.

## If You Encounter Issues

- **Need a file outside scope:** Message lead, do NOT modify it
- **Test infra missing:** Message lead: "Test infrastructure not available: [details]"
- **Blocked by another task's output:** Message lead: "Blocked — need [interface/type/file] from [other task]"
- **Unclear requirement:** Message lead with specific question. Do NOT guess.
```

### 4. Lead Monitoring

While teammates implement:

- **Watch the shared task list** for completion status and messages
- **If a teammate reports an interface question:** Relay the answer to ALL affected teammates (e.g., "The shared User type should use `{ id: string, email: string }`")
- **If a teammate requests an out-of-scope file:** Decide whether to expand scope or reassign the file
- **If a teammate has been working significantly longer than others:** Message them for status
- **Do NOT implement any tasks yourself** — your job is coordination and reconciliation

### 5. Reconciliation Protocol (3 Passes)

After ALL teammates mark their tasks complete, the lead performs three passes:

<EXTREMELY-IMPORTANT>
**Pass 1 — Merge & Conflicts:**

1. Pull all teammate commits to the working branch
2. If git reports merge conflicts:
   - Read both sides of each conflict
   - Resolve by combining both implementations (do NOT discard either side)
   - If teammates touched the same file despite file scope rules, manually review the entire file
3. After resolving, run the full test suite to verify merge didn't break anything

**Pass 2 — Integration Tests:**

1. Run the FULL test suite (not just per-task tests):
   ```
   [TEST_COMMAND from PLAN.md]
   ```
2. Teammates tested in isolation — integration may reveal:
   - Type mismatches between task boundaries
   - Import conflicts or circular dependencies
   - Shared state assumptions that conflict
3. If integration tests fail:
   - Identify which teammate's code causes the failure
   - Spawn a fix agent (using dev-delegate) targeting the specific integration issue
   - Re-run full suite after fix

**Pass 3 — Spec Compliance:**

1. Read SPEC.md requirements
2. Read each teammate's implementation against the spec
3. Verify no spec deviations across ALL tasks (same check dev-delegate's spec reviewer does, but across the full feature)
4. Check that teammate interface assumptions are consistent (compare the "Interface assumptions" from each teammate's completion message)

**If ANY pass fails → fix before proceeding. Do NOT skip reconciliation passes.**
</EXTREMELY-IMPORTANT>

### 6. When to Use Agent Teams

**Use when:**
- 4+ tasks in PLAN.md with at least 2 independent groups
- Independent tasks touch different files
- Tasks are self-contained (each has own test file and implementation file)

**Do NOT use when:**
- Tasks are tightly coupled (each depends on the previous)
- Multiple tasks modify the same files
- Fewer than 4 tasks (overhead exceeds benefit)
- Tasks require shared state that's built incrementally
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not available
