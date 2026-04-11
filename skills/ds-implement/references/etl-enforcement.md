# ETL Strategy Enforcement

Enforcement patterns for ETL decisions made during ds-plan. Each section corresponds to a subsection of PLAN.md's `## ETL Strategy`.

For SAS-specific enforcement, see `../../../skills/wrds/references/sas-etl.md`. (relative to this skill's base directory)
For Gemini batch scale-up, see `../../../skills/gemini-batch/references/scale-up-testing.md`.

---

## Filter Push-Down

**Enforces:** PLAN.md `### Filter Strategy` table decisions.

Before writing data loading code for any task, check the Filter Strategy table in PLAN.md. The user chose WHERE each source gets filtered — enforce that choice.

### Python/SQL Enforcement

```
## Filter Push-Down Enforcement (Non-Negotiable)

For each data source in this task, check PLAN.md Filter Strategy table:

### If Filter Location = "Database (SQL WHERE)":
- ALL filtering MUST happen in the SQL query, not in pandas/polars
- WRONG: `pd.read_sql("SELECT * FROM table", con).query("date > '2020-01-01'")`
- RIGHT: `pd.read_sql("SELECT * FROM table WHERE date > '2020-01-01'", con)`
- After loading, print row count. If it exceeds 2x the expected filtered count, you filtered wrong.

### If Filter Location = "Application (pandas)":
- Acceptable ONLY for sources marked as small in the plan (<100K rows)
- Still print row counts before/after filtering

### If Filter Location = "Hybrid":
- Coarse filter (date range, key columns) MUST be in SQL
- Fine filter (complex logic, cross-table conditions) can be in pandas
- Print row counts at both stages: after SQL load, after pandas filter

### Self-Check
- [ ] Each source loaded with the filter location specified in PLAN.md
- [ ] Row counts printed after every filter step
- [ ] No full-table loads for sources marked as "Database" filtering
```

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'll filter in pandas, it's more flexible" | You just loaded 50M rows into memory to discard 49M | Push the WHERE clause to SQL |
| "The SQL syntax is complicated for this filter" | Hybrid exists for exactly this case. Push the coarse filter to SQL. | Use hybrid: SQL for date/key, pandas for complex logic |
| "It loaded fine without filtering" | It loaded fine on YOUR machine with YOUR memory. Production data is 10x bigger. | Follow the plan. Filter at source. |

---

## Parallelism

**Enforces:** PLAN.md `### Parallelism Plan` table decisions.

Before implementing each task, check the Parallelism Plan table in PLAN.md. The user chose how parallelizable tasks should be executed.

### Enforcement

```
## Parallelism Enforcement

For each task in PLAN.md Parallelism Plan:

### If Method = "Background Task agents":
- Spawn parallel Task agents for independent groups/years
- Each agent gets its own data scope (e.g., one year, one sector)
- Reconcile results after all agents complete
- DO NOT process sequentially "because it's simpler"

### If Method = "SGE array jobs":
- Submit as array jobs to grid scheduler
- Load SAS SGE enforcement from wrds/references/sas-etl.md
- Per-year log files, NOT shared log
- DO NOT run in a loop "because SGE is hard to set up"

### If Method = "Sequential":
- Process one at a time (user chose this deliberately)
- Still print timing per step for future optimization

### Shared-Source Contention Check (all parallel methods)
Before parallelizing, check: **do all workers read the same large file/table?**

If yes, parallel reads can be SLOWER than sequential due to I/O contention (NFS, shared disk, API rate limits). Observed: 7 parallel SAS jobs reading the same 44GB NFS file took ~40 min each instead of ~5 min solo.

**Pattern: read once → partition → parallelize on partitions.**

1. Add a single-reader pre-split step that reads the source once
2. Write partitions (by year, key, etc.) to fast intermediate storage
3. Parallel workers each read their own partition — zero contention

Alternative read paths that avoid contention:
- Database (PostgreSQL, etc.) handles concurrent reads natively
- Object store APIs (S3) parallelize at the HTTP level
- Local SSD vs shared NFS

**When to skip:** If the source is small (<1GB), a database with good concurrency, or an API with high rate limits, contention is unlikely.

### Self-Check
- [ ] Each parallelizable task uses the method specified in PLAN.md
- [ ] Independent tasks are NOT run sequentially without justification
- [ ] Parallel results are reconciled before downstream tasks
- [ ] Shared-source contention risk assessed for parallel tasks
```

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Sequential is simpler to debug" | The user already decided this is parallelizable. You're overriding their decision. | Follow the plan. Use the method they chose. |
| "I'll parallelize after I get it working" | You won't. The pipeline runs once and moves on. | Parallelize now, as planned. |
| "The overhead of spawning agents isn't worth it" | 20 years × 5 min = 100 min sequential vs ~10 min parallel. It's worth it. | Spawn the agents. |
| "More parallel workers = faster" | If all workers read the same source, contention makes it slower. 7 jobs × 40 min > 1 job × 5 min. | Check for shared-source contention first. Pre-split if needed. |

---

## Caching

**Enforces:** PLAN.md `### Data Flow` diagram and user's chosen intermediate format.

When a task produces intermediate results consumed by downstream tasks, enforce the planned format and caching strategy.

### Enforcement

```
## Intermediate Caching Enforcement

For each task that produces intermediates (per PLAN.md Data Flow):

### If Format = "Parquet":
- Save with: df.to_parquet("path.parquet", index=False)
- Downstream tasks load with: pd.read_parquet("path.parquet")
- NEVER save as CSV "because it's easier to inspect"
- Parquet preserves dtypes — CSV does not

### If Format = "CSV":
- Acceptable when downstream tools require CSV
- Always specify dtypes on reload to avoid silent type coercion
- Print dtypes after reload to verify

### If Format = "SQLite":
- Use for queryable intermediates when downstream tasks need filtered reads
- df.to_sql("table", con, if_exists="replace", index=False)
- Downstream: pd.read_sql("SELECT ... WHERE ...", con)

### If "No caching needed":
- Each task reads from its own source — no intermediates
- Still verify sources are independent (no accidental re-reads)

### Self-Check
- [ ] Intermediate format matches PLAN.md choice
- [ ] Downstream tasks load from intermediates, NOT re-reading raw sources
- [ ] Dtypes verified after loading intermediates (especially for CSV)
```

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "CSV is easier to inspect" | Open parquet in pandas with 2 lines. CSV loses dtypes silently — you'll spend more time debugging type coercion than you saved. | Save as parquet, inspect with `pd.read_parquet().head()` |
| "I'll just re-read the raw source" | The plan says use intermediates. Re-reading 5GB CSV five times wastes hours. | Load from the intermediate, as planned. |
| "The intermediate file is small, format doesn't matter" | Format consistency matters more than size. Mixed formats create brittle pipelines. | Use the planned format for all intermediates. |

---

## Scale-Up

**Enforces:** PLAN.md `### Scale-Up Testing Plan` table.

See the Scale-Up Testing Protocol in the main ds-implement SKILL.md for the Iron Law and staged protocol. This section covers enforcement routing.

### Domain-Specific Enforcement

Load the appropriate scale-up reference based on the batch operation type:

| Operation Type | Enforcement Reference |
|---------------|----------------------|
| Gemini / Vertex AI batch | `../../../skills/gemini-batch/references/scale-up-testing.md` |
| Generic API batch | Follow ds-implement Scale-Up Testing Protocol directly |
| Database bulk operations | Validate on dev/staging table first, then production |

### Self-Check
- [ ] Scale-up stages match PLAN.md table (number of stages, batch sizes)
- [ ] Each stage gate passed before proceeding to next
- [ ] Domain-specific reference loaded for the operation type
- [ ] Cost extrapolation documented in LEARNINGS.md before full batch
