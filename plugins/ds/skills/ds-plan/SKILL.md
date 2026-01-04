---
name: ds-plan
description: This skill should be used when the user asks to "profile the data", "explore the dataset", "plan the analysis", or as Phase 2 of the /ds workflow after brainstorming. Profiles data and creates analysis task breakdown.
---

## Contents

- [The Iron Law of DS Planning](#the-iron-law-of-ds-planning)
- [What Plan Does](#what-plan-does)
- [Process](#process)
- [Red Flags - STOP If You're About To](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Planning (Data Profiling + Task Breakdown)

Profile the data and create an analysis plan based on the spec.
**Requires `.claude/SPEC.md` from /ds-brainstorm first.**

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Planning

**SPEC MUST EXIST BEFORE PLANNING. This is not negotiable.**

Before exploring data or creating tasks, you MUST have:
1. `.claude/SPEC.md` with objectives and constraints
2. Clear success criteria
3. User-approved spec

**If `.claude/SPEC.md` doesn't exist, run /ds-brainstorm first.**
</EXTREMELY-IMPORTANT>

## What Plan Does

| DO | DON'T |
|-------|----------|
| Read .claude/SPEC.md | Skip brainstorm phase |
| Profile data (shape, types, stats) | Skip to analysis |
| Identify data quality issues | Ignore missing/duplicate data |
| Create ordered task list | Write final analysis code |
| Write .claude/PLAN.md | Make completion claims |

**Brainstorm answers: WHAT and WHY**
**Plan answers: HOW and DATA QUALITY**

## Process

### 1. Verify Spec Exists

```bash
cat .claude/SPEC.md
```

If missing, stop and run `/ds-brainstorm` first.

### 2. Data Profiling

**MANDATORY profiling steps for each data source:**

```python
import pandas as pd

# Basic structure
df.shape                    # (rows, columns)
df.dtypes                   # Column types
df.head(10)                 # Sample data
df.tail(5)                  # End of data

# Summary statistics
df.describe()               # Numeric summaries
df.describe(include='object')  # Categorical summaries
df.info()                   # Memory, non-null counts

# Data quality checks
df.isnull().sum()           # Missing values per column
df.duplicated().sum()       # Duplicate rows
df[col].value_counts()      # Distribution of categories

# For time series
df[date_col].min(), df[date_col].max()  # Date range
df.groupby(date_col).size()              # Records per period
```

### 3. Identify Data Quality Issues

**CRITICAL:** Document ALL issues before proceeding:

| Check | What to Look For |
|-------|------------------|
| Missing values | Null counts, patterns of missingness |
| Duplicates | Exact duplicates, key-based duplicates |
| Outliers | Extreme values, impossible values |
| Type issues | Strings in numeric columns, date parsing |
| Cardinality | Unexpected unique values |
| Distribution | Skewness, unexpected patterns |

### 4. Create Task Breakdown

Break analysis into ordered tasks:
- Each task should produce **visible output**
- Order by data dependencies
- Include data cleaning tasks FIRST

### 5. Write Plan Doc

Write to `.claude/PLAN.md`:

```markdown
# Analysis Plan: [Analysis Name]

## Spec Reference
See: .claude/SPEC.md

## Data Profile

### Source 1: [name]
- Location: [path/connection]
- Shape: [rows] x [columns]
- Date range: [start] to [end]
- Key columns: [list]

#### Column Summary
| Column | Type | Non-null | Unique | Notes |
|--------|------|----------|--------|-------|
| col1 | int64 | 100% | 50 | Primary key |
| col2 | object | 95% | 10 | Category |

#### Data Quality Issues
- [ ] Missing: col2 has 5% nulls - [strategy: drop/impute/flag]
- [ ] Duplicates: 100 duplicate rows on [key] - [strategy]
- [ ] Outliers: col3 has values > 1000 - [strategy]

### Source 2: [name]
[Same structure]

## Task Breakdown

### Task 1: Data Cleaning (required first)
- Handle missing values in col2
- Remove duplicates
- Fix data types
- Output: Clean DataFrame, log of rows removed

### Task 2: [Analysis Step]
- Input: Clean DataFrame
- Process: [description]
- Output: [specific output to verify]
- Dependencies: Task 1

### Task 3: [Next Step]
[Same structure]

## Output Verification Plan
For each task, define what output proves completion:
- Task 1: "X rows cleaned, Y rows dropped"
- Task 2: "Visualization showing [pattern]"
- Task 3: "Model accuracy >= 0.8"

## Reproducibility Requirements
- Random seed: [value if needed]
- Package versions: [key packages]
- Data snapshot: [date/version]
```

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Skip data profiling | Data issues will break analysis | Always profile first |
| Ignore missing values | Will corrupt results | Document and plan handling |
| Start analysis immediately | Haven't characterized data | Complete profiling |
| Assume data is clean | Never assume, always verify | Run quality checks |

## Output

Plan complete when:
- `.claude/SPEC.md` was read and understood
- All data sources profiled (shape, types, stats)
- Data quality issues documented
- Cleaning strategy defined for each issue
- Tasks ordered by dependency
- Output verification criteria defined
- `.claude/PLAN.md` written
- User confirms ready for implementation

**Next step:** `/ds-implement` for output-first implementation
