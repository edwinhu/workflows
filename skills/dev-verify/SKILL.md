---
name: dev-verify
description: "This skill should be used when the user asks to 'verify completion', 'check that tests pass', 'confirm feature works', or 'verify the feature is done'."
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-delegation-guard.py"
    - matcher: "Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/REVIEW_STATE.md
            GATE_STATUS=APPROVED
            GATE_REQUIRE_FIELDS="codex_second_pass:completed|declined|unavailable"
            GATE_BLOCKED_TOOLS=Agent
            GATE_DESCRIPTION="Code review approved"
            GATE_REMEDY="Return to dev-review (Phase 6). Review must complete with verdict APPROVED (REVIEW_STATE.md status: APPROVED) before verification. A CHANGES_REQUIRED/ESCALATE/BLOCKED review does not admit verify. REVIEW_STATE.md must also record codex_second_pass: completed (Codex returned a verdict) | declined (user opted out) | unavailable (Codex not installed/ready, or no git repo). codex_second_pass: requested means the second pass was launched but has not returned — join it (read the file named by codex_output_file) before verifying; a launched-but-unjoined pass is not a completed one. codex_second_pass: error is an absence of evidence, not an approval — retry it or have the user explicitly decline."
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
        - type: command
          command: "FLOOR=dev uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/mechanical-floor-gate.py"
---

Announce: "Using dev-verify (Phase 7) to confirm completion with fresh evidence."

**Iteration topology:** one-shot fresh-subagent verifier (read-only)

### Context Check

Before starting this phase, check remaining context:

| Level | Remaining | Action |
|-------|-----------|--------|
| Normal | >35% | Proceed |
| Warning | 25-35% | Finish the current step, then invoke dev-handoff |
| Critical | ≤25% | Invoke dev-handoff immediately — resume fresh |

At Warning/Critical: Read `${CLAUDE_SKILL_DIR}/../../skills/dev-handoff/SKILL.md` and follow its instructions.

**Load shared enforcement:**

Auto-load all constraints matching `applies-to: dev-verify`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py dev-verify`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

**Dynamic plan re-read:** Before starting verification, re-read `.planning/SPEC.md` to verify against the latest requirements. Do not rely on cached state from prior phases.

## Contents

- [The Iron Law of Verification](#the-iron-law-of-verification)
- [Verification Facts](#verification-facts)
- [The Gate Function](#the-gate-function)
- [Claims Requiring Evidence](#claims-requiring-evidence)
- [Insufficient Evidence](#insufficient-evidence)
- [Verification Patterns](#verification-patterns)
- [User Acceptance (Final Step)](#user-acceptance-final-step)
- [Bottom Line](#bottom-line)

# Verification Gate

<EXTREMELY-IMPORTANT>
## Your Job is to Write Automated Tests

**The automated test IS your deliverable. The implementation just makes the test pass.**

Reframe your task:
- ❌ "Implement feature X, and test it"
- ✅ "Write an automated test that proves feature X works. Then make it pass."

The test proves value. The implementation is a means to an end.

Without a REAL automated test (executes code, verifies behavior), you have delivered NOTHING.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Verification

**NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE. This is not negotiable.**

Before claiming ANYTHING is complete, you MUST:
1. IDENTIFY - Which command proves your assertion?
2. RUN - Execute the command fresh (not from cache/memory)
3. READ - Review full output and exit codes
4. VERIFY - Confirm output supports your claim
5. Only THEN make the claim

This applies even when:
- "I just ran it a moment ago"
- "The agent said it passed"
- "It should work"
- "I'm confident it's fine"

**If you catch yourself about to claim completion without fresh evidence, STOP.**
</EXTREMELY-IMPORTANT>

## Verification Facts

- Structural evidence — a grep hit, an ast-grep match, a diff, "the file exists", "the function is defined", "the implementation looks correct" — proves code is present, not that it works. Presenting structural analysis as verification asserts a runtime result that was never observed; an unverified claim presented as fact is a form of dishonesty.
- Logs, exit codes, "console contains 'success'", and "file was created" are observability, not verification: they prove code executed, not that it produced correct output.

## The Gate Function

**Checkpoint type:** decision (user confirms requirements met — cannot auto-advance)

Before making ANY status claim:

```
1. IDENTIFY → Which command proves your assertion?
2. RUN     → Execute the command fresh
3. READ    → Review full output and exit codes
4. VERIFY  → Confirm output supports your claim
5. CLAIM   → Only after steps 1-4
```

**Skipping any step is not verification — it's shipping unverified work the user will have to debug.**

## Claims Requiring Evidence

| Claim | Required Evidence |
|-------|-------------------|
| "Tests pass" | Test output showing 0 failures |
| "Build succeeds" | Exit code 0 from build command |
| "Linter clean" | Linter output showing 0 errors |
| "Bug fixed" | Test that failed now passes |
| "Feature complete" | All acceptance criteria verified |
| **"User-facing feature works"** | **E2E test output showing PASS** |

<EXTREMELY-IMPORTANT>
## The E2E Evidence Gate

**USER-FACING CLAIMS REQUIRE E2E EVIDENCE. Unit tests are insufficient.**

| Claim | Unit Test Evidence | E2E Evidence Required |
|-------|--------------------|-----------------------|
| "API works" | ❌ Insufficient | ✅ Full request/response test |
| "UI renders" | ❌ Insufficient | ✅ Playwright snapshot/interaction |
| "Feature complete" | ❌ Insufficient | ✅ User flow simulation |
| "No regressions" | ❌ Insufficient | ✅ E2E suite passes |

### E2E Facts

- E2E evidence is the output the user actually sees: a Playwright assertion on rendered content (`element.textContent === 'Success'`), a screenshot + visual diff (e.g. `grim` capture) confirming the visual change, a test that opens the produced file and verifies its contents, a real integration returning the expected value.
- "Log shows the function was called", "grep papirus in logs", "process exited 0", and "mock returned expected value" are observability, not E2E — they prove execution paths fired, not that the user-visible result is correct. Reporting them as E2E evidence claims a verification that never happened.

### The E2E Gate Function

For user-facing changes, add to verification:

```
1. IDENTIFY → Which E2E test proves user-facing behavior?
2. RUN     → Execute E2E test fresh
3. READ    → Review full output (screenshots if visual)
4. VERIFY  → User flow works as specified
5. CLAIM   → Only after E2E evidence exists
```

**"Unit tests pass" is not "feature complete" for user-facing changes.**
</EXTREMELY-IMPORTANT>

### GUI Application Gate (CRITICAL)

<EXTREMELY-IMPORTANT>
**For GUI applications, you MUST complete the 6-gate sequence from dev-tdd BEFORE E2E testing:**

```
GATE 1: BUILD
GATE 2: LAUNCH (with file-based logging)
GATE 3: WAIT
GATE 4: CHECK PROCESS
GATE 5: READ LOGS ← MANDATORY, CANNOT SKIP
GATE 6: VERIFY LOGS
THEN AND ONLY THEN: E2E tests/screenshots
```

**You cannot skip GATE 5 (READ LOGS).** If you catch yourself about to take screenshots without reading logs first, STOP.

For the full gate sequence with examples, discover and read `skills/dev-tdd/SKILL.md` via cache lookup.
</EXTREMELY-IMPORTANT>

**If verification discovers stale or fabricated evidence in LEARNINGS.md, DELETE the contaminated entries. Do not amend false claims — remove them entirely and re-run the verification from scratch.**

## Insufficient Evidence

These do NOT count as verification:

- Previous runs (must be fresh)
- Assumptions ("it should work")
- Partial checks (ran some tests, not all)
- Agent reports without independent confirmation
- "I think..." / "It seems..." / "Probably..."

## Verification Patterns

### Tests
```bash
# Run tests (e.g., npm test, pytest, cargo test)
npm test

# Check results: "34/34 pass" = can claim tests pass
# "33/34 pass" = cannot claim success (partial fail)
```

**Tool description:** Run automated test suite to verify all tests pass

### Regression Test
```bash
# 1. Write test → run (should fail initially)
# 2. Apply fix → run (should pass)
# 3. Revert fix → run (must fail again to confirm fix)
# 4. Restore fix → run (must pass to confirm success)
```

**Tool description:** Execute regression test cycle to validate bug fix reproducibility

### Build
```bash
npm run build && echo "Exit code: $?"
# Must see "Exit code: 0" to claim success
```

**Tool description:** Build application and verify exit code is 0

## Constraint Check (Leg 1 — Hard Block)

Before spawning the goal-backward verifier, run the auto-discovering constraint runner:

```bash
uv run --with lxml python3 ${CLAUDE_SKILL_DIR}/../../references/constraints/check-all.py .
```

**If any constraint FAILS:** Address the failure before proceeding. Constraint failures are hard blocks — do not proceed to goal-backward verification with failing constraints. This is **hook-enforced**, not just prose: `mechanical-floor-gate.py` (FLOOR=dev, wired on the Agent matcher) re-runs check-all and DENIES the verifier spawn until the floor is clean.

**If all constraints PASS:** Proceed to goal-backward verification below.

**Record the evidence (do not assert coverage from memory):** copy the runner's summary line — e.g. `N/M passed, K failed, J conventions` — into `.planning/LEARNINGS.md` as the verification record. Coverage is proven by the runner's actual output, not by a count documented elsewhere.

## Goal-Backward Verification (Subagent — Leg 2)

After technical tests pass, spawn the dev-verifier agent to check that phase GOALS were achieved, not just tasks completed:

**Tool Restrictions:** The verifier is READ-ONLY. It runs tests via Bash and reads output but MUST NOT use Write or Edit.

```
Agent(subagent_type="workflows:dev-verifier",
      allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
      prompt="""
Verify that the dev workflow goals have been achieved for this feature.

**Tool Restrictions:** You are READ-ONLY. You MUST NOT use Write or Edit tools. You run tests and read output to verify goals — you do NOT modify code. If you find gaps, you report them — the main chat fixes them.

Read these files:
- .planning/SPEC.md (requirements and success criteria)
- .planning/PLAN.md (implementation plan)
- .planning/STATE.md (workflow state)

For each success criterion in SPEC.md, verify with FRESH runtime evidence that the goal was met.
Task completion ≠ goal achievement. A file existing ≠ feature working.

**Trace to Requirements:** For each success criterion, reference its requirement ID (e.g., "AUTH-01: Login returns JWT token — VERIFIED with test output showing..."). This creates end-to-end traceability from SPEC.md through PLAN.md through VALIDATION.md through verification.

Report:
- GOAL: [from SPEC.md success criteria]
- REQUIREMENT: [REQ-ID from SPEC.md]
- STATUS: MET | NOT_MET | PARTIAL
- EVIDENCE: [fresh runtime output proving it]

If ANY goal is NOT_MET, list the specific gaps.
""")
```

**If dev-verifier finds gaps:** Return to dev-implement to address them before proceeding to user acceptance.
**If all goals MET:** Proceed to user acceptance below.

**Post-subagent boundary (the highest-risk moment).** After the verifier returns, main chat is *verifying*, not *investigating* — stay inside this line:

| Main chat CAN (verification) | Main chat CANNOT (investigation) |
|------------------------------|----------------------------------|
| Read the verifier's report + LEARNINGS.md | Re-read source files to "double-check" the finding |
| Re-run the test command / `check-all.py` | Grep/explore the codebase to form a new theory |
| Route gaps back to dev-implement | Edit code to "quickly fix" what the verifier flagged |

If you catch yourself opening source files to re-litigate the verifier's verdict, STOP — that is investigation. Route the gap to dev-implement. (Full rule: auto-loaded `verification-vs-investigation` constraint, C1b.)

## User Acceptance (Final Step)

**Checkpoint type:** decision (user confirms completion — cannot auto-advance)

After technical verification and goal-backward verification pass, confirm with user. Use the AskUserQuestion pattern:

**Tool description:** Request user confirmation that implementation meets specified requirements

```yaml
question: "Does this implementation meet your requirements?"
options:
  - label: "Yes, requirements met"
    description: "Feature works as designed, ready to merge"
  - label: "Partially"
    description: "Core works but missing some requirements"
  - label: "No"
    description: "Does not meet requirements, needs more work"
```

Reference `.planning/SPEC.md` when asking—remind user of the success criteria they defined.

**Log the review pattern (observe → record → offer):** after the user answers this acceptance `decision`, append one line to `.planning/LEARNINGS.md` recording what the user inspected before deciding — e.g. "ran the app and watched the GUI", "read the test summary only", "asked for a before/after diff", "checked specific acceptance criteria". If the same artifact is requested 3+ times across episodes, offer to bundle a generator script under `skills/dev-verify/scripts/`. Observe first, automate after the 3rd occurrence — never build speculatively.

When the offer triggers, map the observed request to a concrete artifact:

| If the user keeps asking to… | Consider building |
|------------------------------|-------------------|
| "see it actually run" | a launch/screenshot script (use visual-verify) |
| "see a before/after diff" | tracked-changes / redline view |
| "confirm all criteria are met" | acceptance-criteria → evidence coverage table |
| "see the test results" | test-summary renderer from the suite output |

The phase offers to run the script — it never forces it.

If user responds "Partially" or "No":
1. Ask which specific requirement is not met
2. Return to `/dev-implement` to address gaps
3. **MANDATORY: Re-invoke dev-verify after fixes** — do not skip re-verification

<EXTREMELY-IMPORTANT>
### The Iron Law of Re-Verification

**NO COMPLETION CLAIMS WITHOUT RE-VERIFICATION AFTER USER FEEDBACK. This is not negotiable.**

If the user says "Partially" or "No":
1. Track iteration in `.planning/VERIFY_STATE.md`:
   ```yaml
   iteration: 1
   max_iterations: 3
   user_feedback: "Partially - missing X"
   ```
2. Return to dev-implement for targeted fixes
3. Re-invoke dev-verify (re-read this skill from scratch)
4. Re-run ALL verification gates (not just the failed one)
5. Re-ask user acceptance question

**Escalation:** After 3 iterations without "Yes", escalate to user:
- "We've iterated 3 times without full acceptance. Should we continue, descope, or take a different approach?"

**Claiming 'verified' after user said 'Partially' without re-running verification is NOT HELPFUL — you're telling the user their problem is solved when it isn't.**
</EXTREMELY-IMPORTANT>

**Only claim COMPLETE when:**
- [ ] All technical tests pass (automated)
- [ ] User confirms requirements met (manual)
- [ ] If re-verification: iteration tracked and all gates re-run

## Bottom Line

**Two types of verification required:**

1. **Technical** - Run commands, see output, confirm no errors
2. **Requirements** - Ask user if it does what they wanted

Both must pass. No shortcuts exist.

## Workflow Complete

**Phase summary (append to LEARNINGS.md):**

```yaml
## Phase: Verify

---
phase: verify
status: completed
implements: [<all v1 REQ-IDs traced to passing evidence>]
requires: [REVIEW_STATE.md, all-tests-passing]
provides: [user-acceptance, workflow-complete]
affects: []             # verification is read-only; no files modified
constraint-check: PASS
goal-backward-verification: all-goals-met
user-verdict: "Yes, requirements met"
---
```

When user confirms "Yes, requirements met":

Announce: "Dev workflow complete. All 7 phases passed."

The `/dev` workflow is now finished. Offer to:
- Commit the changes
- Clean up `.planning/` files
- Start a new feature with `/dev`

---

## Key Principles

**Fresh Evidence Always:** Every claim requires proof from a fresh command execution, not cached results or agent reports.

**Runtime Over Structural:** Verify code works by running it, not by checking if code exists. Structural analysis cannot prove behavior.

**E2E for User-Facing:** User-visible features require end-to-end evidence (screenshots, user flow tests), not unit tests alone.
