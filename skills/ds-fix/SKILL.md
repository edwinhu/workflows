---
name: ds-fix
version: 1.0
description: "This skill should be used when the user asks to 'fix analysis', 'wrong results', 'notebook error', 'reviewer feedback', 'data changed', 'debug notebook', or needs mid-analysis course-correction for wrong results, notebook errors, or data changes."
---

**Announce:** "Using ds-fix for mid-analysis course correction."

## Where This Fits

```
/ds (entry) → brainstorm → plan → implement → review → verify
                                    ↑
/ds-fix (midpoint) ─────────────────┘
```

This is the re-entry point. Jump back into a DS workflow that needs fixing.

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Editing

**DIAGNOSE BEFORE FIXING. This is not negotiable.**

Before changing ANY analysis code, you MUST:
1. Load the workflow context
2. Identify WHAT is wrong (specific, not vague)
3. Identify WHY it's wrong (root cause)
4. Only THEN fix it (with output-first verification)

**If you're about to change code without diagnosing first, STOP.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "I'll just re-run everything" | Brute force hides root cause | Trace to the specific failing step |
| "The data probably changed" | Your guess isn't a diagnosis | Compare data profiles before/after |
| "Let me tweak the parameters" | Tweaking without understanding is p-hacking | Understand WHY parameters are wrong first |
| "I'll fix it and check later" | You're skipping output-first | Fix AND verify in the same step |

## Step 1: Load Context

Read workflow state:

```
Read(".claude/SPEC.md")
Read(".claude/PLAN.md")
Read(".claude/LEARNINGS.md")
```

If no workflow state exists, suggest starting with `/ds` instead.

## Step 2: Diagnose

Identify the issue category:

| Category | Symptoms | Route To |
|----------|----------|----------|
| **Runtime Error** | Traceback, cell failure, import error | Debug Protocol |
| **Wrong Results** | Numbers don't match expectations, sanity checks fail | Re-analysis Protocol |
| **Unclear Root Cause** | 3+ plausible explanations, mysterious data quality issues | Competing Hypothesis Investigation |
| **Reviewer Feedback** | Specific methodology concerns, requested changes | Revision Protocol |
| **Data Change** | New data available, source updated, schema changed | Re-profiling Protocol |
| **Scope Change** | New questions, expanded requirements | Spec Update → re-plan |

Ask user if ambiguous:

```
AskUserQuestion(questions=[
  {
    "question": "What needs fixing in your analysis?",
    "header": "Issue type",
    "options": [
      {"label": "Runtime error", "description": "Code fails, traceback, import error"},
      {"label": "Wrong results", "description": "Numbers don't look right, sanity checks fail"},
      {"label": "Unclear root cause", "description": "Multiple plausible explanations, mysterious data quality"},
      {"label": "Reviewer feedback", "description": "Specific changes requested by reviewer"},
      {"label": "Data/scope change", "description": "New data, updated requirements, new questions"}
    ],
    "multiSelect": false
  }
])
```

## Step 3: Fix by Category

### Runtime Error → Debug Protocol

1. Identify the failing cell/script
2. Read the error traceback
3. Check LEARNINGS.md for prior context on this step
4. Fix with output-first verification:
   - Print state BEFORE the failing operation
   - Fix the operation
   - Print state AFTER
   - Verify output matches expectations from PLAN.md

For notebook-specific errors, load notebook-debug patterns:

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/notebook-debug/SKILL.md")
```

### Wrong Results → Re-analysis Protocol

<EXTREMELY-IMPORTANT>
**Trace backwards. Do NOT guess forward.**

The bug is at the FIRST step where output diverges from expected. Find that step.
</EXTREMELY-IMPORTANT>

1. Identify WHICH results are wrong
2. Trace backwards through the pipeline:
   - Check final output → is the aggregation wrong?
   - Check intermediate data → is the transformation wrong?
   - Check input data → is the loading/filtering wrong?
3. Find the FIRST step where output diverges from expected
4. Fix that step with output-first verification
5. Re-run downstream steps and verify

### Reviewer Feedback → Revision Protocol

1. Document each piece of feedback as a task
2. For each task:
   - Locate the relevant code/output
   - Apply the change
   - Verify with output-first protocol
   - Document in LEARNINGS.md
3. After all changes, re-run review checks:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-review/SKILL.md")
```

### Data/Scope Change → Re-profiling Protocol

1. Profile the new data (shape, dtypes, distributions)
2. Compare to original data profile in LEARNINGS.md
3. Identify what changed (schema, volume, distributions)
4. Update PLAN.md if pipeline steps need changing
5. Re-run affected pipeline steps with output-first verification
6. Update LEARNINGS.md with new observations

### Scope Change → Spec Update

If the question itself changed:

1. Update SPEC.md with new objectives
2. Review PLAN.md — which tasks are still valid?
3. Add new tasks for new objectives
4. Return to implement phase for new tasks


Route to competing hypothesis mode when:

| Condition | Example |
|-----------|---------|
| **3+ plausible explanations** | Regression coefficients have wrong sign → could be data error, methodology error, implementation bug, or real confounding |
| **Sequential investigation failed** | Traced backwards, but multiple divergence points found |
| **Mysterious data quality issues** | Unexpected nulls appear, but unclear if measurement error, join issue, or upstream data change |
| **Contradictory evidence** | Some checks pass, others fail with no obvious pattern |

**Ask user if diagnostic is ambiguous:**

```
AskUserQuestion(questions=[
  {
    "question": "Multiple plausible root causes found. Use competing hypothesis investigation?",
    "header": "Investigation mode",
    "options": [
      {"label": "Yes - parallel investigation", "description": "Spawn teammates to investigate each hypothesis"},
      {"label": "No - sequential trace", "description": "I'll trace backwards myself"}
    ],
    "multiSelect": false
  }
])
```

<EXTREMELY-IMPORTANT>
### The Iron Law of Hypothesis Investigation

**NO SPECULATION WITHOUT EVIDENCE. This is not negotiable.**

Before claiming a hypothesis is supported or refuted, you MUST:
1. Identify what evidence would prove/disprove it
2. Collect that evidence (run code, check data, verify outputs)
3. Report evidence with file:line references
4. Quantify confidence (0-100, only report ≥80)

**If you're about to say "Hypothesis X is likely because..." without showing evidence, STOP.**
</EXTREMELY-IMPORTANT>

### Step 1: Generate Hypotheses

Generate 3-5 competing hypotheses following this taxonomy:

| Hypothesis Type | What to Check | Example |
|-----------------|---------------|---------|
| **Data Quality** | Measurement error, collection issue, source data changed | Nulls introduced by upstream ETL change |
| **Methodology** | Wrong statistical approach, violated assumptions, inappropriate method | Used OLS on non-linear relationship |
| **Implementation** | Code bug, wrong function, silent failure | Merge introduced duplicates via 1:many join |
| **Domain/Real** | Real phenomenon, not an error | Confounding variable creating spurious correlation |

**Required for each hypothesis:**
- What evidence would **prove** it
- What evidence would **disprove** it
- Where to look for that evidence (files, data, outputs)

**Example:**
```
Hypothesis A (Data Quality): Dependent variable has measurement error
  - PROVE: Compare raw data to cleaned data, check for suspicious outliers
  - DISPROVE: Data distribution matches expectations, no anomalies
  - WHERE: data/raw/outcomes.csv vs data/processed/outcomes.csv

Hypothesis B (Implementation): Wrong join introduced duplicates
  - PROVE: Row count increased after join, multiple matches per key
  - DISPROVE: Row count preserved, 1:1 key mapping
  - WHERE: notebooks/02-merge.ipynb, check shape before/after join
```

### Step 2: Spawn Investigation Team

**Pattern:** One Task agent per hypothesis (3-5 agents total)

Use `TeamCreate` with these teammate specs:

```python
TeamCreate(teammates=[
  {
    "name": "hypothesis-A-investigator",
    "subagent_type": "general-purpose",
    "plan_mode_required": False
  },
  {
    "name": "hypothesis-B-investigator",
    "subagent_type": "general-purpose",
    "plan_mode_required": False
  },
  # ... one per hypothesis
])
```

**After team created:** Dispatch investigation prompts to each teammate.

### Step 3: Investigation Prompts

**Template for each investigator (fill in brackets):**

```
SendMessage(type="message", recipient="hypothesis-[X]-investigator", summary="Investigate [HYPOTHESIS TYPE]", content="""
# HYPOTHESIS INVESTIGATION

You are investigating ONE hypothesis for root cause of: [PROBLEM STATEMENT]

## Your Assigned Hypothesis

**Hypothesis [X]** ([TYPE]): [HYPOTHESIS STATEMENT]

## Your Mission

Collect EVIDENCE that proves or disproves this hypothesis. You are looking for facts, not speculation.

<EXTREMELY-IMPORTANT>
## The Iron Law of Evidence

**CLAIMING WITHOUT VERIFICATION IS LYING.**

You MUST NOT:
- Say "likely" or "probably" without data
- Report findings without file:line references
- Claim something is true because "it makes sense"
- Skip verification outputs

You MUST:
- Run code to check your hypothesis
- Print outputs that show evidence
- Report null results (if evidence doesn't support hypothesis)
- Quantify confidence (0-100, only report ≥80)
</EXTREMELY-IMPORTANT>

## Evidence Required

To PROVE this hypothesis, you need:
[LIST SPECIFIC EVIDENCE NEEDED]

To DISPROVE this hypothesis, you need:
[LIST SPECIFIC COUNTER-EVIDENCE]

## Where to Look

Check these locations:
- [FILE/DATA/SCRIPT REFERENCES]

## Output-First Protocol

For EVERY check:
1. State what you're checking
2. Run the code/query
3. Show the output
4. Interpret: does this support or refute the hypothesis?

Example:
```python
# Checking: Did join introduce duplicates?
print(f"Before join: {df.shape}")
print(f"After join: {merged.shape}")
print(f"Keys with multiple matches: {merged.groupby('key').size().gt(1).sum()}")
# Interpretation: 5,000 keys have 2+ matches → SUPPORTS duplicate hypothesis
```

## Challenge Other Hypotheses

After investigating your hypothesis, review other teammates' findings. If you see weak evidence or flawed reasoning:
- Point it out with specific file:line references
- Provide counter-evidence if you have it
- Rate confidence in your critique (0-100)

## Reporting Template

Report your findings as:

**HYPOTHESIS [X] STATUS:** [SUPPORTED / REFUTED / INCONCLUSIVE]

**EVIDENCE:**
- [Evidence item 1 with file:line reference]
- [Evidence item 2 with output/numbers]
- [Evidence item 3 with verification]

**CONFIDENCE:** [0-100, only report if ≥80]

**CRITIQUES OF OTHER HYPOTHESES:**
- Hypothesis [Y]: [Your critique with evidence]
- Hypothesis [Z]: [Your critique with evidence]

If your hypothesis is REFUTED, that's success - you eliminated a possibility. Report null results honestly.
""")
```

### Step 4: Scientific Debate Protocol

**As teammates report findings:**

1. **Collect Evidence** - Each teammate investigates their hypothesis
2. **Cross-Examine** - Teammates challenge each other's evidence
3. **Confidence Scoring** - Rate evidence strength (0-100, only ≥80 credible)
4. **Update Beliefs** - Hypotheses with weak evidence are eliminated

**Debate Rules:**
- Attack evidence, not teammates
- Provide counter-evidence, not just skepticism
- Admit when evidence refutes your hypothesis
- Update confidence scores based on new information

**Lead's Role:**
- Monitor all teammate messages
- Synthesize findings: which hypothesis has strongest evidence?
- Ask for additional checks if evidence is ambiguous
- Call debate complete when one hypothesis ≥90 confidence

### Step 5: Evidence Synthesis

**After debate converges, lead synthesizes:**

| Hypothesis | Evidence Summary | Confidence | Status |
|------------|------------------|------------|--------|
| A (Data Quality) | [Summary with file:line refs] | 45 | REFUTED |
| B (Methodology) | [Summary with file:line refs] | 30 | WEAK |
| C (Implementation) | [Summary with file:line refs] | 95 | **IDENTIFIED** |
| D (Domain) | [Summary with file:line refs] | 60 | INCONCLUSIVE |

**Decision Rule:**
- If one hypothesis ≥90 confidence → proceed to fix
- If multiple hypotheses ≥80 → investigate distinguishing evidence
- If all hypotheses <80 → report to user, may need domain expert

### Step 6: Fix Implementation

Once root cause identified:

1. **Document in LEARNINGS.md:**
```markdown
## Root Cause Investigation - [DATE]

**Problem:** [ORIGINAL ISSUE]

**Hypotheses Investigated:**
- Hypothesis A (Data Quality): REFUTED (confidence: 45)
- Hypothesis B (Methodology): WEAK (confidence: 30)
- Hypothesis C (Implementation): **IDENTIFIED** (confidence: 95)
- Hypothesis D (Domain): INCONCLUSIVE (confidence: 60)

**Root Cause:** [HYPOTHESIS C DETAILS]

**Evidence:**
- [Key evidence with file:line]
- [Verification output]

**Fix Required:** [WHAT NEEDS TO CHANGE]
```

2. **Route to ds-delegate for fix:**
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-delegate/SKILL.md")

Task(subagent_type="workflows:ds-analyst", prompt="""
Fix identified root cause: [HYPOTHESIS C]

## Root Cause
[PASTE FROM LEARNINGS.md]

## Fix Protocol
1. Apply fix at [FILE:LINE]
2. Output-first verification:
   - Print state BEFORE fix
   - Apply change
   - Print state AFTER fix
   - Verify output matches expected
3. Re-run downstream analysis steps
4. Update LEARNINGS.md with fix verification

[REST OF STANDARD DELEGATION TEMPLATE]
""")
```

### Rationalization Prevention

| Thought | Reality | Do Instead |
|---------|---------|------------|
| "Hypothesis X is obviously wrong" | Your intuition isn't evidence | Investigate it anyway with verification |
| "I don't need to check that" | Unchecked assumptions cause silent failures | Check it with output-first protocol |
| "The teammate probably verified" | You're trusting without checking | Read their code, verify their outputs yourself |
| "80% confidence is good enough" | You need ≥90 to proceed with a fix | Collect more evidence or report ambiguity |
| "Let me just fix it and see" | You're guessing, not diagnosing | Complete investigation first |

### Example Flow

**Problem:** Regression coefficients have wrong sign (price coefficient is positive, expected negative)

**Step 1: Generate Hypotheses**
- Hypothesis A (Data): Price variable has inverted values (high = low)
- Hypothesis B (Methodology): Omitted variable bias (missing confounder)
- Hypothesis C (Implementation): Wrong merge created duplicate rows
- Hypothesis D (Domain): Real phenomenon (Giffen good behavior)

**Step 2: Spawn Team**
```
TeamCreate 4 investigators
```

**Step 3: Dispatch Investigations**
- Investigator A → Check price distribution, compare to source data
- Investigator B → Check for confounders, validate model assumptions
- Investigator C → Check merge logic, verify row counts
- Investigator D → Check economic literature, validate with domain expert

**Step 4: Debate**
```
Investigator A: "Price distribution looks normal, matches source. REFUTED (confidence: 90)"

Investigator B: "Checked VIF scores - no multicollinearity. But missing income variable. POSSIBLE (confidence: 70)"

Investigator C: "Found the issue! Merge on customer_id created 2.3x rows.
Before merge: 10,000 rows
After merge: 23,451 rows
Multiple transactions per customer matched to single demographic record.
IDENTIFIED (confidence: 95)"

Investigator D: "Price elasticity literature shows negative relationship in this market. C's finding explains it. SUPPORTS C (confidence: 85)"
```

**Step 5: Synthesize**
Root cause: Hypothesis C (Implementation bug) - confidence 95%
Supporting evidence from D

**Step 6: Fix**
```
Document in LEARNINGS.md
Route to ds-delegate: "Fix merge to preserve 1:1 mapping, add merge validation"
```

---

**Integration Note:** This section should be inserted in ds-fix.SKILL.md after the existing "Step 3: Fix by Category" sections and before "Step 4: Verify Fix". It provides an alternative investigation path when the standard backward-tracing diagnostic reveals multiple plausible root causes.

## Step 4: Verify Fix

After fixing, apply output-first verification:

1. Re-run the fixed step: verify output shape, sample, stats
2. Re-run downstream steps: verify no cascading issues
3. Check against SPEC.md success criteria
4. Update LEARNINGS.md with fix documentation

## Delegation

Main chat orchestrates. Task agents do the fixing:

```
Task(subagent_type="general-purpose", prompt="""
Fix [SPECIFIC ISSUE] in the analysis.

Context:
- Read .claude/LEARNINGS.md for prior steps
- Read .claude/PLAN.md for task details
- Read .claude/SPEC.md for objectives

Fix Protocol:
1. Trace to root cause (do NOT guess)
2. Fix with output-first verification
3. Print state BEFORE and AFTER fix
4. Re-run downstream steps
5. Update LEARNINGS.md

Report: what was wrong, what was fixed, verification output.
""")
```

## When Fix Requires Rethinking

If the fix reveals the analysis approach is fundamentally wrong:

1. Document findings in LEARNINGS.md
2. Report to user: "The approach needs rethinking because [specific reason]"
3. Suggest returning to `/ds` for re-planning

Don't try to salvage a broken approach with patches. A fresh plan costs less than cascading fixes.
