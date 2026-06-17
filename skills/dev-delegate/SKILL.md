---
name: dev-delegate
description: "Internal skill used by dev-implement during Phase 5 of /dev workflow. NOT user-facing - invoked inside each turn under an active /goal for the implementation phase."
user-invocable: false
disable-model-invocation: true
---

**Announce:** "I'm using dev-delegate to dispatch implementation subagents."

## Contents

- [The Iron Law of Delegation](#the-iron-law-of-delegation)
- [Where This Fits](#where-this-fits)
- [The Process](#the-process)
- [Delegation Facts](#delegation-facts)

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**EVERY IMPLEMENTATION MUST GO THROUGH A TASK AGENT. This is not negotiable.**

Main chat MUST NOT:
- Write code directly
- Make "quick fixes"
- Edit implementation files
- "Just do this one thing"

**If you're about to write code in main chat, STOP. Spawn a Task agent instead.**
</EXTREMELY-IMPORTANT>

## Where This Fits

```
Main Chat                          Task Agent
─────────────────────────────────────────────────────
/goal <condition>  (set once at phase entry)
dev-implement (orchestrates)
  → dev-delegate (this skill — once per task)
    → spawns Task agent ──────────→ follows dev-tdd
                                    uses dev-test tools
```

**Main chat** uses this skill to spawn Task agents.
**Task agents** follow `dev-tdd` (TDD protocol) and use `dev-test` (testing tools).

## Core Principle

**Fresh subagent per task + two-stage review = high quality, fast iteration**

- Implementer subagent does the work (following dev-tdd)
- Spec reviewer confirms it matches requirements
- Quality reviewer checks code quality
- Loop until both approve

## When to Use

Called by `dev-implement` once per task while the implementation phase's `/goal` is active. Don't invoke directly.

## The Process

```
For each task:
    1. Dispatch implementer subagent
       - If questions → answer, re-dispatch
       - Implements, tests, commits
    2. Dispatch spec reviewer subagent
       - If issues → implementer fixes → re-review
    3. Dispatch quality reviewer subagent
       - If issues → implementer fixes → re-review
    4. Mark task complete
```

## Step 1: Dispatch Implementer

**Pattern:** Use structured delegation template from `references/delegation-template.md`

Every delegation MUST include:
1. TASK - What to do
2. EXPECTED OUTCOME - Success criteria
3. REQUIRED SKILLS - Why this agent
4. REQUIRED TOOLS - What they'll need
5. MUST DO - Non-negotiable constraints
6. MUST NOT DO - Hard blocks
7. CONTEXT - Parent session state
8. VERIFICATION - How to confirm completion

Use this Task invocation (fill in brackets):

```
Task(subagent_type="workflows:dev-implementer", prompt="""
# TASK

Implement: [TASK NAME]

## EXPECTED OUTCOME

You will have successfully completed this task when:
- [ ] [Success criterion 1]
- [ ] [Success criterion 2]
- [ ] Tests pass (TDD enforced)
- [ ] No regressions in existing tests

## REQUIRED SKILLS

This task requires:
- [Language/framework]: [Why]
- Testing: TDD (test-first mandatory)
- [Other skills as needed]

## REQUIRED TOOLS

You will need:
- Read: Examine existing code
- Write: Create new files
- Edit: Modify existing files
- Bash: Run tests and verify

**Tools denied:** None (full implementation access)

## MUST DO

- [ ] Write test FIRST (TDD RED-GREEN-REFACTOR)
- [ ] Run test suite after each change
- [ ] Follow existing code patterns in [file]
- [ ] [Other non-negotiable requirements]

## MUST NOT DO

- ❌ Write code before test
- ❌ Skip test execution
- ❌ Use `any` / `@ts-ignore` / type suppression
- ❌ Commit broken code

## DEVIATION RULES

You WILL discover unplanned work. Apply these rules and track all deviations:

| Rule | Trigger | Action |
|------|---------|--------|
| **R1: Bug** | Broken behavior, errors, type errors, security vulns | Auto-fix → test → track `[Rule 1 - Bug]` |
| **R2: Missing Critical** | Missing error handling, validation, auth, logging | Auto-fix → test → track `[Rule 2 - Missing Critical]` |
| **R3: Blocking** | Missing deps, wrong types, broken imports | Auto-fix → test → track `[Rule 3 - Blocking]` |
| **R4: Architectural** | New DB table, schema change, switching libs, breaking API | **STOP → escalate to delegator** |

**Rules 1-3:** Fix automatically, test, document what you did.
**Rule 4:** Do NOT proceed. Report the architectural decision needed back to the delegator with: what you found, proposed change, why needed, impact, and alternatives.

**Unsure which rule?** Default to Rule 4 (STOP and escalate).

In your output, include: **Deviations:** N auto-fixed (R1: X, R2: Y, R3: Z), N escalated (R4: W).

## CONTEXT

### Task Brief (read once — self-contained)

Generate the brief with task-brief.sh, then hand the implementer the PATH (not the
pasted text). The brief carries the task row, the Global Constraints, and the task's
Interfaces — so the implementer reads ONE file and never re-reads the full PLAN.md:

```bash
bash ${CLAUDE_SKILL_DIR}/../../scripts/dev/task-brief.sh .planning/PLAN.md [TASK_NUMBER]
# prints: wrote .planning/handoff/task-[N]-brief.md
```

Read the brief in one call: `.planning/handoff/task-[N]-brief.md`

### Project Context
- Project: [brief description]
- Related files: [list from exploration]
- Test command: [from SPEC.md]

## TDD Protocol (MANDATORY)

<EXTREMELY-IMPORTANT>
**LOAD THIS SKILL FIRST:**

Before writing any code, you MUST load the TDD skill:

```
Read `${CLAUDE_SKILL_DIR}/../../skills/dev-tdd/SKILL.md` and follow its instructions.
```

This loads:
- Task reframing (your job is writing tests, not features)
- The Execution Gate (6 mandatory gates before E2E testing)
- GATE 5: READ LOGS (mandatory - cannot skip)
- The Iron Law of TDD (test-first approach)

**Load dev-tdd now before proceeding.**
</EXTREMELY-IMPORTANT>

Follow the RED-GREEN-REFACTOR cycle from dev-tdd:

1. **RED**: Write a failing test FIRST
   - Run it, SEE IT FAIL
   - Document: "RED: [test] fails with [error]"

2. **GREEN**: Write MINIMAL code to pass
   - Run test, SEE IT PASS
   - Document: "GREEN: [test] passes"

3. **REFACTOR**: Clean up while staying green

**If you write code before seeing RED, you're not doing TDD. Stop and restart.**

## Testing Tools

For test options (pytest, Playwright, ydotool), load dev-test skill after dev-tdd.

Tests must EXECUTE code and VERIFY behavior. Grepping is NOT testing.

## If Unclear
Ask questions BEFORE implementing. Don't guess.

## Output
Report:
- RED: What test failed and how
- GREEN: What made it pass
- Test command and output
- Commit SHA
- Any concerns
""")
```

**If implementer asks questions:** Answer clearly, then re-dispatch with answers included.

**If implementer finishes:** Proceed to spec review.

## Step 2: Dispatch Spec Reviewer

Use this Task invocation:

```
Task(subagent_type="general-purpose",
     allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
     prompt="""
Review spec compliance for: [TASK NAME]

## Original Requirements (read once — self-contained)
The task brief — task row, Global Constraints, and Interfaces — is at:
`.planning/handoff/task-[N]-brief.md` (generated by task-brief.sh). Read it once.

## Success Criteria (from SPEC.md)
[PASTE RELEVANT CRITERIA]

## CRITICAL: Do Not Trust the Report

The implementer finished suspiciously quickly. Their report may be incomplete,
inaccurate, or optimistic. You MUST verify everything independently.

**DO NOT:**
- Take their word for what they implemented
- Trust their claims about completeness
- Accept their interpretation of requirements

**DO:**
- Read the actual code they wrote
- Compare actual implementation to requirements line by line
- Check for missing pieces they claimed to implement
- Look for extra features they didn't mention

## Review Checklist
1. Does implementation meet ALL requirements?
2. Is anything MISSING from the spec?
3. Is anything EXTRA not in the spec?

## Review Integrity (non-negotiable)
- Report every gap; suppressing one because it's awkward is banned.
- A stated rationale is a claim to verify, never grounds to wave a gap through.
- If you cannot judge compliance from the code available, say **"Cannot verify"** and
  name what's missing — do not assume COMPLIANT.

## Output Format
- COMPLIANT: All requirements met, nothing extra (after verifying code yourself)
- ISSUES: List what's missing or extra with file:line references

Be strict. "Close enough" is not compliant. Verify by reading code.
""")
```

**If COMPLIANT:** Proceed to quality review.

**If ISSUES:** Have implementer fix, then re-run spec review.

## Step 3: Dispatch Quality Reviewer

Use this Task invocation:

```
Task(subagent_type="general-purpose",
     allowed_tools=["Read", "Glob", "Grep", "Bash(read-only)"],
     prompt="""
Review code quality for: [TASK NAME]

## Changes to Review (read once — review package)
A review package (commits + stat + full diff at `-U10`, with `.planning/` excluded)
has been written to a file. Read it ONCE; do NOT re-run `git diff`/`git log`. The
diff's context lines ARE the changed files.

Generate it first (BASE = the commit before this task's implementer ran — never
`HEAD~1`, which drops all but the last commit of a multi-commit task):

```bash
bash ${CLAUDE_SKILL_DIR}/../../scripts/dev/review-package.sh [BASE_SHA] HEAD
# prints: wrote .planning/handoff/review-[base]..[head].diff
```

Package path to read: `.planning/handoff/review-[base]..[head].diff`

## Review Focus
1. Code correctness (logic errors, edge cases)
2. Test coverage (are tests meaningful?)
3. Code style (matches project conventions?)
4. No regressions introduced

## Review Integrity (non-negotiable)
- Report every qualifying finding; suppressing one or pre-rating its severity down
  to dodge a fix is banned — a withheld finding is a bug shipped under your sign-off.
- A stated rationale (comment, commit message, implementer note) is a claim to
  verify against the diff and spec, never a reason to downgrade a finding's severity.
- If the diff is insufficient to judge a finding, label it **"Cannot verify from
  diff"** and name what you'd need — do not guess a verdict.

## Confidence Scoring
Rate each issue 0-100. Only report issues >= 80 confidence.
Bucket reported issues by severity: **Critical** (must fix) / **Important** (should
fix) / **Minor** (nice to have); plus **Cannot verify from diff** for unjudgeable items.

## Output Format
### Strengths
- [what's good]

### Issues (Confidence >= 80)
#### [Issue Title] (Confidence: XX)
- Location: [file:line]
- Problem: [description]
- Fix: [suggestion]

### Verdict
APPROVED or CHANGES REQUIRED
""")
```

**If APPROVED:** Mark task complete, move to next task.

**If CHANGES REQUIRED:** Have implementer fix, then re-run quality review.

## Delegation Facts

- Subagent time is cheap; orchestrator context is expensive. A main-chat edit consumes the context every remaining task depends on — the cost asymmetry, not the size of the change, is why even one-line fixes go through a Task agent. "Quick fix in main chat" is counterproductive on its own terms.
- "Code" for delegation purposes is everything that lands in the repo: ported/adapted code, config files (JSON/YAML/TOML), boilerplate, setup work, and mechanical execution of a detailed PLAN.md. The only main-chat writes are `.planning/*.md`.
- Spec review and quality review verify different claims and run in order — spec compliance first, then quality. A quality APPROVED without a prior spec COMPLIANT says nothing about whether requirements were met; "Task complete" asserts a Task agent implemented it, the spec reviewer confirmed compliance, AND the quality reviewer approved. Claiming it with any leg missing is an unverified claim presented as fact.
- When an implementer's work fails review, the fix goes to a fix subagent — fixing it manually in main chat is the same context pollution the Iron Law exists to prevent, now with reviewer findings as cover.
- Subagents do not share your session context, but the task text does not belong in the prompt either: a pasted task parks those bytes in the controller's context permanently. Generate the brief with `task-brief.sh` and hand over the FILE PATH — the subagent reads `.planning/handoff/task-N-brief.md` in one call (it carries the task row + Global Constraints + Interfaces, so it never re-reads PLAN.md). A prompt that says "read PLAN.md" still produces an implementer that guesses at scope; the brief is the scoped middle ground.
- Diffs are the most expensive thing review moves. Write the diff to a file once with `review-package.sh` and pass the PATH; a diff pasted into a prompt is re-paid every reviewer and every re-review. The package excludes `.planning/` so handoff artifacts never recurse into the diff being reviewed.

## Example Flow

```
Me: Implementing Task 1: Add user validation

[Dispatch implementer with full task text]

Implementer: "Should validation happen client-side or server-side?"

Me: "Server-side only, in the API layer"

[Re-dispatch implementer with answer]

Implementer:
- Added validateUser() in api/users.ts
- Tests: 5/5 passing
- Committed: abc123

[Dispatch spec reviewer]

Spec Reviewer: ISSUES
- Missing: Email format validation (spec line 12)

[Tell implementer to fix]

Implementer:
- Added email regex validation
- Tests: 6/6 passing
- Committed: def456

[Re-dispatch spec reviewer]

Spec Reviewer: COMPLIANT

[Dispatch quality reviewer with commit range]

Quality Reviewer: APPROVED
- Strengths: Good test coverage, clear naming
- No issues >= 80 confidence

[Mark Task 1 complete, move to Task 2]
```

## Model Tier Hints

When dispatching subagents, match model capability to task complexity via the Agent tool's `model` parameter (omit it to inherit the session model — the right default for judgment-heavy work).

| Task Complexity | Model Tier | Signals | Example |
|----------------|------------|---------|---------|
| **Mechanical** | Cheapest capable | Isolated function, 1-2 files, clear spec, boilerplate | "Add type definition file" |
| **Integration** | Standard | Multi-file coordination, pattern matching, debugging within scope | "Connect auth service to API route" |
| **Architecture/Review** | Most capable | Design judgment needed, broad codebase understanding, reviews | "Review entire implementation for spec compliance" |

**Complexity signals:**
- Touches 1-2 files with complete spec → mechanical
- Touches 3+ files or requires cross-module understanding → integration
- Requires design judgment or codebase-wide impact assessment → architecture

**When in doubt, use the standard tier.** Over-allocating is wasteful; under-allocating produces poor results.

### Turn-Economics Facts

- Turn count beats token price. Context cost and wall-clock scale with how many turns a subagent burns, and the cheapest model routinely takes 2-3× the turns on multi-step work — so the "cheap" model often costs more end to end. Use a **mid-tier model as the FLOOR** for implementers working from a prose task and for reviewers; reserve the cheapest tier for genuinely mechanical single-file edits. The "Mechanical" row above is the only place the cheapest tier is the right call.
- Always set the model explicitly when it matters. An omitted `model` inherits the session model — often the most capable and most expensive — which silently overspends on a task that a mid-tier model would finish in the same number of turns. Omit `model` only when you *want* session-level capability (judgment-heavy architecture/review); pin it otherwise.

## Integration

**Main chat invokes:**
- `/goal` (active for the phase) → `dev-implement` → `dev-delegate` (this skill)

**Task agents follow:**
- `dev-tdd` - TDD protocol (RED-GREEN-REFACTOR)
- `dev-test` - Testing tools (pytest, Playwright, ydotool)

After all tasks complete with passing tests, `dev-implement` proceeds to `dev-review`.
