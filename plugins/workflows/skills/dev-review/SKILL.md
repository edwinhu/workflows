---
name: dev-review
description: "REQUIRED Phase 6 of /dev workflow. Combines spec compliance and code quality checks with confidence scoring."
---

**Announce:** "I'm using dev-review (Phase 6) to check code quality."

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

Before reviewing, verify:
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

### Gate Check

```bash
# Check LEARNINGS.md for test output
grep -E "(PASS|OK|SUCCESS|\d+ passed)" .claude/LEARNINGS.md
```

**If no test output found, STOP and return to /dev-implement.**

"It should work" is NOT evidence. Test output IS evidence.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Review

**Only report issues with >= 80% confidence. This is not negotiable.**

Before reporting ANY issue, you MUST:
1. Verify it's not a false positive
2. Verify it's not a pre-existing issue
3. Assign a confidence score
4. Only report if score >= 80

This applies even when:
- "This looks suspicious"
- "I think this might be wrong"
- "The style seems inconsistent"
- "I would have done it differently"

**If you catch yourself about to report a low-confidence issue, DISCARD IT.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "Tests probably pass" | No evidence | Check LEARNINGS.md for output |
| "This looks wrong" | Vague suspicion isn't evidence | Find concrete proof or discard |
| "I would do it differently" | Style preference isn't a bug | Check if it violates guidelines |
| "This might cause problems" | "Might" means < 80% confidence | Find proof or discard |
| "Pre-existing but should be fixed" | Not your scope | Score it 0 and discard |
| "User can test it" | Automation likely possible | Return to implement phase |

## Review Focus Areas

### Test Evidence (Check First!)
- [ ] LEARNINGS.md contains actual test command output
- [ ] Tests show PASS/OK (not SKIP, FAIL, or missing)
- [ ] UI changes have screenshot/snapshot evidence
- [ ] All test types run (unit, integration, UI as applicable)

### Spec Compliance
- [ ] All requirements from .claude/SPEC.md are implemented
- [ ] Acceptance criteria are met
- [ ] No requirements were skipped or partially implemented
- [ ] Edge cases mentioned in spec are handled

### Code Quality
- [ ] Code is simple and DRY (no unnecessary duplication)
- [ ] Logic is correct (no bugs, handles edge cases)
- [ ] Follows codebase conventions (naming, patterns, structure)
- [ ] Error handling is complete
- [ ] No security vulnerabilities

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

## Agent Invocation

Main chat spawns Task agent:

```
Task(subagent_type="general-purpose"):
"Review implementation against .claude/SPEC.md.

FIRST: Check .claude/LEARNINGS.md for test output.
If no test output found, return BLOCKED immediately.

Single-pass review covering:
1. Test evidence - tests actually run and pass?
2. Spec compliance - all requirements met?
3. Code quality - simple, correct, follows conventions?

Confidence score each issue (0-100).
Only report issues >= 80 confidence.
Return structured output per /dev-review format."
```

## Honesty Requirement

<EXTREMELY-IMPORTANT>
**Approving without test evidence is LYING.**

When you say "APPROVED", you are asserting:
- Tests actually ran (not "should work")
- Test output shows PASS (not SKIP, not assumed)
- You saw the evidence (not trusting reports)

Saying "APPROVED" without test evidence is not "being efficient" - it is LYING about code quality.

**BLOCKED is honest. Fake APPROVED is fraud.**
</EXTREMELY-IMPORTANT>

## Rationalization Prevention

These thoughts mean STOP—you're about to approve dishonestly:

| Thought | Reality |
|---------|---------|
| "Tests probably pass" | Probably ≠ evidence. Check LEARNINGS.md. |
| "I saw the code, it looks right" | Looking ≠ running. Where's test output? |
| "User is waiting for approval" | User wants HONEST approval. Say BLOCKED if needed. |
| "It's a small change" | Small changes break things. Require evidence. |
| "I trust the implementer" | Trust doesn't replace verification. Check evidence. |
| "I'll approve and they can fix later" | NO. BLOCKED now or bugs ship. |
| "Review is just a formality" | Review is the LAST GATE before bugs ship. Take it seriously. |

## Quality Standards

- **Test evidence is mandatory** - no approval without test output
- Never report style preferences not backed by project guidelines
- Pre-existing issues are NOT your concern (confidence = 0)
- Each reported issue must be immediately actionable
- File paths must be absolute and include line numbers
- If unsure, the issue is below 80 confidence

## Phase Complete

**REQUIRED SUB-SKILL:** After review is APPROVED, IMMEDIATELY invoke:
```
Skill(skill="workflows:dev-verify")
```

If CHANGES REQUIRED, return to `/dev-implement` to fix issues first.
