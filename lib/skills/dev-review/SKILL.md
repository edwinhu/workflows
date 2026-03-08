---
name: dev-review
description: "This skill should be used as REQUIRED Phase 6 of /dev workflow when the implementation is complete and needs code review. Combines spec compliance and code quality checks with confidence-based filtering."
---

## Contents

- [Prerequisites - Test Output Gate](#prerequisites---test-output-gate)
- [The Iron Law of Review](#the-iron-law-of-review)
- [Red Flags - STOP Immediately If You Think](#red-flags---stop-immediately-if-you-think)
- [Review Focus Areas](#review-focus-areas)
- [Confidence Scoring](#confidence-scoring)
- [Required Output Structure](#required-output-structure)
- [Agent Invocation](#agent-invocation)
- [Quality Standards](#quality-standards)

# Code Review

Single-pass code review combining spec compliance and quality checks. Uses confidence-based filtering to report only high-priority issues.

<EXTREMELY-IMPORTANT>
## Prerequisites - Test Output Gate

**Do NOT start review without test evidence.**

Before reviewing, verify these preconditions:
1. `.claude/LEARNINGS.md` contains **actual test output**
2. Tests were **run** (not just written)
3. Test output shows **PASS** (not SKIP, not assumed)

### What Counts as Test Evidence

| Valid Evidence | NOT Valid |
|----------------|-----------|
| `meson test` output with results | "Tests should pass" |
| `pytest` output showing PASS | "I wrote tests" |
| Screenshot of working UI | "It looks correct" |
| Playwright snapshot showing expected state | "User can verify" |
| D-Bus command output | "The feature works" |
| **E2E test output with user flow verified** | **"Unit tests pass" (for UI changes)** |

<EXTREMELY-IMPORTANT>
### The E2E Evidence Requirement

**FOR USER-FACING CHANGES: Unit test evidence is INSUFFICIENT.**

Before approving user-facing changes, verify:
1. Unit tests pass (necessary but not sufficient)
2. **E2E tests pass** (required for approval)
3. Visual evidence exists (screenshots/snapshots for UI)

| Change Type | Unit Evidence | E2E Evidence | Approval? |
|-------------|---------------|--------------|------------|
| Internal refactor | Yes | N/A | APPROVE |
| API change | Yes | Missing | BLOCKED |
| UI change | Yes | Missing | BLOCKED |
| User workflow | Yes | Missing | BLOCKED |

Return BLOCKED if E2E evidence is missing for user-facing changes.

"Unit tests pass" without E2E for UI changes is NOT approvable.
</EXTREMELY-IMPORTANT>

### Gate Check

Check LEARNINGS.md for test output:

```bash
rg -E "(PASS|OK|SUCCESS|\d+ passed)" .claude/LEARNINGS.md
```

If no test output is found, STOP and return to /dev-implement.

"It should work" is NOT evidence. Test output IS evidence.
</EXTREMELY-IMPORTANT>

## Review Strategy Choice

After verifying test output in LEARNINGS.md, choose review strategy.

**Skip this choice when:**
- Trivial changes (< 50 LOC, single file)
- Purely cosmetic changes (formatting, comments)
- Automated refactoring (rename, extract)
- Internal utility functions (not user-facing or security-sensitive)

**Otherwise, ask the user:**

```python
AskUserQuestion(questions=[{
  "question": "How should we review this implementation?",
  "header": "Review Strategy",
  "options": [
    {"label": "Single reviewer (Default)", "description": "Combined review covering spec compliance and code quality. Faster, lower overhead."},
    {"label": "Parallel review (Thorough)", "description": "Spawn 3 specialized reviewers (Security, Performance, Tests). Use for security-sensitive, performance-critical, or test-heavy PRs. Requires reconciliation."}
  ],
  "multiSelect": false
}])
```

**If Single reviewer:** Proceed to [The Iron Law of Review](#the-iron-law-of-review) below (current behavior).

**If Parallel review:** Skip to [Parallel Review (Thorough)](#parallel-review-thorough).

---

## Parallel Review (Thorough)

Use this section when user chose "Parallel review (Thorough)" above.

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to single reviewer.

### 1. Prerequisites Check

Before spawning reviewers, verify:

1. **Test evidence exists** - LEARNINGS.md contains actual test output (check first!)
2. **E2E evidence for UI changes** - User-facing changes have E2E test output (not just unit tests)
3. **Changed files identified** - `git diff --name-only` to scope review
4. **SPEC.md exists** - reviewers verify against spec, not assumptions

If any prerequisite fails, STOP and return BLOCKED to /dev-implement.

### 2. When to Use Parallel Review

**Use parallel review when:**
- Security-sensitive changes (auth, permissions, data access, crypto, input validation)
- Performance-critical paths (tight loops, database queries, API endpoints)
- Test-heavy PRs (new test infrastructure, testing frameworks, E2E flows)
- Complex PRs (4+ files changed, multiple subsystems affected)
- High-stakes deployments (production hotfixes, customer-facing releases)

**Do NOT use when:**
- Simple bug fixes (< 50 LOC, single file)
- Documentation or config changes
- Automated refactoring (no logic changes)
- Internal utilities (not security-sensitive or performance-critical)
- Overhead exceeds benefit (< 4 files changed)

### 3. Create Team and Spawn Reviewers

#### Team Creation

```
TeamCreate(name="Code Review", task_description="Parallel code review with 3 specialized reviewers")
```

Press **Shift+Tab** to enter delegate mode. The lead coordinates reviews, does NOT review code directly.

#### Spawn 3 Reviewers

Each reviewer receives a self-contained prompt from a reference file. **Reviewers start with a blank conversation and do NOT auto-load skills.** Read the prompt, substitute variables, and paste it in full.

**Before spawning, substitute these variables in each prompt:**
- `CHANGED_FILES` -> output of `git diff --name-only HEAD~1` (paste actual list)
- `SPEC_CONTEXT` -> relevant sections of .claude/SPEC.md (paste inline, do NOT reference file)
- `LEARNINGS_TEST_OUTPUT` -> test output from .claude/LEARNINGS.md (paste actual output)
- `PLUGIN_ROOT` -> resolved value of `${CLAUDE_PLUGIN_ROOT}`

**Reviewer prompts (read, substitute variables, send as message):**

| Reviewer | Focus | Prompt Source |
|----------|-------|---------------|
| 1. Security | Vulnerabilities, auth, data exposure, crypto | `references/security-reviewer.md` |
| 2. Performance | Complexity, queries, memory, hot paths | `references/performance-reviewer.md` |
| 3. Tests | Coverage, correctness, reliability, E2E | `references/tests-reviewer.md` |

---

### 4. Lead Monitoring

While reviewers work, the lead:

- **Watches for completion messages** from all 3 reviewers
- **Does NOT review code directly** - your job is coordination and reconciliation
- **If a reviewer asks a question:** Answer it, then broadcast to other reviewers if relevant
- **If a reviewer is taking significantly longer than others:** Message them for status
- **When all 3 reviewers complete:** Proceed to reconciliation

### 5. Reconciliation Protocol (3 Passes)

After ALL reviewers message completion, the lead performs three passes:

<EXTREMELY-IMPORTANT>
**Pass 1 -- Deduplication:**

Multiple reviewers may find the same issue (e.g., input validation gap found by both Security and Tests reviewers).

1. Read all reviewer findings
2. Group by file and line number
3. Identify duplicates:
   - Same file:line
   - Same root cause (even if described differently)
4. Merge duplicates:
   - Keep the highest confidence score
   - Combine descriptions if both add value
   - Attribute to both reviewers

**Example:**
```
Security found: "file.py:42 - Input not validated (Confidence: 85)"
Tests found: "file.py:42 - Missing test for invalid input (Confidence: 80)"

-> Merge: "file.py:42 - Input validation missing + no test coverage (Confidence: 85, found by Security + Tests)"
```

**Pass 2 -- Prioritization:**

Not all issues are equally important. Rank by:

1. **Severity x Confidence:**
   - Critical (90-100 confidence) > Important (80-89)
   - Security > Performance > Tests (when confidence is equal)
2. **Impact on users:**
   - User-facing > Internal
   - Data loss risk > Slowness > Test gaps
3. **Fix effort:**
   - Quick wins (< 30 min) should be fixed now
   - Large refactors (> 2 hours) should be filed as tech debt

Create final prioritized list:
```
1. [CRITICAL] Security: XSS in user input (Confidence: 95)
2. [CRITICAL] Tests: User workflow untested (Confidence: 90)
3. [IMPORTANT] Performance: N+1 query in hot path (Confidence: 85)
4. [IMPORTANT] Tests: Error path missing coverage (Confidence: 80)
```

**Pass 3 -- Integration Check:**

Proposed fixes may conflict with each other.

1. Read each reviewer's suggested fixes
2. Check for conflicts:
   - Do two fixes modify the same code?
   - Does one fix introduce a problem the other reviewer would flag?
   - Do fixes require contradictory approaches?
3. If conflicts exist:
   - Design a unified fix addressing both concerns
   - OR: Flag the conflict and ask reviewers for input

**Example conflict:**
```
Security: "Add input validation on every field"
Performance: "Batch validate to reduce overhead"

-> Unified: "Batch validate with early exit on first invalid field (security + performance)"
```

**If ANY pass finds conflicts -> resolve before reporting final verdict.**
</EXTREMELY-IMPORTANT>

### 6. Final Verdict

After reconciliation, the lead reports:

```markdown
## Parallel Code Review: [Feature Name]

Reviewed by: Security, Performance, Tests

### Reconciliation Summary

**Issues found:** X total (Y critical, Z important)
**Duplicates merged:** N
**Conflicts resolved:** M

### Critical Issues (Must Fix)

[Deduplicated, prioritized list from Pass 1 + 2]

### Important Issues (Should Fix)

[Deduplicated, prioritized list from Pass 1 + 2]

### Verdict: APPROVED | CHANGES REQUIRED

[If APPROVED]
All 3 reviewers approved with no issues >= 80 confidence.

[If CHANGES REQUIRED]
X critical and Y important issues must be addressed. Return to /dev-implement.
```

## Phase Complete (Parallel Review)

After parallel review completes:

**If APPROVED:** Immediately invoke the dev-verify skill:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-verify/SKILL.md")
```

**If CHANGES REQUIRED:** Return to `/dev-implement` to fix reported issues.

**If BLOCKED (test evidence missing):** Return to `/dev-implement` to collect test evidence.

---

<EXTREMELY-IMPORTANT>
## The Iron Law of Review

**You MUST report only issues with >= 80% confidence. This is not negotiable.**

Before reporting ANY issue, complete these verification steps:
1. Verify it's not a false positive
2. Verify it's not a pre-existing issue
3. Assign a confidence score
4. Report only if score >= 80

You MUST apply this rule even when encountering:
- "This looks suspicious"
- "I think this might be wrong"
- "The style seems inconsistent"
- "I would have done it differently"

You MUST discard any low-confidence issue found during review.
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "Tests probably pass" | You don't have evidence - absence of evidence is not evidence | Check LEARNINGS.md for actual output |
| "This looks wrong" | Your vague suspicion != evidence | Find concrete proof or discard |
| "I would do it differently" | Your style preference != bug | Check if it violates project guidelines |
| "This might cause problems" | Your "might" = < 80% confidence | Find proof or discard |
| "Pre-existing but should be fixed" | You're out of scope | Score it 0 and discard |
| "User can test it" | Your manual testing is less reliable than automation | Return to implement phase |

## Review Focus Areas

### Test Evidence (Check First!)
- [ ] LEARNINGS.md contains actual test command output
- [ ] Tests show PASS/OK (not SKIP, FAIL, or missing)
- [ ] UI changes have screenshot/snapshot evidence
- [ ] All test types run (unit, integration, UI as applicable)
- [ ] E2E tests exist and pass for user-facing changes
- [ ] E2E test simulates actual user flow, not just component render

### Spec Compliance
- [ ] All requirements from .claude/SPEC.md are implemented
- [ ] Acceptance criteria are met
- [ ] No requirements were skipped or partially implemented
- [ ] Edge cases mentioned in spec are handled

### Code Quality
- [ ] Code is simple and DRY (no unnecessary duplication)
- [ ] Logic is correct (no bugs, handles edge cases)
- [ ] Codebase conventions followed (naming, patterns, structure)
- [ ] Error handling is complete
- [ ] No security vulnerabilities detected

## Confidence Scoring

Rate each potential issue from 0-100:

| Score | Meaning |
|-------|---------|
| 0 | False positive or pre-existing issue |
| 25 | Might be real, might not. Stylistic without guideline backing |
| 50 | Real issue but nitpick or rare in practice |
| 75 | Verified real issue, impacts functionality |
| 100 | Absolutely certain, confirmed with direct evidence |

**CRITICAL: Only report issues with confidence >= 80.**

## Required Output Structure

```markdown
## Code Review: [Feature/Change Name]
Reviewing: [files/scope being reviewed]

### Test Evidence Verified
- Unit tests: [PASS/FAIL/MISSING] - [paste key output line]
- Integration: [PASS/FAIL/N/A]
- UI/Visual: [Screenshot taken / Snapshot verified / N/A]

### Critical Issues (Confidence >= 90)

#### [Issue Title] (Confidence: XX)

**Location:** `file/path.ext:line_number`

**Problem:** Clear description of the issue

**Fix:**
```[language]
// Specific code fix
```

### Important Issues (Confidence 80-89)

[Same format as Critical Issues]

### Summary

**Verdict:** APPROVED | CHANGES REQUIRED | BLOCKED (no test evidence)

[If APPROVED]
The reviewed code meets project standards. Tests pass. No issues with confidence >= 80 detected.

[If CHANGES REQUIRED]
X critical issues and Y important issues must be addressed before proceeding.

[If BLOCKED]
Cannot approve without test evidence. Return to /dev-implement and run tests.
```

**If review finds the implementation fundamentally violates the spec (not just minor issues), DELETE the contaminated implementation and return to dev-implement for a fresh attempt. Do not patch a structurally wrong approach.**

### Delete & Restart Protocol

**When implementation deviates fundamentally from spec, DELETE and restart entirely.**

| Situation | Action |
|-----------|--------|
| Code uses wrong protocol/architecture than spec | DELETE. Rewrite from scratch with correct approach. |
| Code implements different approach than PLAN.md | DELETE. User approved specific approach for a reason. |
| Fundamental misunderstanding of requirements | DELETE. Don't patch. Fresh subagent with correct understanding. |
| Patch would require 30%+ of implementation to change | DELETE. Rewrite is cleaner than patching wrong foundation. |

**Why delete instead of patch:** Patching a structurally wrong approach creates technical debt. Fresh implementation from correct architecture is faster than fixing wrong foundation.

**When to patch instead:** Bug in otherwise-correct implementation, missing edge case, performance tweak, minor deviation that doesn't affect core behavior.

**The test:** If the subagent says "oh, I misunderstood the whole approach" → DELETE and restart.

## Agent Invocation

Spawn Task agent for review execution:

```
Task(subagent_type="general-purpose"):
"Review implementation against .claude/SPEC.md.

FIRST: Check .claude/LEARNINGS.md for test output.
Return BLOCKED immediately if no test output is found.

Complete single-pass review covering:
1. Test evidence - tests actually run and pass?
2. Spec compliance - all requirements met?
3. Code quality - simple, correct, follows conventions?

Confidence score each issue (0-100).
Report only issues with >= 80 confidence.
Return structured output per /dev-review format."
```

## Honesty Requirement

<EXTREMELY-IMPORTANT>
**You approving without test evidence is LYING.**

An "APPROVED" verdict means YOU assert:
- Tests actually ran (not "should work")
- Test output shows PASS (not SKIP, not assumed)
- Evidence exists and YOU verified it (not trusted reports)

You approving without test evidence is not "efficiency" - it is LYING about code quality.

**BLOCKED is honest. Your fake APPROVED is fraud.**
</EXTREMELY-IMPORTANT>

## Rationalization Prevention

STOP - you're about to rationalize if these thoughts arise--they indicate dishonest approval:

| Thought | Reality |
|---------|---------|
| "Tests probably pass" | Your probably != evidence. Check LEARNINGS.md. |
| "I saw the code, it looks right" | Your looking != running. Find test output. |
| "User is waiting for approval" | They want honest approval. You return BLOCKED if needed. |
| "It's a small change" | Your size estimate doesn't matter. Small changes break things. Require evidence. |
| "I trust the implementer" | Your trust doesn't replace verification. You verify evidence. |
| "I'll approve and they can fix later" | You block now or bugs ship to users. |
| "Review is just a formality" | Review is the LAST GATE before bugs ship. You execute seriously. |

## Why Skipping Honest Review Destroys the Drive That Created It

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|-------------|----------------------|---------------------|
| **Helpfulness** | "Approving fast shows efficiency" | Bugs ship. User spends hours debugging your "help." | **Anti-helpful** |
| **Honesty** | "Tests probably pass" | Test output doesn't exist. You fabricated an approval. | **Fraudulent** |
| **Competence** | "I trust the subagent" | Subagent's work was wrong. Your approval was negligence. | **Incompetent** |
| **Efficiency** | "Rubber-stamp to move faster" | You moved fast into bugs. Rework takes 3x longer. | **Anti-efficient** |

**The protocol is not overhead you pay. It is the service you provide.**

## Quality Standards

- **Test evidence is mandatory** - do not approve without test output
- Do not report style preferences lacking project guideline backing
- Do not report pre-existing issues (confidence = 0)
- Make each reported issue immediately actionable
- Use absolute file paths with line numbers in reports
- Treat uncertainty as below 80 confidence

## Phase Complete

After review completes:

**If APPROVED:** Immediately invoke the dev-verify skill:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-verify/SKILL.md")
```

**If CHANGES REQUIRED:** Return to `/dev-implement` to fix reported issues.

**If BLOCKED:** Return to `/dev-implement` to collect test evidence.

## Workflow Continuity After Review

After review verdict, implementation continues immediately:

| Verdict | Next Action |
|---------|-------------|
| APPROVED | Mark task `[x]` in PLAN.md, immediately spawn next task's ralph loop |
| CHANGES REQUIRED | Feed issues back to task agent, agent spawns fresh iteration |

**Do NOT pause between review completion and next task start.** Pausing between tasks is procrastination disguised as checkpoint courtesy.
