---
name: ds-review
description: "This skill should be used when running Phase 4 of the /ds workflow to review methodology, data quality, and statistical validity. Provides structured review checklists, confidence scoring, and issue identification for data analysis validation."
version: 1.0.0
---

Announce: "Using ds-review (Phase 4) to check methodology and quality."

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

**You MUST only report issues with >= 80% confidence. This is not negotiable.**

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

**STOP - If you catch yourself about to report a low-confidence issue, DISCARD IT. You're about to compromise the review's integrity.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "This looks wrong" | Your vague suspicion isn't evidence | Find concrete proof or discard |
| "I would do it differently" | Your style preference isn't a methodology error | Check if the approach is valid |
| "This might cause problems" | Your "might" means < 80% confidence | Find proof or discard |
| "Unusual approach" | Unusual isn't wrong—your bias toward familiar methods is clouding judgment | Verify the methodology is sound |

## Review Focus Areas

### Spec Compliance
- [ ] Verify all objectives from .claude/SPEC.md are addressed
- [ ] Confirm success criteria can be verified
- [ ] Check constraints were respected (especially replication requirements)
- [ ] Verify analysis answers the original question

### Data Quality Handling
- [ ] Confirm missing values handled appropriately (not ignored)
- [ ] Verify duplicates addressed (documented if kept)
- [ ] Check outliers considered (handled or justified)
- [ ] Verify data types correct (dates parsed, numerics not strings)
- [ ] Confirm filtering logic documented with counts

#### Independent Verification (MANDATORY)

<EXTREMELY-IMPORTANT>
**Do NOT trust the analyst's claims about data quality. Run these checks yourself.**

The analyst may have reported "no duplicates" without actually checking, or "handled missing values" by silently dropping rows. You MUST run independent verification.
</EXTREMELY-IMPORTANT>

Dispatch a Task agent to run these checks on the final analysis data:

```python
# 1. Empty/constant columns (useless data kept in analysis)
for col in df.columns:
    if df[col].nunique() <= 1:
        print(f"WARNING: {col} is constant or empty ({df[col].nunique()} unique values)")

# 2. High-null columns still in analysis
null_pct = df.isnull().mean()
high_null = null_pct[null_pct > 0.5]
if len(high_null) > 0:
    print(f"WARNING: Columns >50% null still in data:\n{high_null}")

# 3. Duplicate rows on key columns
key_cols = [...]  # from PLAN.md
dupes = df.duplicated(subset=key_cols, keep=False)
if dupes.sum() > 0:
    print(f"WARNING: {dupes.sum()} duplicate rows on {key_cols}")
    print(df[dupes].head())

# 4. Row count traceability
# Compare: raw input rows → after cleaning → after joins → final
# Each step should be documented in LEARNINGS.md
print(f"Final row count: {len(df)}")
# Verify this matches the chain documented in LEARNINGS.md

# 5. Cardinality check on categorical columns
for col in df.select_dtypes(include='object').columns:
    n_unique = df[col].nunique()
    if n_unique > 0.9 * len(df):
        print(f"WARNING: {col} has near-unique cardinality ({n_unique}/{len(df)}) — likely an ID, not a category")
    if n_unique == len(df):
        print(f"INFO: {col} is fully unique — confirm this is a key, not a category used in groupby")
```

**If ANY check produces a WARNING, this is a high-confidence issue (>=80). Report it.**

### Methodology Appropriateness
- [ ] Verify statistical methods appropriate for data type
- [ ] Check assumptions documented and verified (normality, independence, etc.)
- [ ] Confirm sample sizes adequate for conclusions
- [ ] Check multiple comparisons addressed if applicable
- [ ] Verify causality claims justified (or appropriately limited)

### Reproducibility
- [ ] Verify random seeds set where needed
- [ ] Check package versions documented
- [ ] Verify data source/version documented
- [ ] Confirm all transformations traceable
- [ ] Verify results can be regenerated

### Output Quality
- [ ] Verify visualizations labeled (title, axes, legend)
- [ ] Check numbers formatted appropriately (sig figs, units)
- [ ] Verify conclusions supported by evidence shown
- [ ] Confirm limitations acknowledged

## Confidence Scoring

Rate each potential issue from 0-100:

| Score | Meaning |
|-------|---------|
| 0 | False positive or style preference |
| 25 | Might be real, methodology is unusual but valid |
| 50 | Real issue but minor impact on conclusions |
| 75 | Verified issue, impacts result interpretation |
| 100 | Certain error that invalidates conclusions |

**CRITICAL: You MUST only report issues with confidence >= 80. If you report below this threshold, you're misrepresenting your certainty.**

## Common DS Issues to Check

### Data Leakage
- Training data contains information from future
- Test data used in feature engineering
- Target variable used directly or indirectly in features

### Selection Bias
- Filtering introduced systematic bias
- Survivorship bias in longitudinal data (analyzing only surviving entities — e.g., only companies that didn't delist)
- Non-random sampling not addressed

### Join Explosion
- Many-to-many joins silently multiplying rows
- Detection: compare `COUNT(*)` before and after join — any increase signals duplication
```sql
SELECT 'before' AS stage, COUNT(*) FROM a
UNION ALL
SELECT 'after', COUNT(*) FROM a JOIN b ON a.key = b.key;
```
- Always check join key uniqueness: `SELECT key, COUNT(*) FROM b GROUP BY key HAVING COUNT(*) > 1`

### Incomplete Period Comparison
- Comparing a partial current period (e.g., this month so far) to a full prior period
- Metrics will always look lower for the incomplete period — normalize by days elapsed or filter to complete periods only

### Denominator Shifting
- Rate or ratio denominators change between periods, making rates incomparable
- Example: "conversion rate dropped" but actually the denominator (total visitors) grew while numerator stayed flat
- Always report both numerator and denominator, not just the ratio

### Average of Averages
- Averaging pre-computed group averages produces incorrect results when group sizes differ
- Must compute weighted average or aggregate from raw data
- Example: avg(store_avg_price) ≠ avg(price) across all items

### Timezone Mismatches
- Different data sources using different timezones (UTC vs local vs server time)
- Symptoms: off-by-one day counts, missing hours around DST transitions, events appearing at impossible times
- Always document timezone assumptions per source and convert to a single timezone early in the pipeline

### Simpson's Paradox
- Aggregate trend reverses when data is segmented by a confounding variable
- Example: treatment appears better overall but worse in every subgroup because of unequal group sizes
- When reporting aggregate results, always check if the trend holds within key segments

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

markdown-output-structure: Template for review results with confidence-scored issues

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

task-agent-spawn: Spawn Task agent for structured analysis review

Spawn a Task agent to review the analysis:

```
Task(subagent_type="general-purpose", prompt="""
Review analysis against .claude/SPEC.md.

Execute TWO-PASS review:

PASS 1 - Independent Data Quality Verification (RUN CODE):
1. Load the final analysis data
2. Check for empty/constant columns (nunique <= 1)
3. Check for high-null columns (>50% null)
4. Check for duplicate rows on key columns
5. Verify row count matches LEARNINGS.md chain
6. Check cardinality of categorical columns
Report any WARNING as confidence >= 80.

PASS 2 - Methodology and Compliance Review (READ CODE):
1. Spec compliance - verify all SPEC.md objectives addressed
2. Data quality handling - confirm issues from PLAN.md were resolved
3. Methodology - verify appropriate methods, assumptions checked
4. Reproducibility - confirm seeds, versions, documentation

Confidence score each issue (0-100).
Report only issues with >= 80 confidence.
Return structured output per /ds-review format.
""")
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Analyst said data was clean" | Their claim is not evidence. They may have skipped checks. | Run independent verification yourself |
| "I already read LEARNINGS.md, quality looks fine" | Reading a report is not verification | Execute the verification code patterns on actual data |
| "Running checks would take too long" | Your unverified approval costs days of rework downstream | Run the checks. They take seconds. |
| "The output-first protocol already caught issues" | Output-first catches per-step issues, not cumulative ones | Check final state independently |
| "No point re-checking, I trust the methodology" | Trust is not verification. Your job is adversarial review. | Verify, then trust |
| "Minor data issues won't affect conclusions" | You don't know that without checking the magnitude | Quantify the impact, then decide |

## Quality Standards

- **You must NOT report methodology preferences not backed by statistical principles.** Your opinion about how code should be written is not a review issue.
- **You must treat alternative valid approaches as non-issues (confidence = 0).** If the approach works correctly, don't report it.
- Ensure each reported issue is immediately actionable
- **If you're unsure, rate it below 80 confidence.** Uncertainty is not a reason to report—it's a reason to investigate more.
- Focus on what affects conclusions, not style. **STOP if you catch yourself criticizing coding style—that's not your role here.**

## Phase Complete

phase-transition: Invoke ds-verify after APPROVED review

After review is APPROVED, immediately invoke:

ds-verify: Verify analysis reproducibility and user acceptance

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-verify/SKILL.md")
```

If CHANGES REQUIRED, return to `/ds-implement` to fix issues first.

**Maximum 3 review cycles.** If issues persist after 3 rounds of review → implement → re-review, escalate to the user with a summary of unresolved issues. Do not loop indefinitely.
