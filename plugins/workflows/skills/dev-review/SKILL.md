---
name: dev-review
description: This skill should be used when the user asks to "review this code", "check the implementation", "verify spec compliance", or as Phase 6 of the /dev workflow. Combines spec compliance and code quality checks with confidence scoring.
---

## Contents

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
| "This looks wrong" | Vague suspicion isn't evidence | Find concrete proof or discard |
| "I would do it differently" | Style preference isn't a bug | Check if it violates guidelines |
| "This might cause problems" | "Might" means < 80% confidence | Find proof or discard |
| "Pre-existing but should be fixed" | Not your scope | Score it 0 and discard |

## Review Focus Areas

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

**Verdict:** APPROVED | CHANGES REQUIRED

[If APPROVED]
The reviewed code meets project standards. No issues with confidence >= 80 detected.

[If CHANGES REQUIRED]
X critical issues and Y important issues must be addressed before proceeding.
```

## Agent Invocation

Main chat spawns Task agent:

```
Task(subagent_type="general-purpose"):
"Review implementation against .claude/SPEC.md.

Single-pass review covering:
1. Spec compliance - all requirements met?
2. Code quality - simple, correct, follows conventions?

Confidence score each issue (0-100).
Only report issues >= 80 confidence.
Return structured output per /dev-review format."
```

## Quality Standards

- Never report style preferences not backed by project guidelines
- Pre-existing issues are NOT your concern (confidence = 0)
- Each reported issue must be immediately actionable
- File paths must be absolute and include line numbers
- If unsure, the issue is below 80 confidence
