---
name: dev-implement
description: "This skill should be used when the user asks to 'implement the plan', 'start building', or 'execute the tasks'."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Skill, TodoWrite, Agent
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-delegation-guard.py"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_BLOCKED_TOOLS=Agent,Workflow
            GATE_DESCRIPTION="Plan review"
            GATE_REMEDY="Return to dev-design Phase Complete and run dev-plan-reviewer. It writes PLAN_REVIEWED.md on approval."
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
---

**Announce:** "I'm using dev-implement (Phase 5) to orchestrate implementation."

**Iteration topology:** serial /goal loop (agent-team parallel for 4+ independent tasks)

**Load shared enforcement:**

Auto-load all constraints matching `applies-to: dev-implement`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py dev-implement`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**Dynamic plan re-read:** Before starting work, re-read `.planning/PLAN.md` to catch any phases or tasks that were dynamically inserted by earlier phases. Do not rely on cached plan state from a prior phase.

## Progress Ledger (append-only — read FIRST, write on every completion)

`.planning/progress.md` is the durable record of which tasks are DONE. PLAN.md `[x]`
marks and the `/goal` transcript are both lossy across compaction; the ledger is not.

**At phase entry (before dispatching anything):** read the ledger and treat every task
listed there as already complete — do NOT re-dispatch it, even if PLAN.md shows it
unchecked (a crash between "task done" and "marked [x]" is exactly when this saves you).

```bash
cat .planning/progress.md 2>/dev/null || echo "(no ledger yet — fresh phase)"
```

**On every task completion (append one line, never rewrite):**

```bash
printf '%s | task %s | %s | verify:%s\n' "$(date -u +%FT%TZ)" "<N>" "<commit-sha-or-->" "pass" >> .planning/progress.md
```

A task is "done" iff it appears in the ledger AND its PLAN.md row is `[x]`. If the two
disagree, the ledger wins for *skip* decisions (never redo logged work) and PLAN.md
is corrected to match.

### Ledger Facts

- A controller that lost its place re-dispatching an already-finished task is the single most expensive failure mode of a long implement loop — it re-runs the most costly work for zero gain. The ledger exists so "did I already do task 4?" is a `cat`, not a guess. Skipping the read because "I remember where I was" is the exact overconfidence that compaction punishes.
- The ledger is append-only. Rewriting or trimming it to "clean it up" destroys the crash-recovery record; a stale-but-complete ledger is strictly safer than a tidy one missing the last entry.

## Where This Fits

```
Main Chat (you)                         dev-implement workflow (per level)
──────────────────────────────────────────────────────────────────────────
/goal <condition>  ← user sets once at phase entry
dev-implement (this skill)
  └─ per level: Workflow(name="dev-implement") ─→ parse PLAN table → DAG
                                                   sequential TDD implementer
                                                   per task → Verify Cmd → JS gate
  ← run FULL suite, mark [x], re-invoke next level
```

**Main chat orchestrates the level loop + the full-suite ground-truth + the `/goal`.** The workflow's implementers write the code (TDD) and the JS gate keys on real Verify Command exit codes — completion is not honor-system, and the dev-delegation-guard still forbids you from writing project code yourself.

## Contents

- [Prerequisites](#prerequisites)
- [Implementation Strategy: the dev-implement workflow](#implementation-strategy-the-dev-implement-workflow)
- [The Iron Law of Delegation](#the-iron-law-of-delegation)
- [The Process](#the-process) (Sequential)
- [Sub-Skills Reference](#sub-skills-reference)
- [Test Gap Validation Gate (MANDATORY)](#test-gap-validation-gate-mandatory)
- [Phase Complete](#phase-complete)

# Implementation (Orchestration)

<EXTREMELY-IMPORTANT>
## Prerequisites

**Do NOT start implementation without these:**

1. `.planning/SPEC.md` exists with final requirements
2. `.planning/PLAN.md` exists with chosen approach
3. **User explicitly approved** in /dev-design phase
4. **`.planning/PLAN.md` Testing Strategy section is COMPLETE** (all boxes checked)
5. **`.planning/PLAN_REVIEWED.md` exists with `status: APPROVED`**

If any prerequisite is missing, STOP and complete the earlier phases.

### Plan Review Gate Check (MANDATORY — CHECK FIRST)

Before anything else, verify the plan was reviewed:

```bash
# Check for plan review approval marker
head -5 .planning/PLAN_REVIEWED.md 2>/dev/null
```

**If `.planning/PLAN_REVIEWED.md` does not exist → STOP. Return to dev-design Phase Complete.**
**If `status:` is not `APPROVED` → STOP. Plan review is incomplete.**

This file is written by dev-plan-reviewer when it approves the plan. Its absence means the plan reviewer was SKIPPED — which means spec requirements may have been silently dropped from the plan.

User approval and plan review are different gates: the user approves the *approach*; the reviewer checks *spec coverage*. Re-running the reviewer costs ~30 seconds — proceeding past its absence asserts a coverage verification nobody performed.

**Check `.planning/PLAN.md` for:** files to modify, implementation order, testing strategy.

### Pre-Flight Testing Check (MANDATORY)

Before starting ANY task, verify `.planning/PLAN.md` Testing Strategy:

```
[ ] Framework specified (not empty, not "TBD")
[ ] Test Command specified (runnable command)
[ ] First Failing Test described (specific test name)
[ ] Test File Location specified (actual path)
```

**If ANY box is unchecked → STOP. Go back to design phase.**

This is your LAST CHANCE to catch missing test strategy before writing code.
</EXTREMELY-IMPORTANT>

## Implementation Strategy: the dev-implement workflow

You do NOT choose sequential-vs-parallel and you do NOT hand-dispatch tasks. Implementation is the **`dev-implement` ultracode workflow**, which reads the hardened PLAN.md table, builds the `Deps` DAG, and **auto-parallelizes within each dependency level** (one worktree-isolated implementer per task, all TDD). You drive the level loop: invoke the workflow per level, integrate the level's returned file contents, run the full suite, mark the rows `[x]`, advance — all under one `/goal`. See [The Process](#the-process).

<EXTREMELY-IMPORTANT>
## The Iron Law of TDD (Final Enforcement)

**YOU CANNOT WRITE IMPLEMENTATION CODE WITHOUT A FAILING TEST FIRST.**

This is not a suggestion. This is the workflow. Every task follows:

```
1. READ the test description from PLAN.md
2. WRITE the test file
3. RUN the test → SEE RED (failure)
4. ONLY THEN write implementation
5. RUN the test → SEE GREEN (pass)
```

### TDD Facts (implement-time)

- Missing test infrastructure discovered at implement time is an explore/clarify failure — the recovery is routing back and adding a Task 0 that sets up the harness, not implementing without tests.
- A SPEC.md that prescribes manual testing is a spec bug: fix SPEC.md with the user. It does not waive TDD.

**If you wrote code without a failing test first, DELETE IT and start over.** (Full TDD doctrine: dev-tdd.)
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**MAIN CHAT MUST NOT WRITE CODE. This is not negotiable.**

Main chat orchestrates. Subagents implement. If you catch yourself about to use Write or Edit on a code file, STOP.

| Allowed in Main Chat | NOT Allowed in Main Chat |
|---------------------|--------------------------|
| Spawn Task agents | Write/Edit code files |
| Review Task agent output | Direct implementation |
| Write to .planning/*.md files | "Quick fixes" |
| Run git commands | Any code editing |
| Set/clear `/goal` for the phase | Bypassing delegation |

**If you're about to edit code directly, STOP and spawn a Task agent instead.**

The full delegation doctrine — including what counts as code (ported code, config, boilerplate, setup, mechanical PLAN execution) — lives in dev-delegate's Delegation Facts.
</EXTREMELY-IMPORTANT>

### Context Monitoring

Before starting each task, check context availability:

**Thresholds:**
| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed with task |
| Warning | 25-35% | Complete current task, then invoke dev-handoff |
| Critical | ≤25% | Invoke dev-handoff immediately — no new tasks |

**At Warning level:** After the current task completes (don't abandon mid-task), invoke:
Read `${CLAUDE_SKILL_DIR}/../../skills/dev-handoff/SKILL.md` and follow its instructions.

**At Critical level:** Stop immediately. Invoke dev-handoff before context is exhausted. A degraded handoff is better than no handoff.

**Why:** A 10-task implementation phase with 20% context remaining produces garbage for the last 5 tasks. Better to handoff cleanly and resume fresh than to push through with degraded output.

### Long-Running Task Monitoring

Use the **Monitor tool** for builds, test suites, or scripts that take >30 seconds. Monitor streams stdout events without blocking — you keep working and get notified on completion.

```
# Watch a test suite run
Monitor(
  description="test suite progress",
  timeout_ms=300000, persistent=false,
  command="npm test 2>&1 | grep --line-buffered -E '(PASS|FAIL|✓|✗|error|complete)'"
)

# Watch a build
Monitor(
  description="build progress",
  timeout_ms=300000, persistent=false,
  command="npm run build 2>&1 | grep --line-buffered -E '(error|warning|built|done|fail)'"
)
```

**When NOT to use Monitor:** For quick commands (<30s), use Bash directly. For one-shot "run and wait," use `Bash(run_in_background=true)`. Monitor is for streaming progress from longer operations.

## The Process

The workflow implements ONE dependency level per invocation; you loop across levels under the active `/goal`.

```
0. Set the goal (once, at phase entry):
   /goal All tasks in .planning/PLAN.md are marked [x] AND [full-suite test command] exits 0
         AND .planning/VALIDATION.md status is `validated`. Stop after [N] turns.

LOOP (one turn per level, under the active /goal):
  1. Invoke the workflow:
       Workflow(name="dev-implement", args={
         "projectDir": "<absolute path to the dev project (cwd)>",
         "pluginRoot": "<absolute path to this plugin's workflows/ dir — resolve ${CLAUDE_SKILL_DIR}/../../workflows>"
       })
     It picks the lowest level with pending tasks, runs its tasks SEQUENTIALLY (one
     TDD implementer each, writing directly into the project tree), verifies each
     (Verify Command exit 0 + read-only corroboration), and returns { overallPass,
     level, tasksRemaining, tasks, findings, tasksThatFailed, reviews }. The code is
     ALREADY in the tree when it returns — there is no merge step for you to do.

  2. GROUND-TRUTH (self-reports are not truth): run the FULL suite + lint on the
     tree (the PLAN.md Testing Strategy command — e.g. `pixi run pytest`,
     `npm test && npm run lint`). The per-task Verify Commands ran in isolation;
     this confirms the level integrates without regressions.

  3. If result.overallPass AND the full suite is green:
     mark this level's PLAN.md rows [x], log to LEARNINGS.md, END THE TURN —
     the /goal evaluator re-fires for the next level (or closes if tasksRemaining=0).
     No pause, no "should I continue?".

  4. If result.overallPass is false (a task failed TDD/verify) OR the full suite
     regressed: read result.findings, fix the cause, then re-invoke with
     onlyChecks=result.tasksThatFailed + priorReviews=result.reviews. An R4 block
     (architectural — new schema, lib swap, breaking API) is a critical finding —
     STOP and escalate it to the user; do not invent the architectural fix.
```

**A blocked task (R4 — new schema, lib swap, breaking API) is in `findings` as critical and `overallPass=false`. STOP and present the R4 to the user; do not invent an architectural fix.**

**The JS gate (`result.overallPass`) + your full-suite run are authoritative.** Do not hand-wave a level done; the Verify Command exit codes decide, not your read of the output.

**Cache lookup pattern for skill paths:** Read `${CLAUDE_SKILL_DIR}/../../TARGET/PATH` and follow its instructions.

### Visual Task Detection

If a PLAN.md task involves rendered visual output, use **visual-verify** for the render → look-at → fix steps inside the task. Visual-verify is part of what happens *inside* a turn — `/goal` still drives the outer loop.

**Signals a task is visual:** task mentions "render", "slide", "chart", "figure", "layout", "UI", "screenshot", "visual", "diagram", or produces any file meant to be seen by humans (PNG, PDF, SVG).

Read `${CLAUDE_SKILL_DIR}/../../skills/visual-verify/SKILL.md` and follow its instructions.

### Step 1: Set the Goal for the Phase

Before working through PLAN.md, set a `/goal` whose condition encodes the full phase exit criteria. The user runs this once; subsequent turns fire automatically until the evaluator says the condition holds.

**Condition template (copy, fill in brackets, hand to the user):**

```
/goal All tasks in .planning/PLAN.md are marked [x] complete, [TEST COMMAND] exits 0
on the full suite, .planning/VALIDATION.md exists with status `validated`,
and no Task agent reports unresolved blockers. Stop after [N] turns or if the
same test fails 3 turns in a row (trigger Failure Recovery Protocol).
```

Key constraints baked into the condition:
- **Test command must be runnable from PLAN.md's Testing Strategy** — encode the literal command (e.g., `pixi run pytest`, `npm test && npm run lint`) so the evaluator can read the exit code from the transcript.
- **VALIDATION.md gate** — covered by Test Gap Validation Gate below.
- **Turn limit** — pick a budget that covers every task. Rough rule: 3–5 turns per task for routine work, more for debugging-heavy tasks.

If the user prefers to drive `/goal` themselves, hand them the literal condition string instead of setting it for them.

### Step 2: Run the level loop (the dev-implement workflow)

Implementation is the `dev-implement` workflow, looped per dependency level — see [The Process](#the-process). You do NOT hand-dispatch tasks; the workflow's implementers follow dev-tdd and run each task's Verify Command, and the JS gate keys on the real exit codes. (The legacy per-task `dev-delegate` template is now embedded in the workflow's implementer prompt; `dev-delegate` remains only for ad-hoc single-task dispatch outside this phase.)

### Step 3: Verify and Complete (MANDATORY - DO NOT SKIP)

<EXTREMELY-IMPORTANT>
**YOU MUST VERIFY EACH OF THESE. "Task complete" without verification is NOT HELPFUL — you're shipping broken code the user will have to debug.**

After Task agent returns, **you must personally verify** (not trust the agent's report):

**Orchestrator-role boundary (deliberate, scoped exception to C1b).** dev-debug's C1b classifies reading source after a subagent as *investigation*. dev-implement is the **orchestrator** of a known PLAN.md task, so a narrow read is *verification* — but only within these lines:

| Orchestrator CAN (spec-compliance verification) | Orchestrator CANNOT (investigation — delegate it) |
|--------------------------------------------------|----------------------------------------------------|
| Read the file(s) the agent claims it wrote, to compare against the SPEC.md requirement for THIS task | Form hypotheses about why something is broken |
| Read the test file(s) and run the test command | `grep`/`rg` source to hunt for unrelated patterns |
| Check exit codes, diff `*.test.*` | Debug the logic yourself or fix it in main chat |
| | Read files beyond the task's claimed deliverables |

**If verification surfaces a defect, you do NOT debug it in main chat — you REJECT the task and re-dispatch the implementer (or dev-debug).** Reading widens past the claimed deliverables = you've crossed into investigation; stop and delegate.

#### 3a. Read the Actual Code
```
Read the implementation file(s) the agent claims to have written.
Compare to SPEC.md requirements line by line.
```
- [ ] Code matches spec (not a different approach)
- [ ] No substitutions (e.g., spec says IPC, code uses DOM = FAIL)

#### 3b. Check Test Reality
```
Read the test file(s). Look for .skip(), mock-only tests, or tests that don't call real code.
```
- [ ] Tests EXECUTE code (not grep/mock-only)
- [ ] Tests are NOT skipped (SKIP ≠ PASS)
- [ ] Integration tests exist and run (not just unit tests)

#### 3c. Run Tests Yourself
```
Actually run the test command. Read the output.
```
- [ ] Test command runs without error
- [ ] Tests actually pass (not "66 pass, 0 fail" with 50 skipped)
- [ ] Test output shows real assertions (not just "test exists")

#### 3d. Verify Real Integration (FOR EXTERNAL SYSTEMS)
```
If the feature integrates with an external system (Electron app, API, database),
you MUST verify it works against the real system, not just mocks.
```
- [ ] External system is actually running
- [ ] Feature actually works (not just "code runs without error")
- [ ] Output is visible in the external system

**If ANY check fails → REJECT the work. Do NOT mark task complete.**

**If ALL pass → mark the task [x] in PLAN.md and move on.** If ANY fail → iterate within the active `/goal`; the next turn will fire automatically.
</EXTREMELY-IMPORTANT>

### Task Summary (MANDATORY after each task)

After a task passes review, append a structured summary to LEARNINGS.md:

```yaml
## Task N: [task description]

---
task: N
status: completed
implements: [REQ-01, REQ-03]
affects: [src/auth/, tests/test_auth.py]
key-files:
  created: [list of new files]
  modified: [list of changed files]
deviations: {r1: 0, r2: 1, r3: 0, r4: 0}
---

One-liner: [SUBSTANTIVE summary — not "Task complete" but "JWT refresh rotation with 7-day expiry using jose library"]

Changes: [what was added/modified and why]
Test: [test command and result]
```

**One-liner rule:** Must be SUBSTANTIVE. Good: "Added rate limiting middleware with sliding window at 100 req/min". Bad: "Implemented task 3" or "Done".

## Deviation Rules (CRITICAL)

You WILL discover unplanned work during implementation. Apply these rules automatically and track all deviations.

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **1: Bug** | Broken behavior, errors, wrong queries, type errors, security vulns, race conditions, leaks | Fix → test → verify → track `[Rule 1 - Bug]` | Auto |
| **2: Missing Critical** | Missing essentials: error handling, validation, auth, CSRF/CORS, rate limiting, indexes, logging | Add → test → verify → track `[Rule 2 - Missing Critical]` | Auto |
| **3: Blocking** | Prevents completion: missing deps, wrong types, broken imports, missing env/config/files, circular deps | Fix blocker → verify proceeds → track `[Rule 3 - Blocking]` | Auto |
| **4: Architectural** | Structural change: new DB table, schema change, new service, switching libs, breaking API, new infra | STOP → present decision → track `[Rule 4 - Architectural]` | Ask user |

**Priority:** Rule 4 (STOP) > Rules 1-3 (auto) > unsure → Rule 4
**Edge cases:** missing validation → R2 | null crash → R1 | new table → R4 | new column → R1/2

### Rule 4 Format

When you encounter an architectural deviation, STOP and present:

```
⚠️ Architectural Decision Needed
- Current task: [task name]
- Discovery: [what prompted this]
- Proposed change: [modification]
- Why needed: [rationale]
- Impact: [what this affects]
- Alternatives: [other approaches]
Proceed with proposed change? (yes / different approach / defer)
```

### Documenting Deviations

All deviations tracked per task:

**[Rule N - Category] Title**
- Found during: Task X
- Issue: [description]
- Fix: [what was done]
- Files modified: [list]
- Verification: [how confirmed]

End each task summary with: **Total deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **Impact:** [assessment].

**The protocol is not overhead you pay. It is the service you provide.**

## Sub-Skills Reference

| Skill | Purpose | Used By |
|-------|---------|---------|
| `/goal` (built-in) | Cross-turn iteration with separate-model evaluation | Set by user/main chat at phase entry |
| `dev-delegate` | Task agent templates | Main chat |
| `dev-tdd` | TDD protocol (RED-GREEN-REFACTOR) | Task agent |
| `dev-test` | Testing tools (pytest, Playwright, etc.) | Task agent |

## Failure Recovery Protocol

### Blocker Handling (retry / skip / stop)

When a task is **blocked** by something other than a failing test — a missing dependency, an unavailable service, an environment/config gap, an upstream task not yet done — do NOT silently spin. Classify and act:

| Option | When | Action |
|--------|------|--------|
| **Retry** | Transient (flaky network, race, first-run setup) | Re-run once. If it clears, continue. Log the retry in LEARNINGS.md. |
| **Skip** | The blocked task is independent of the remaining tasks | Mark the task `[blocked]` in PLAN.md with the reason, proceed to the next independent task, and surface the skipped task at phase end. Never skip a task others depend on. |
| **Stop** | The blocker prevents all forward progress, or is architectural (R4) | STOP, write `.planning/RECOVERY.md` with the blocker, and consult the user. |

Default when unsure → **Stop** and ask. A blocker is not a test failure — the 3-failure trigger below is for tasks that *run* but fail tests.

**Pattern from oh-my-opencode: After 3 consecutive implementation failures, escalate.**

### 3-Failure Trigger

If you attempt 3 implementations and ALL fail tests:

```
Iteration 1: Implement approach A → tests fail
Iteration 2: Implement approach B → tests fail
Iteration 3: Implement approach C → tests fail
→ TRIGGER RECOVERY PROTOCOL
```

### Recovery Steps

1. **STOP** all further implementation attempts
   - No more "let me try a different approach"
   - No guessing or throwing code at the problem

2. **REVERT** to last known working state
   - `git checkout <last-passing-commit>`
   - Or revert specific files
   - Document what was attempted in `.planning/RECOVERY.md`

3. **DOCUMENT** what was attempted
   - All 3 approaches tried
   - Test failures for each
   - Why each approach failed
   - What this reveals about the problem

4. **CONSULT** with user BEFORE continuing
   - "I've tried 3 approaches. All fail tests. Here's what I've learned..."
   - Present test failure patterns
   - Request: requirements clarification, design input, or different strategy

5. **ASK USER** for direction
   - Option A: Re-examine requirements (may need /dev-clarify)
   - Option B: Try completely different design (may need /dev-design)
   - Option C: Investigate why tests fail (may need /dev-debug)
   - Option D: User provides domain knowledge

**NO PASSING TESTS = NOT COMPLETE** (hard rule)

### Recovery Checklist

Before continuing after multiple failures:

- [ ] All 3 approaches documented with test failures
- [ ] Pattern in failures identified (same tests? different errors?)
- [ ] Current code reverted to clean state
- [ ] User consulted with specific question
- [ ] Clear direction from user before proceeding

### Anti-Patterns After Failures

**DON'T:**
- Keep trying "just one more thing"
- Make larger and larger changes
- Skip TDD "to get it working first"
- Suppress test failures ("I'll fix them later")
- Blame the tests ("tests are wrong")

**DO:**
- Stop and analyze the failure pattern
- Revert to clean state
- Document what each approach revealed
- Consult user with specific findings
- Get clear direction before continuing

### Example Recovery Flow

```
Loop 1: Implement with synchronous approach → Tests timeout
Loop 2: Implement with async/await → Tests hang
Loop 3: Implement with promises → Tests fail assertion

→ RECOVERY PROTOCOL:
1. STOP (no loop 4)
2. REVERT: git checkout HEAD -- src/feature.ts tests/
3. DOCUMENT in .planning/RECOVERY.md:
   - Pattern: All async implementations cause timing issues
   - Tests expect synchronous behavior
   - Hypothesis: Requirements may need async, tests don't handle it
4. ASK USER:
   "I've tried 3 async implementations. All cause timing issues.
    Tests expect synchronous behavior.

    This suggests either:
    A) Feature should actually be synchronous (simpler)
    B) Tests need updating for async behavior

    Which direction should I take?"
```

### When to Trigger Recovery

Trigger after 3 failures when:
- Same test keeps failing despite different approaches
- Different tests fail in pattern (suggests wrong approach)
- Tests pass locally but fail in CI
- Implementation works but breaks unrelated tests

Don't wait for max iterations - trigger early when pattern emerges.

## If the Goal's Turn Budget Is Reached

The `/goal` condition's `Stop after N turns` clause causes the evaluator to return done with reason "turn budget exhausted." **Still do NOT ask user to manually test.**

Main chat should:
1. **Summarize** what's failing (from LEARNINGS.md)
2. **Report** which automated tests fail and why
3. **Ask user** for direction:
   - A) Set a new `/goal` with a different approach
   - B) Add more logging to debug
   - C) User provides guidance
   - D) User explicitly requests manual testing

**Never default to "please test manually".** Always exhaust automation first.

## No Pause Between Tasks

<EXTREMELY-IMPORTANT>
**After completing task N, IMMEDIATELY start task N+1 in the SAME RESPONSE. Do NOT pause.**

### Post-Task Checklist (mandatory, same response)

1. **Update PLAN.md** - Mark task `[x]` complete
2. **Append to the ledger** - one line to `.planning/progress.md` (append-only; the crash-safe record of "done")
3. **Log to LEARNINGS.md** - What was done
4. **Start next task** - No waiting. The active `/goal` keeps firing turns until the condition holds.

The user reviews at the END and is waiting for COMPLETION, not interim check-ins — a courtesy pause costs a full turn round-trip and delivers nothing. Update PLAN.md now (not "later" — later never comes), then start the next task in the same response.

### Valid Stopping Points (only these three)

1. ALL tasks in PLAN.md are marked `[x]` complete
2. You hit a blocker requiring user input (state exactly what you need)
3. User explicitly interrupted

A `[x]` mark in PLAN.md + a passing test command in the transcript signals task completion. After verifying, update PLAN.md, then IMMEDIATELY start the next task — the `/goal` evaluator reads the transcript and decides when the whole phase is done.

**Pausing between tasks is procrastination disguised as courtesy.**

### The Iron Law of Topic Changes

**If the user sends a message that is NOT about the current implementation, you MUST announce the loop pause before responding — then resume.** (Stopping point #3, made explicit.)

This mirrors dev-debug's protocol: silent loop abandonment is how a structured `/goal` loop gets dropped and never resumed.

**Protocol:**
1. Announce: "Pausing the implement `/goal` loop at task N to address your request."
2. Handle the off-topic request (normal tools allowed — you're outside the loop).
3. Announce: "Resuming the implement loop. Re-reading .planning/PLAN.md for current state."
4. Re-read `.planning/PLAN.md` (and LEARNINGS.md) and dispatch the next task's implementer.

**If the message could be EITHER a new topic OR part of the current task:** ask "Is this part of the current task, or a separate request?" — do NOT assume separate and silently abandon the loop.

**Silently dropping the loop is NOT HELPFUL — the user set `/goal` because they want all tasks driven to completion. Abandoning it discards their explicit request.**

### Task Transition Gate (MANDATORY)

After each task's verification completes:

1. Update PLAN.md — mark completed task `[x]`
2. Append to `.planning/progress.md` — the append-only ledger line (crash-safe "done")
3. Append to LEARNINGS.md — what was accomplished, test command, exit code
4. Check for blockers — dependencies from task N needed for N+1?
5. If clear → IMMEDIATELY dispatch the implementer for task N+1
6. If blocked → Ask user EXACTLY what's missing (not "I'm blocked")

**Violations to catch:**
- "Let me check with user if they want me to continue" → NO, continue automatically
- "Should I move to task N+1?" → NO, you're supposed to move
- "Let me summarize what we learned" → NO, move to task N+1

Pausing > 30 seconds between tasks means you've stopped. You shouldn't have.
</EXTREMELY-IMPORTANT>

## Test Gap Validation Gate (MANDATORY)

<EXTREMELY-IMPORTANT>
**After ALL implementation tasks complete, you MUST run test gap test gap validation BEFORE proceeding to review.**

This gate validates that every requirement in SPEC.md has corresponding test coverage. TDD ensures task-level coverage; test gap ensures requirement-level coverage. They are different checks.

### Invoke test gap Validation

Read `${CLAUDE_SKILL_DIR}/../../skills/dev-test-gaps/SKILL.md` and follow its instructions.

### Gate Conditions

**Must produce `.planning/VALIDATION.md` before proceeding to review.**

| VALIDATION.md Status | Action |
|---------------------|--------|
| `validated` | Proceed to review phase |
| `gaps_found` (gaps filled, no escalations) | Re-run full test suite. If all pass, proceed. |
| `gaps_found` (with escalations) | Address escalated implementation bugs: dispatch targeted Task agents for failing requirements (the active `/goal` keeps firing turns), then re-run test gap validation |
| Missing | STOP. Run test gap validation. |

### Re-validation After Gap Fixes

If test gap reports implementation bugs (escalations):

1. Dispatch Task agents ONLY for the specific failing requirements (the active `/goal` keeps firing turns until VALIDATION.md is `validated`)
2. After fixes, re-invoke dev-test-gaps to re-validate
3. Repeat until VALIDATION.md status is `validated`
4. Max 2 re-validation cycles. After that, escalate to user.

### Test-Gap Facts

- Per-task tests passing does not sum to requirement coverage — gaps hide *between* tasks, which is exactly what dev-test-gaps exists to catch. Skipping it (or "validating coverage manually") ships requirements no test exercises, asserted as covered.
</EXTREMELY-IMPORTANT>

## Phase Complete

**Phase summary (append to LEARNINGS.md):**

```yaml
## Phase: Implement

---
phase: implement
status: completed
requires: [PLAN.md, PLAN_REVIEWED.md]
provides: [VALIDATION.md, implementation-complete, all-tests-passing]
tasks-completed: N/N
total-deviations: {r1: X, r2: Y, r3: Z, r4: W}
---
```

**REQUIRED SUB-SKILL:** After ALL tasks complete with passing tests AND test gap validation passes:

Read `${CLAUDE_SKILL_DIR}/../../skills/dev-review/SKILL.md` and follow its instructions.

Do NOT proceed until automated tests pass for every task AND `.planning/VALIDATION.md` status is `validated`.
