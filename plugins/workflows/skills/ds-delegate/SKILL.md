---
name: ds-delegate
description: "Subagent delegation for data analysis. Dispatches fresh Task agents with output-first verification."
---

**Announce:** "I'm using ds-delegate to dispatch analysis subagents."

## Core Principle

**Fresh subagent per task + output-first verification = reliable analysis**

- Analyst subagent does the work
- Must produce visible output at each step
- Methodology reviewer checks approach
- Loop until output verified

## When to Use

Called by `ds-implement` for each task in PLAN.md. Don't invoke directly.

## The Process

```
For each task:
    1. Dispatch analyst subagent
       - If questions → answer, re-dispatch
       - Implements with output-first protocol
    2. Verify outputs are present and reasonable
    3. Dispatch methodology reviewer (if complex)
    4. Mark task complete, log to LEARNINGS.md
```

## Step 1: Dispatch Analyst

Use this Task invocation (fill in brackets):

```
Task(subagent_type="general-purpose", prompt="""
You are implementing: [TASK NAME]

## Task Description
[PASTE FULL TASK TEXT FROM PLAN.md]

## Context
- Analysis objective: [from SPEC.md]
- Data sources: [list with paths]
- Previous steps: [summary from LEARNINGS.md]

## Output-First Protocol (MANDATORY)
For EVERY operation:
1. Print state BEFORE (shape, head)
2. Execute operation
3. Print state AFTER (shape, nulls, sample)
4. Verify output is reasonable

Example:
```python
print(f"Before: {df.shape}")
df = df.merge(other, on='key')
print(f"After: {df.shape}")
print(f"Nulls introduced: {df.isnull().sum().sum()}")
df.head()
```

## Required Outputs by Operation
| Operation | Required Output |
|-----------|-----------------|
| Load data | shape, dtypes, head() |
| Filter | shape before/after, % removed |
| Merge/Join | shape, null check, sample |
| Groupby | result shape, sample groups |
| Model fit | metrics, convergence |

## If Unclear
Ask questions BEFORE implementing. Don't guess on methodology.

## Output
Report: what you did, key outputs observed, any data quality issues found.
""")
```

**If analyst asks questions:** Answer clearly, especially about methodology choices.

**If analyst finishes:** Verify outputs, then proceed or review.

## Step 2: Verify Outputs

Before moving on, confirm:
- [ ] Output files/variables exist
- [ ] Shapes are reasonable (no unexpected row loss)
- [ ] No silent null introduction
- [ ] Sample output matches expectations

If verification fails, re-dispatch analyst with specific fix instructions.

## Step 3: Dispatch Methodology Reviewer (Complex Tasks)

For statistical analysis, modeling, or methodology-sensitive tasks:

```
Task(subagent_type="general-purpose", prompt="""
Review methodology for: [TASK NAME]

## What Was Done
[SUMMARY FROM ANALYST OUTPUT]

## Original Requirements
[FROM SPEC.md - especially any replication requirements]

## CRITICAL: Do Not Trust the Report

The analyst may have:
- Reported success without actually running the code
- Cherry-picked output that looks correct
- Glossed over data quality issues
- Made methodology choices without justification

**DO:**
- Read the actual code or notebook cells
- Verify outputs exist and match claims
- Check for silent failures (empty DataFrames, all nulls)
- Confirm statistical assumptions were checked

## Review Checklist
1. Is the statistical method appropriate for the data type?
2. Are assumptions documented and checked?
3. Is sample size adequate for conclusions?
4. Are there data leakage concerns?
5. Is the approach reproducible (seeds, versions)?

## Confidence Scoring
Rate each issue 0-100. Only report issues >= 80 confidence.

## Output Format
- APPROVED: Methodology sound (after verifying code/outputs yourself)
- ISSUES: List concerns with confidence scores and file:line references
""")
```

## Step 4: Log to LEARNINGS.md

After each task, append to `.claude/LEARNINGS.md`:

```markdown
## Task N: [Name] - COMPLETE

**Input:** [describe input state]

**Operation:** [what was done]

**Output:**
- Shape: [final shape]
- Key findings: [observations]

**Verification:**
- [how you confirmed it worked]

**Next:** [what comes next]
```

## Red Flags

**Never:**
- Skip output verification
- Chain operations without intermediate checks
- Proceed with unexpected nulls or row counts
- Skip methodology review for statistical tasks
- Assume merge/join worked without checking
- Let analyst skip output-first protocol
- Make analyst read PLAN.md (provide full text)

**If analyst produces no visible output:**
- Re-dispatch with explicit output requirements
- This is a hard failure, not optional

**If analyst fails task:**
- Dispatch fix subagent with specific instructions
- Don't fix manually in main chat (context pollution)

## Example Flow

```
Me: Implementing Task 1: Load and clean transaction data

[Dispatch analyst with full task text]

Analyst:
- Loaded transactions.csv: (50000, 12)
- Found 5% nulls in amount column
- "Should I drop or impute nulls?"

Me: "Impute with median, flag imputed rows"

[Re-dispatch with answer]

Analyst:
- Imputed 2,500 rows with median ($45.50)
- Added is_imputed flag column
- Final shape: (50000, 13)
- Sample output: [shows head with flag]

[Verify: shapes match, flag exists, no unexpected changes]

[Log to LEARNINGS.md]

[Mark Task 1 complete, move to Task 2]
```

## Integration

This skill is invoked by `ds-implement` during the output-first implementation phase.
After all tasks complete, `ds-implement` proceeds to `ds-review`.
