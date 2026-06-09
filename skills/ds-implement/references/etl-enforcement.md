# ETL Strategy Enforcement

Enforcement patterns for ETL decisions made during ds-plan. Each section corresponds to a subsection of PLAN.md's `## ETL Strategy`.

For SAS-specific enforcement, see `../../../skills/wrds/references/sas-etl.md`. (relative to this skill's base directory)
For Gemini batch scale-up, see `../../../skills/gemini-batch/references/scale-up-testing.md`.

---

## Key & Grain Carry-Through

**Enforces:** the row primary key and business/event key that ds-plan profiling identified and
recorded in PLAN.md (`row_pk`, `event_key`). Discovery (ds-plan) and verification (DQ3) are
useless if the implementation drops the key columns between stages.

**The rule: identify the grain once, then carry its key columns through EVERY stage. Never drop
them mid-pipeline.** Dropping the identifying columns (e.g. `dcn`/`seqnum`/`amend` on Form 4) is
what creates silent double-counts no downstream check can catch — once the keys are gone,
duplicates and amendments are indistinguishable from legitimate rows.

### Enforcement

```
## Key Carry-Through Enforcement (Non-Negotiable)

PLAN.md declares row_pk (smallest unique column-set) and event_key (coarser real-world key).

### Every load/transform MUST keep the key columns
- The SELECT / read keeps all columns composing row_pk AND event_key (and any amendment flag).
- After EVERY transform that could change the grain (join, groupby, pivot, dedup), assert:
      assert not df.duplicated(subset=ROW_PK).any(), f"row_pk {ROW_PK} no longer unique"
- Carry the keys into every intermediate file (parquet/csv). Only drop them in the FINAL
  deliverable, and only AFTER dedup/aggregation is complete.

### Dedup = supersession, NOT blanket drop_duplicates
- Resolve real duplicates (amendments/restatements) by keeping the latest filing per event_key:
      df = df.sort_values(FILING_DATE).groupby(EVENT_KEY, as_index=False).last()
- NEVER df.drop_duplicates(subset=EVENT_KEY) blindly — it deletes legitimate repeated
  lots/tranches (same size/price, different seqnum). Keep row_pk so real lots survive.
- df.duplicated() (all columns) only catches byte-identical rows; it MISSES amendments that
  changed one field. The event_key collision check is what catches those.

### Self-Check
- [ ] row_pk and event_key columns present in every intermediate output (verified, not assumed)
- [ ] PK uniqueness asserted after each grain-changing transform
- [ ] Any dedup uses supersession on event_key, with row_pk preserved
- [ ] Key columns dropped (if at all) only in the final deliverable, after dedup
```

### Key & Grain Facts

- Without `dcn`/`seqnum`/`amend`, an amended re-filing is indistinguishable from a real second trade — a silent double-count no downstream check can catch. Keeping "only the analysis columns" creates exactly this.
- `drop_duplicates()` removes only byte-identical rows — an amendment that corrected one field survives and double-counts. Deduping on the business key instead collapses legitimate multi-lot rows (same size/price, different seqnum) and under-counts. Supersession on the event key (keep latest filing) with row_pk preserved is the only dedup that does neither; verify with the event-key collision check.
- Discovery without carry-through is wasted work: profiling found the grain, but the keys must survive every transform to stay checkable — assert PK presence + uniqueness after each stage.

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

### Filter Facts

- Pandas pays the full load cost before your filter runs: filtering "flexibly" in pandas means loading 50M rows into memory to discard 49M. The WHERE clause belongs in SQL.
- "The SQL syntax is complicated for this filter" is exactly what Hybrid exists for: coarse filter (date/key) in SQL, complex logic in pandas.
- "It loaded fine without filtering" means it loaded on YOUR machine with YOUR memory — production data is 10x bigger. Overriding the plan's filter location on that evidence is the failure the Filter Strategy table exists to prevent.

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

### Parallelism Facts

- The parallelism method in PLAN.md is a decision the user already made — running sequentially "because it's simpler to debug" overrides it. The overhead of spawning agents is dwarfed by the win: 20 years × 5 min = 100 min sequential vs ~10 min parallel.
- "I'll parallelize after I get it working" is a commitment nobody keeps — the pipeline runs once and everyone moves on. Promising it is dishonest scheduling; parallelize now, as planned.
- More parallel workers is not always faster: when all workers read the same source, contention inverts the win (observed: 7 jobs × 40 min each vs 1 job × 5 min solo). Check shared-source contention first; pre-split if needed.

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

### Caching Facts

- CSV loses dtypes silently — the time spent debugging type coercion exceeds whatever "easier to inspect" saved. Parquet inspects in 2 lines: `pd.read_parquet().head()`.
- Re-reading a 5GB raw source five times wastes hours — load from the planned intermediate.
- Format consistency matters more than file size: mixed intermediate formats create brittle pipelines. Use the planned format for all intermediates.

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

---

## Long-Running Task Monitoring

**Use the Monitor tool for any ETL step that takes >30 seconds.** Monitor streams events without blocking the conversation — you keep working and get notified on completion.

### When to Use Monitor vs run_in_background

| Scenario | Tool | Why |
|----------|------|-----|
| Script runs to completion, you need the exit code | `Bash(run_in_background=true)` | One-shot notification on exit |
| Script produces streaming progress you want to see | `Monitor` | Each stdout line is an event |
| Watching external job queue (SGE, batch API) | `Monitor` | Poll loop emits state transitions |
| Multiple independent scripts in parallel | `Bash(run_in_background=true)` × N | Each notifies independently |

### Patterns

**Watch a long-running Python ETL script:**
```
Monitor(
  description="ETL: merge_panel.py progress",
  timeout_ms=600000, persistent=false,
  command="uv run python3 -u src/merge_panel.py 2>&1 | grep --line-buffered -E '(rows|shape|complete|error|warning)'"
)
```

**Watch SGE job queue (WRDS):**
```
Monitor(
  description="SGE jobs for pipeline",
  persistent=true, timeout_ms=3600000,
  command="while qstat -u $USER 2>/dev/null | grep -q .; do qstat -u $USER | tail -n +3; sleep 30; done && echo 'ALL JOBS COMPLETE'"
)
```

**Watch Gemini batch job:**
```
Monitor(
  description="Gemini batch completion",
  persistent=true, timeout_ms=3600000,
  command="while true; do state=$(uv run python3 -c \"import google.genai as genai; print(genai.batches.get(name='$JOB').state)\"); echo \"$state\"; [ \"$state\" = 'JOB_STATE_SUCCEEDED' ] || [ \"$state\" = 'JOB_STATE_FAILED' ] && break; sleep 60; done"
)
```

### Key Rules

- **Always use `grep --line-buffered`** in pipes — without it, pipe buffering delays events by minutes
- **Use `-u` flag for Python** (`uv run python3 -u`) to disable output buffering
- **Filter stdout aggressively** — every line becomes a notification; don't pipe raw logs
- **Set `persistent: true`** for jobs >10 minutes (SGE pipelines, batch APIs)
- **Set reasonable `timeout_ms`** — 600000 (10 min) for local scripts, 3600000 (1 hr) for remote jobs
