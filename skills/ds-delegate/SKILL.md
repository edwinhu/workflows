---
name: ds-delegate
description: "Subagent delegation for data analysis. Dispatches fresh Task agents with output-first verification."
---

**Announce:** "I'm using ds-delegate to dispatch analysis subagents."

## Contents

- [The Iron Law of Delegation](#the-iron-law-of-delegation)
- [Core Principle](#core-principle)
- [The Process](#the-process)
- [Honesty Requirement](#honesty-requirement)
- [Rationalization Prevention](#rationalization-prevention)

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**EVERY ANALYSIS STEP MUST GO THROUGH A TASK AGENT. This is not negotiable.**

Main chat MUST NOT:
- Write analysis code directly
- Run "quick" data checks
- Edit notebooks or scripts
- Make "just this one plot"

**If you're about to write analysis code in main chat, STOP. Spawn a Task agent instead.**
</EXTREMELY-IMPORTANT>

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

**Pattern:** Use structured delegation template from `common/templates/delegation-template.md`

Every delegation MUST include:
1. TASK - What to analyze
2. EXPECTED OUTCOME - Success criteria
3. REQUIRED SKILLS - Statistical/ML methods needed
4. REQUIRED TOOLS - Data access and analysis tools
5. MUST DO - Output-first verification
6. MUST NOT DO - Methodology violations
7. CONTEXT - Data sources and previous work
8. VERIFICATION - Output requirements

Use this Task invocation (fill in brackets):

```
Task(subagent_type="general-purpose", prompt="""
# TASK

Analyze: [TASK NAME]

## EXPECTED OUTCOME

You will have successfully completed this task when:
- [ ] [Specific analysis output 1]
- [ ] [Specific analysis output 2]
- [ ] Output-first verification at each step
- [ ] Results documented with evidence

## REQUIRED SKILLS

This task requires:
- [Statistical method]: [Why needed]
- [Programming language]: Data manipulation
- Output-first verification (mandatory)

## REQUIRED TOOLS

You will need:
- Read: Load datasets and existing code
- Write: Create analysis scripts/notebooks
- Bash: Run analysis and verify outputs

**Tools denied:** None (full analysis access)

## MUST DO

- [ ] Print state BEFORE each operation (shape, head)
- [ ] Print state AFTER each operation (nulls, sample)
- [ ] Verify outputs are reasonable at each step
- [ ] Document methodology decisions

## MUST NOT DO

- ❌ Skip verification outputs
- ❌ Proceed with questionable data without flagging
- ❌ Guess on methodology (ask if unclear)
- ❌ Claim completion without visible outputs

## CONTEXT

### Task Description
[PASTE FULL TASK TEXT FROM PLAN.md]

### Analysis Context
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

## Honesty Requirement

<EXTREMELY-IMPORTANT>
**Claiming "analysis done" without output verification is LYING.**

When you say "Step complete", you are asserting:
- A Task agent ran the analysis
- Output was visible and verified
- Methodology reviewer approved (for statistical tasks)

If ANY of these didn't happen, you are not "summarizing" - you are LYING about the state of the analysis.

**Dishonest claims corrupt research. Honest "investigating" maintains integrity.**
</EXTREMELY-IMPORTANT>

## Rationalization Prevention

These thoughts mean STOP—you're about to skip delegation:

| Thought | Reality |
|---------|---------|
| "I'll just check the shape quickly" | Shape checks need output-first protocol. Delegate. |
| "It's just a simple merge" | Merges fail silently. Delegate with verification. |
| "I already know this data" | Knowing ≠ verified. Delegate. |
| "The subagent will be slower" | Wrong results are slower than slow results. Delegate. |
| "Just this one plot" | One plot hides data issues. Delegate. |
| "User wants results fast" | User wants CORRECT results. Delegate. |
| "Skip methodology review, it's standard" | "Standard" assumptions often fail. Review. |
| "Output looked reasonable" | "Looked reasonable" ≠ verified. Check numbers. |

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
