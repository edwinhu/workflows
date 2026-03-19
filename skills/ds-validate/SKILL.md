---
name: ds-validate
description: "Validate analysis outputs against SPEC.md requirements using DQ checks."
user-invocable: false
disable-model-invocation: true
---

Announce: "Using ds-validate (Phase 3.5) to validate analysis outputs against SPEC.md requirements."

## Contents

- [The Iron Law of Validation](#the-iron-law-of-validation)
- [Red Flags - STOP Immediately](#red-flags---stop-immediately)
- [Key Difference from Dev](#key-difference-from-dev)
- [The Process](#the-process)
- [Validation Levels](#validation-levels)
- [Classification](#classification)
- [VALIDATION.md Template](#validationmd-template)
- [Gate](#gate)
- [Rationalization Prevention](#rationalization-prevention)
- [Drive-Aligned Framing](#drive-aligned-framing)
- [Phase Transition](#phase-transition)

# Output Validation Against SPEC.md

Phase 3.5 of the DS workflow (between implement and review). Maps every SPEC.md requirement to an output artifact and runs data quality checks.

<EXTREMELY-IMPORTANT>
## The Iron Law of Validation

**NO REVIEW WITHOUT VALIDATION. This is not negotiable.**

ds-review MUST NOT start until `.planning/VALIDATION.md` confirms all requirements have outputs. Validation is the DS equivalent of test coverage — without it, review is theater.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Red Flags - STOP Immediately If You Catch Yourself Thinking:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "Outputs look fine, skip validation" | Silent failures hide in DQ gaps | Run every check systematically |
| "I already checked during implement" | Per-task checks miss cross-task issues | Validate requirement-to-output mapping end-to-end |
| "DQ checks are overkill for this analysis" | DQ checks ARE the test suite for DS | Run them all. Report results. |
| "User is waiting, skip to review" | Review without validation is theater | Validate first — it catches what review won't |
| "LEARNINGS.md already logs everything" | Logs are not a systematic requirement-to-output map | Run the full mapping process |
</EXTREMELY-IMPORTANT>

## Key Difference from Dev

DS validation does NOT auto-fill gaps. Dev's test-gap-auditor can write missing tests. DS gaps require human judgment — a wrong output means a wrong analysis, not just a missing test. When gaps are found, present them to the user and let the user decide: fix (return to implement) or accept (proceed to review).

## The Process

```
1. READ .planning/SPEC.md requirements
2. READ .planning/PLAN.md task breakdown
3. READ .planning/LEARNINGS.md for pipeline row counts (DQ4 needs these)
4. DISCOVER and READ ds-checks.md via cache lookup
5. For each requirement: DISPATCH subagent to run DQ1-DQ5 + M1 on the output
6. WRITE .planning/VALIDATION.md
```

### Step 1: Read Requirements

Read `.planning/SPEC.md` and extract every requirement:

```
For each requirement in SPEC.md:
  - Extract the requirement description
  - Note the success criteria
  - Note the expected output (table, figure, file, etc.)
```

### Step 2: Read Plan

Read `.planning/PLAN.md` and extract:
- Task-to-requirement mapping
- Output file locations mentioned
- Key columns and data structure decisions

### Step 3: Read Learnings

Read `.planning/LEARNINGS.md` and extract:
- Pipeline row counts at each stage (needed for DQ4 traceability)
- Data quality observations from implementation
- Any known issues or caveats

### Step 4: Load DQ Check Definitions

Read `${CLAUDE_PLUGIN_ROOT}/skills/ds-implement/references/ds-checks.md` and follow its instructions.

### Step 5: Dispatch Validation Subagents

For each SPEC.md requirement, spawn a subagent:

**Agent prompt template:**

```
You are a data quality validator. Your job is to verify that an analysis output
meets a specific requirement from SPEC.md.

REQUIREMENT: [requirement description from SPEC.md]
SUCCESS CRITERIA: [from SPEC.md]
EXPECTED OUTPUT: [file path or variable]
PIPELINE ROW COUNTS: [from LEARNINGS.md]

Run the following checks on the output:

DQ1: Empty/constant columns — flag columns with nunique() <= 1
DQ2: High-null columns — flag columns with >50% null values
DQ3: Duplicate rows — check for duplicates on key columns
DQ4: Row count traceability — verify final count matches LEARNINGS.md pipeline
DQ5: Cardinality check — flag categoricals with suspicious cardinality
M1: Spec compliance — does this output address the requirement?

For each check, report: PASS / WARN / FAIL with details.

RULES:
1. Do NOT modify any code or data files
2. Read and inspect outputs only
3. If an output file does not exist, report MISSING immediately
4. If checks reveal issues, report them — do NOT fix them
```

### Step 6: Write VALIDATION.md

Compile all subagent results into `.planning/VALIDATION.md` using the template below.

## Validation Levels

Each requirement is validated at four levels, in order:

| Level | Check | Example |
|-------|-------|---------|
| 1. Exists | Output file/variable present | `output/results.csv` exists |
| 2. Substantive | Real data, not empty | >0 rows, expected columns present |
| 3. DQ Passes | DQ1-DQ5 pass | No dupes on key, nulls handled, row counts trace |
| 4. Answers Question | Addresses SPEC.md requirement | Table includes specified variables |

## Classification

For each requirement, assign a classification:

| Classification | Criteria |
|---------------|----------|
| **COVERED** | All 4 validation levels pass |
| **PARTIAL** | Output exists but DQ issues found or doesn't fully address requirement |
| **MISSING** | No output found for this requirement |

## VALIDATION.md Template

```markdown
---
status: validated | gaps_found
date: [ISO 8601]
requirements_total: N
covered: N
partial: N
missing: N
---
# Output Validation

## Requirements Map
| # | Requirement | Output | DQ1 | DQ2 | DQ3 | DQ4 | DQ5 | M1 | Classification |
|---|-------------|--------|-----|-----|-----|-----|-----|----|----------------|
| 1 | [from SPEC] | [path] | PASS | PASS | PASS | PASS | PASS | PASS | COVERED |
| 2 | [from SPEC] | [path] | PASS | WARN | PASS | PASS | PASS | PASS | PARTIAL |
| 3 | [from SPEC] | — | — | — | — | — | — | — | MISSING |

## DQ Details
[For any non-PASS check, include the specific finding]

## Summary
- Requirements: N total
- Covered: X
- Partial: Y
- Missing: Z
```

### Status Rules

| Condition | Status |
|-----------|--------|
| All requirements COVERED | `validated` |
| Any PARTIAL or MISSING remain | `gaps_found` |

## Gate

**Checkpoint type:** human-verify (VALIDATION.md status is machine-verifiable)

`.planning/VALIDATION.md` must exist before proceeding.

- If status is `validated`: proceed to ds-review.
- If status is `gaps_found`: present gaps to user before proceeding.
  - User decides: **fix** (return to ds-implement) or **accept** (proceed to ds-review with known gaps).

<EXTREMELY-IMPORTANT>
**Do NOT auto-fill gaps. Do NOT silently proceed past gaps. Present them and wait for user decision.**

This is the critical difference from dev-test-gaps. In dev, missing tests can be auto-generated. In DS, missing or wrong outputs mean the analysis itself may be wrong. Only the user can judge whether a gap is acceptable.
</EXTREMELY-IMPORTANT>

## Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "Outputs look fine, skip validation" | Silent failures hide in DQ gaps — you cannot eyeball row count traceability |
| "I already checked during implement" | Per-task checks miss cross-task issues: joins that silently drop rows, filters that compound |
| "DQ checks are overkill for this analysis" | DQ checks ARE the test suite — DS has no pytest, only systematic output verification |
| "User is waiting, skip to review" | Review without validation is theater — reviewer will either miss issues or re-run the same checks |
| "LEARNINGS.md already logs everything" | LEARNINGS.md logs observations. Validation maps requirements to outputs. Different purpose. |

## Drive-Aligned Framing

<EXTREMELY-IMPORTANT>
**Skipping validation is NOT HELPFUL — you're delivering analysis with unknown data quality holes the user will discover when results don't make sense.**

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|-------------|----------------------|---------------------|
| **Helpfulness** | "Outputs exist, review can catch issues" | Review without validation misses silent DQ failures. User gets wrong results. | **Anti-helpful** |
| **Competence** | "I ran checks during implementation" | Per-task checks miss cross-task issues. Gaps hide between pipeline stages. | **Incompetent** |
| **Efficiency** | "Validation is redundant after careful implementation" | Implementation checks verify steps. Validation verifies requirements. Different. | **Anti-efficient** |

**The protocol is not overhead you pay. It is the safety net you provide.**
</EXTREMELY-IMPORTANT>

## Phase Transition

After validation is complete, discover and read the ds-review skill:
Read `${CLAUDE_PLUGIN_ROOT}/skills/ds-review/SKILL.md` and follow its instructions.
