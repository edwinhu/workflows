---
name: ds-review
description: Reviews methodology, data quality, and statistical validity.
---
## Contents

- [The Iron Law of DS Review](#the-iron-law-of-ds-review)
- [Red Flags - STOP Immediately If You Think](#red-flags---stop-immediately-if-you-think)
- [Review Focus Areas](#review-focus-areas)
- [Confidence Scoring](#confidence-scoring)
- [Common DS Issues to Check](#common-ds-issues-to-check)
- [Required Output Structure](#required-output-structure)
- [Agent Invocation](#agent-invocation)
- [Quality Standards](#quality-standards)

# Analysis Review

Single-pass review combining methodology correctness, data quality handling, and reproducibility checks. Uses confidence-based filtering.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Review

**Only report issues with >= 80% confidence. This is not negotiable.**

Before reporting ANY issue, you MUST:
1. Verify it's not a false positive
2. Verify it impacts results or reproducibility
3. Assign a confidence score
4. Only report if score >= 80

This applies even when:
- "This methodology looks suspicious"
- "I think this might introduce bias"
- "The approach seems unusual"
- "I would have done it differently"

**If you catch yourself about to report a low-confidence issue, DISCARD IT.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "This looks wrong" | Vague suspicion isn't evidence | Find concrete proof or discard |
| "I would do it differently" | Style preference isn't methodology error | Check if approach is valid |
| "This might cause problems" | "Might" means < 80% confidence | Find proof or discard |
| "Unusual approach" | Unusual isn't wrong | Verify if methodology is sound |

## Review Focus Areas

### Spec Compliance
- [ ] All objectives from .claude/SPEC.md are addressed
- [ ] Success criteria can be verified
- [ ] Constraints were respected (especially replication requirements)
- [ ] Analysis answers the original question

### Data Quality Handling
- [ ] Missing values handled appropriately (not ignored)
- [ ] Duplicates addressed (documented if kept)
- [ ] Outliers considered (handled or justified)
- [ ] Data types correct (dates parsed, numerics not strings)
- [ ] Filtering logic documented with counts

### Methodology Appropriateness
- [ ] Statistical methods appropriate for data type
- [ ] Assumptions documented and checked (normality, independence, etc.)
- [ ] Sample sizes adequate for conclusions
- [ ] Multiple comparisons addressed if applicable
- [ ] Causality claims justified (or appropriately limited)

### Reproducibility
- [ ] Random seeds set where needed
- [ ] Package versions documented
- [ ] Data source/version documented
- [ ] All transformations traceable
- [ ] Results can be regenerated

### Output Quality
- [ ] Visualizations labeled (title, axes, legend)
- [ ] Numbers formatted appropriately (sig figs, units)
- [ ] Conclusions supported by evidence shown
- [ ] Limitations acknowledged

## Confidence Scoring

Rate each potential issue from 0-100:

| Score | Meaning |
|-------|---------|
| 0 | False positive or style preference |
| 25 | Might be real, methodology is unusual but valid |
| 50 | Real issue but minor impact on conclusions |
| 75 | Verified issue, impacts result interpretation |
| 100 | Certain error that invalidates conclusions |

**CRITICAL: Only report issues with confidence >= 80.**

## Common DS Issues to Check

### Data Leakage
- Training data contains information from future
- Test data used in feature engineering
- Target variable used directly or indirectly in features

### Selection Bias
- Filtering introduced systematic bias
- Survivorship bias in longitudinal data
- Non-random sampling not addressed

### Statistical Errors
- Multiple testing without correction
- p-hacking or selective reporting
- Correlation interpreted as causation
- Inadequate sample size for claimed precision

### Reproducibility Failures
- Random operations without seeds
- Undocumented data preprocessing
- Hard-coded paths or environment dependencies
- Missing package versions

## Required Output Structure

```markdown
## Analysis Review: [Analysis Name]
Reviewing: [files/notebooks being reviewed]

### Critical Issues (Confidence >= 90)

#### [Issue Title] (Confidence: XX)

**Location:** `file/path.py:line` or `notebook.ipynb cell N`

**Problem:** Clear description of the issue

**Impact:** How this affects results/conclusions

**Fix:**
```python
# Specific fix
```

### Important Issues (Confidence 80-89)

[Same format as Critical Issues]

### Data Quality Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Missing values | PASS/FAIL | [details] |
| Duplicates | PASS/FAIL | [details] |
| Outliers | PASS/FAIL | [details] |
| Type correctness | PASS/FAIL | [details] |

### Methodology Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Appropriate for data | PASS/FAIL | [details] |
| Assumptions checked | PASS/FAIL | [details] |
| Sample size adequate | PASS/FAIL | [details] |

### Reproducibility Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Seeds set | PASS/FAIL | [details] |
| Versions documented | PASS/FAIL | [details] |
| Data versioned | PASS/FAIL | [details] |

### Summary

**Verdict:** APPROVED | CHANGES REQUIRED

[If APPROVED]
The analysis meets quality standards. No methodology issues with confidence >= 80 detected.

[If CHANGES REQUIRED]
X critical issues and Y important issues must be addressed before proceeding.
```

## Agent Invocation

Main chat spawns Task agent:

```
Task(subagent_type="general-purpose"):
"Review analysis against .claude/SPEC.md.

Single-pass review covering:
1. Spec compliance - objectives met?
2. Data quality - nulls, dupes, outliers handled?
3. Methodology - appropriate, assumptions checked?
4. Reproducibility - seeds, versions, documentation?

Confidence score each issue (0-100).
Only report issues >= 80 confidence.
Return structured output per /ds-review format."
```

## Quality Standards

- Never report methodology preferences not backed by statistical principles
- Alternative valid approaches are NOT issues (confidence = 0)
- Each reported issue must be immediately actionable
- If unsure whether approach is valid, the issue is below 80 confidence
- Focus on what affects conclusions, not style

## Phase Complete

**REQUIRED SUB-SKILL:** After review is APPROVED, IMMEDIATELY invoke:
```
Skill(skill="workflows:ds-verify")
```

If CHANGES REQUIRED, return to `/ds-implement` to fix issues first.