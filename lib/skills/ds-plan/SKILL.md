---
name: ds-plan
version: 1.0
description: "REQUIRED Phase 2 of /ds workflow. Profiles data and creates analysis task breakdown."
---

Announce: "Using ds-plan (Phase 2) to profile data and create task breakdown."

## Contents

- [The Iron Law of DS Planning](#the-iron-law-of-ds-planning)
- [What Plan Does](#what-plan-does)
- [Process](#process)
- [Red Flags - STOP If You're About To](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Planning (Data Profiling + Task Breakdown)

Profile the data and create an analysis plan based on the spec.
**Requires `.claude/SPEC.md` from /ds first.**

<EXTREMELY-IMPORTANT>
## The Iron Law of DS Planning

**SPEC MUST EXIST BEFORE PLANNING. This is not negotiable.**

Before exploring data or creating tasks, you MUST have:
1. `.claude/SPEC.md` with objectives and constraints
2. Clear success criteria
3. User-approved spec

**If `.claude/SPEC.md` doesn't exist, run /ds first.**
</EXTREMELY-IMPORTANT>

### Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Data looks clean, profiling unnecessary" | Your data is never clean | PROFILE to discover issues |
| "I can profile as I go" | You'll miss systemic issues | PROFILE comprehensively NOW |
| "Quick .head() is enough" | Your head hides tail problems | RUN full profiling checklist |
| "Missing values won't affect my analysis" | They always do | DOCUMENT and plan handling |
| "I'll handle data issues during analysis" | Your issues will derail your analysis | FIX data issues FIRST |
| "User didn't mention data quality" | They assume YOU'LL check | QUALITY check is YOUR job |
| "Profiling takes too long" | Your skipping it costs days later | INVEST time now |

### Honesty Framing

**Creating an analysis plan without profiling the data is LYING about understanding the data.**

You cannot plan analysis steps without knowing:
- Your data's shape and types
- Your missing value patterns
- Your data quality issues
- Your cleaning requirements

Profiling costs you minutes. Your wrong plan costs hours of rework and incorrect results.

### No Pause After Completion

After writing `.claude/PLAN.md`, IMMEDIATELY invoke:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-implement/SKILL.md")
```

DO NOT:
- Ask "should I proceed with implementation?"
- Summarize the plan
- Wait for user confirmation (they approved SPEC already)
- Write status updates

The workflow phases are SEQUENTIAL. Complete plan → immediately start implement.

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
cat .claude/SPEC.md  # verify-spec: read SPEC file to confirm it exists
```

If missing, stop and run `/ds` first.

### 2. Data Profiling

**For multiple data sources:** Profile in parallel using background Task agents.

#### Single Data Source (Direct Profiling)

**MANDATORY profiling steps:**

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

#### Multiple Data Sources (Parallel Profiling)

<EXTREMELY-IMPORTANT>
**Pattern from oh-my-opencode: Launch ALL profiling agents in a SINGLE message.**

**Use `run_in_background: true` for parallel execution.**

When profiling 2+ data sources, launch agents in parallel:
</EXTREMELY-IMPORTANT>

```
# PARALLEL + BACKGROUND: All Task calls in ONE message

Task(
    subagent_type="general-purpose",
    description="Profile dataset 1",
    run_in_background=true,
    prompt="""
Profile this dataset and return a data quality report.

Dataset: /path/to/dataset1.csv

Required checks:
1. Shape: rows x columns
2. Data types: df.dtypes
3. Missing values: df.isnull().sum()
4. Duplicates: df.duplicated().sum()
5. Summary statistics: df.describe()
6. Unique value counts for categorical columns
7. Date range if time series
8. Memory usage: df.info()

Output format:
- Markdown table with column summary
- List of data quality issues found
- Recommendations for cleaning

Tools denied: Write, Edit, NotebookEdit (read-only profiling)
""")

Task(
    subagent_type="general-purpose",
    description="Profile dataset 2",
    run_in_background=true,
    prompt="""
[Same template for dataset 2]
""")

Task(
    subagent_type="general-purpose",
    description="Profile dataset 3",
    run_in_background=true,
    prompt="""
[Same template for dataset 3]
""")
```

**After launching agents:**
- Continue to other work (don't wait)
- Check status with `/tasks` command
- Collect results with TaskOutput when ready

```
# Collect profiling results
TaskOutput(task_id="task-abc123", block=true, timeout=30000)
TaskOutput(task_id="task-def456", block=true, timeout=30000)
TaskOutput(task_id="task-ghi789", block=true, timeout=30000)
```

**Benefits:**
- 3x faster profiling for 3 datasets
- Each agent focused on single source
- Results consolidated in main chat

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

### 4. ETL Strategy Assessment (Conditional)

**Triggers when profiling reveals ANY of:**
- Total rows > 1M across all sources
- Multiple data sources requiring joins/merges
- Data sourced from remote databases (WRDS, SQL servers, APIs)

**If triggered, assess these three dimensions before creating the task breakdown:**

#### A. Filter Push-Down Strategy

**The anti-pattern:** Pull entire tables into memory, then filter in pandas/R/SAS.

```
AskUserQuestion(questions=[{
  "question": "Where should filtering happen for this data?",
  "header": "Filtering",
  "options": [
    {"label": "Database-level (Recommended)", "description": "SQL WHERE clauses filter at source. Only matching rows transfer. Required for >1M row tables."},
    {"label": "Application-level", "description": "Pull full dataset, filter in code. Only acceptable for small tables (<100K rows) or when database access is read-once."},
    {"label": "Hybrid", "description": "Coarse filter at database (date range, key columns), fine filter in code (complex logic, cross-table conditions)."}
  ],
  "multiSelect": false
}])
```

**Document in PLAN.md:** For each data source, specify WHERE the filtering happens and WHY.

#### B. Parallelism Assessment

**The anti-pattern:** Process years/groups sequentially when they're embarrassingly parallel.

Identify parallelizable dimensions from profiling:
- **Time:** year-by-year, month-by-month processing
- **Groups:** firm-by-firm, sector-by-sector processing
- **Sources:** independent data sources profiled/cleaned in parallel

**Document in PLAN.md:** For each task, note if it can be parallelized and on what dimension.

#### C. Intermediate Result Caching

**The anti-pattern:** Re-read and re-process the same large source file in every task.

If multiple tasks read from the same large source:
1. **Task 1** reads and cleans the source → saves intermediate result
2. **Tasks 2-N** read from the intermediate result, not the raw source

**Document in PLAN.md:** Data flow diagram showing which tasks produce intermediates and which consume them.

#### ETL Strategy Section for PLAN.md

```markdown
## ETL Strategy
<!-- Include this section when data > 1M rows or multiple sources -->

### Filter Strategy
| Source | Rows | Filter Location | Filter Columns | Justification |
|--------|------|-----------------|----------------|---------------|
| source1 | 5M | Database (SQL WHERE) | date, type | Too large for full pull |
| source2 | 50K | Application (pandas) | — | Small enough for full load |

### Parallelism Plan
| Task | Parallelizable? | Dimension | Method |
|------|----------------|-----------|--------|
| Task 1 | Yes | By year (2003-2023) | Background Task agents / SGE array |
| Task 2 | No | — | Sequential (depends on Task 1 output) |

### Data Flow
source1.csv → [Task 1: Clean] → clean_source1.parquet → [Task 2: Merge]
source2.csv → [Task 1: Clean] → clean_source2.parquet ↗
                                                        → [Task 3: Analyze] → results
```

<EXTREMELY-IMPORTANT>
### ETL Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'll just read the whole table, it's easier" | 50M rows × 200 columns = OOM crash or 30-minute wait | Filter at source with SQL WHERE |
| "Sequential processing is simpler to write" | 20 years × 5 minutes = 100 minutes vs 5 minutes parallel | Use background agents or SGE arrays |
| "I'll re-read the source in each task" | Re-parsing 5GB CSV five times wastes hours | Save intermediate parquet after first read |
| "Filtering in pandas is more flexible" | Pandas loads ALL rows before filtering — you've already paid the cost | Push coarse filters to database, fine filters to pandas |
| "The data isn't that big" | You just profiled it. Check the row count. If >1M, it IS that big. | Follow the ETL strategy, don't guess |
| "I'll optimize later if it's slow" | Later never comes. The pipeline runs once and everyone moves on. | Design efficient ETL NOW |
</EXTREMELY-IMPORTANT>

### 5. Identify Implementation Language

Before creating tasks, determine the implementation language for ETL and analysis:

```
AskUserQuestion(questions=[{
  "question": "What language will be used for data processing / ETL?",
  "header": "Language",
  "options": [
    {"label": "Python (Recommended)", "description": "pandas/polars in notebooks or scripts. Default for most analysis."},
    {"label": "SAS", "description": "SAS on WRDS grid (qsas/qsub). For large-scale WRDS ETL with hash merges and SGE parallelism."},
    {"label": "R", "description": "R scripts or notebooks. For statistical modeling."},
    {"label": "Mixed", "description": "SAS for ETL, Python/R for analysis. Common for WRDS pipelines."}
  ],
  "multiSelect": false
}])
```

**If SAS or Mixed is selected:**
1. Record `Implementation Language: SAS` (or `Mixed: SAS ETL + Python analysis`) in PLAN.md header
2. Load WRDS SAS enforcement: `Read("${CLAUDE_PLUGIN_ROOT}/skills/wrds/references/sas-etl.md")`
3. All SAS tasks in the plan MUST include performance annotations:
   - **Merge strategy:** hash or sort-merge (with justification if sort-merge)
   - **WHERE pattern:** range-based date literals (document that no function-wrapped filters are used)
   - **Parallelism:** SGE array or sequential (with justification if sequential)
4. Add `## SAS Performance Constraints` section to PLAN.md (see template below)

### 6. Create Task Breakdown

Break analysis into ordered tasks:
- Each task should produce **visible output**
- Order by data dependencies
- Include data cleaning tasks FIRST

### 7. Write Plan Doc

Write to `.claude/PLAN.md`:

```markdown
# Analysis Plan: [Analysis Name]

> **For Claude:** REQUIRED SUB-SKILL: Use `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-implement/SKILL.md")` to implement this plan with output-first verification.
>
> **Delegation:** Main chat orchestrates, Task agents implement. Use `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-delegate/SKILL.md")` for subagent templates.

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

## ETL Strategy
<!-- Include when any source > 1M rows or multiple sources require joins -->

### Filter Strategy
| Source | Rows | Filter Location | Filter Columns | Justification |
|--------|------|-----------------|----------------|---------------|

### Parallelism Plan
| Task | Parallelizable? | Dimension | Method |
|------|----------------|-----------|--------|

### Data Flow
[source] → [task] → [intermediate] → [task] → [output]

## Implementation Language
[Python / SAS / R / Mixed]

<!-- If SAS or Mixed, include this section: -->
## SAS Performance Constraints
> **For Claude:** REQUIRED: Load `Read("${CLAUDE_PLUGIN_ROOT}/skills/wrds/references/sas-etl.md")` before writing ANY SAS code.
> Validate ALL SAS code against the SAS Code Validation Checklist in the WRDS skill.

### Per-Task SAS Annotations
| Task | Merge Strategy | WHERE Pattern | Parallelism |
|------|---------------|---------------|-------------|
| Task 1 | Hash (lookup < 500K rows) | BETWEEN date literals | SGE array by year |
| Task 2 | Sort-merge (both tables > 50M) | No date filter | Sequential (single output) |

## Reproducibility Requirements
- Random seed: [value if needed]
- Package versions: [key packages]
- Data snapshot: [date/version]
```

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Skip data profiling | Your data issues will break your analysis | Always profile first |
| Ignore missing values | You'll corrupt your results | Document and plan handling |
| Start analysis immediately | You haven't characterized your data | Complete profiling |
| Assume your data is clean | Never assume, you must verify | Run quality checks |
| Pull entire tables without WHERE clauses | OOM on large data, wastes time/memory | Filter at database level for >1M row sources |
| Process years sequentially | Embarrassingly parallel = free speedup | Use background agents or SGE arrays |
| Re-read same source in multiple tasks | Redundant I/O multiplies runtime | Save intermediate results after first read |

## Output

Complete the plan when:
- Read and understand `.claude/SPEC.md`
- Profile all data sources (shape, types, stats)
- Document data quality issues
- Define cleaning strategy for each issue
- Assess ETL strategy (if data > 1M rows or multiple sources)
- Order tasks by dependency
- Define output verification criteria
- Write `.claude/PLAN.md`
- Confirm ready for implementation

## Phase Complete

**REQUIRED SUB-SKILL:** After completing plan, IMMEDIATELY invoke:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-implement/SKILL.md")
```
