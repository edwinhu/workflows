# PostgreSQL vs SAS on WRDS: Decision Guide

When to use WRDS PostgreSQL (via Python/psycopg2) vs SAS (via qsas/SGE) for data ETL. Based on empirical benchmarks on the WRDS cloud.

## Contents

- [Quick Decision Table](#quick-decision-table)
- [When PostgreSQL Wins](#when-postgresql-wins)
- [When SAS Wins](#when-sas-wins)
- [The Hybrid Pattern](#the-hybrid-pattern)
- [WRDS PostgreSQL Constraints](#wrds-postgresql-constraints)
- [Benchmark Reference](#benchmark-reference)
- [Code Examples: Same Task, Both Approaches](#code-examples-same-task-both-approaches)
- [Decision Flowchart](#decision-flowchart)

---

## Quick Decision Table

| Factor | PostgreSQL (Python) | SAS (qsas/SGE) |
|--------|-------------------|-----------------|
| **Simple filtered queries** | **Winner** — server-side WHERE, fast | Overhead of SAS startup |
| **Server-side aggregation** | **Winner** — GROUP BY returns small result | Equivalent |
| **Multi-table joins (large × large)** | Slow — read-only, no temp tables | **Winner** — hash merge, intermediate datasets |
| **Intermediate datasets** | Cannot create on server | **Winner** — `libname out` writes to scratch |
| **Year-parallel ETL** | Manual chunking in Python | **Winner** — SGE array jobs, native |
| **MFLINKS chain (multi-hop joins)** | OOM risk on large intermediates | **Winner** — hash objects, sequential processing |
| **Downstream analysis** | **Winner** — pandas/polars, notebooks | Export to CSV/parquet first |
| **Memory model** | Entire DataFrame in RAM — OOM risk on large data | Streams from disk, row-by-row — dataset size limited by disk, not RAM |
| **Debugging** | Interactive, print statements | Log files, `options mprint` |
| **Setup complexity** | psycopg2 connection string | autoexec.sas, libnames, SGE scripts |

## When PostgreSQL Wins

### 1. Filtered reads with server-side aggregation

When the query returns a small result set (< 1M rows), PostgreSQL is ideal. The server does all the work.

**Sweet spot:** Single-table queries or simple joins where the result fits in memory.

```python
# ISS proxy voting: 834K rows in 13.5 seconds
agg = pd.read_sql("""
    SELECT meetingdate, ticker, cusip, issagendaitemid,
           voteresult, voterequirement, ...
    FROM risk.vavoteresults
    WHERE meetingdate BETWEEN '2003-01-01' AND '2024-12-31'
""", conn)
```

### 2. Per-year server-side CTEs

When you need joins but can aggregate per-year to keep result sets small:

```python
# 13-F institutional ownership: 674K rows in 5.2 minutes
for yr in range(2002, 2025):
    agg = pd.read_sql(f"""
        WITH holdings AS (
            SELECT ... FROM tfn.s34type1 t1
            JOIN tfn.s34type3 t3 ON ...
            WHERE t1.rdate BETWEEN '{yr}-01-01' AND '{yr}-12-31'
        )
        SELECT permno, rdate, COUNT(DISTINCT mgrno), SUM(shares)
        FROM holdings GROUP BY permno, rdate
    """, conn)
```

### 3. Reference table lookups

Small dimension tables (CUSIP→PERMNO mapping, company names, SIC codes):

```python
cusip_map = pd.read_sql("""
    SELECT DISTINCT SUBSTR(ncusip, 1, 6) AS cusip6, permno
    FROM crsp.msenames WHERE ncusip IS NOT NULL
""", conn)
```

## When SAS Wins

### 1. Multi-hop join chains (MFLINKS pattern)

When you need A → B → C → D joins where intermediates are large, SAS hash objects avoid OOM:

```
fundno → wficn (mflink2)
  → crsp_fundno (mflink1)
    → index_fund_flag (portnomap)
      → holdings (s12)
        → CUSIP → PERMNO (msenames)
```

**Why PostgreSQL fails:** WRDS PostgreSQL is read-only — you cannot `CREATE TEMP TABLE`. The full join chain must execute in a single query, which either times out or produces intermediates too large to download.

### 2. Large table scans with intermediate storage

TFN S12 mutual fund holdings: 207.9M rows total, 4–25M per year. Processing requires:
- Reading the full year of holdings
- Joining with MFLINKS chain
- Classifying passive/index funds
- Aggregating to CUSIP-quarter level
- Saving intermediate results for the next step

SAS writes intermediate datasets to `/scratch/` — PostgreSQL has no equivalent.

### 3. SGE-parallel year processing

SAS + SGE array jobs are native to WRDS:

```bash
#$ -t 2003-2024
qsas -sysparm "$SGE_TASK_ID" etl_year.sas
```

Python can approximate this with `qsub` wrapper scripts, but SAS has tighter SGE integration and avoids Python's memory overhead per process.

### 4. No memory management

SAS processes data row-by-row through the program data vector — the full dataset never needs to fit in RAM. Only hash objects consume memory, and those hold the small lookup tables. This means SAS can process arbitrarily large datasets without OOM risk, chunking strategies, or `del df` cleanup. Python requires careful memory management: per-chunk processing, explicit deallocation, and memory limit requests (`-l m_mem_free=8G`) for SGE jobs.

### 5. Hash merges on indexed data

SAS hash objects perform O(1) lookups without sorting. For large fact tables merged with small lookup tables, this avoids the sort cost that PostgreSQL incurs on complex joins.

```sas
data want;
  if _n_ = 1 then do;
    declare hash h(dataset: "out.mfl3");
    h.defineKey("fundno", "rdate");
    h.defineData("wficn", "crsp_fundno");
    h.defineDone();
  end;
  set tfn.s12(where=(fdate between "01jan&ys."d and "31dec&ye."d));
  if h.find() = 0;
run;
```

## The Hybrid Pattern

The most effective WRDS pipeline uses PostgreSQL for bulk reads and SAS for multi-step ETL:

```
Step 1 (parallel):
  SAS:  build_meetings.sas      → out.meetings     (~12 sec)
  SAS:  build_inst_own.sas      → out.inst_own     (~3 min)
  SAS:  build_mflinks.sas       → out.mfl2, mfl3   (~1 min)
  SAS:  split_s12.sas           → out.s12_* on /scratch via PostgreSQL (~15 min)

Step 2 (parallel, after mflinks + split_s12):
  SAS:  tfn_holdings_parallel.sas ×9 → out.mf_own_*  (~5 min each, reads /scratch)

Step 3 (after all):
  SAS:  merge_panel.sas         → out.pass          (~5 sec)
```

**Key insight: PostgreSQL for reads, SAS for ETL.** PostgreSQL handles concurrent reads natively — use it to avoid NFS contention on large SAS files. SAS handles multi-hop join chains (MFLINKS) and intermediate storage that PostgreSQL cannot (read-only, no temp tables).

**Rule of thumb:**
- **PostgreSQL for bulk reads** of large SAS files (avoids NFS contention)
- **SAS for multi-step ETL** (hash merges, intermediate datasets, SGE parallelism)
- **Python for final analysis** (notebooks, visualization)

**Critical: SAS should output aggregated data, not raw holdings.** Move CUSIP→PERMNO mapping, TSO joins, and permno-quarter aggregation into the SAS script itself. The SAS output should be the small analytical dataset (~50K rows per chunk), not intermediate holdings.

## Aggregate on the Grid, Ship the Result

The strongest version of the hybrid is not "read faster" — it is **do not ship
rows at all**. If the analysis consumes an aggregate, compute the aggregate
server-side and transfer that.

The blocker is usually that the grouping key lives in a *locally built* lookup
(fuzzy name matching, hand adjudication) rather than in WRDS. That lookup is
almost always tiny. **Push it up.**

**Worked example** (`../npx-ownership-panel/scripts/build_npx.sas`, measured
2026-07-25): `risk.voteanalysis_npx` is 238,445,215 rows / **329 GB**. A
sequential local pull of the 144,376,253-row filtered slice takes ~35 min and
returns 304 MB. Staging a 26,686-row / 660 KB `fundid → block` crosswalk to
/scratch, hash-merging it inside a 21-task year-parallel array, and accumulating
to `(itemonagendaid, block)` returns **2,254,660 cells / 20.8 MB in 839s** — a
64× row reduction and a 15× byte reduction, reconciling exactly to the
PostgreSQL semi-join count.

| Pattern | When |
|---|---|
| Ship joined rows | you genuinely need row-level data locally |
| Semi-join + ship narrow columns, join dimensions locally | dimension columns are replicated across millions of fact rows |
| **Push lookup up, aggregate on grid, ship cells** | the analysis consumes an aggregate — usually the right answer |

Two caveats the benchmark exposed:

- **SGE concurrency is not your task count.** 21 tasks ran ~10 at a time.
- **Budget for a straggler.** One task took 742s against a 60s median and was
  the difference between a 234s and an 839s wall. Always reconcile output
  coverage explicitly — that same run silently produced 20 of 21 files.

**NFS contention pattern:** Large SAS files on NFS (e.g., `tfn.s12` at 44GB) cause severe I/O contention when read by multiple parallel jobs (~40 min each vs ~5 min solo). Solution: read once via PostgreSQL (`split_s12.sas`), write partitions to `/scratch`, then parallel jobs read their own partition. PostgreSQL schema names differ from SAS libnames: `tfn.s12` → `tr_mutualfunds.s12`, `tfn.s34` → `tr_13f.s34`.

## WRDS PostgreSQL Constraints

These constraints make PostgreSQL unsuitable for complex ETL:

| Constraint | Impact |
|-----------|--------|
| **Read-only** | Cannot `CREATE TEMP TABLE`, `CREATE INDEX`, or use materialized CTEs |
| **No server-side storage** | Cannot save intermediate results for multi-step processing |
| **Statement timeout** | Long-running queries may be killed (default varies) |
| **Memory limits** | Large result sets can OOM the Python client process |
| **Connection pooling** | Limited concurrent connections per user |

### Workarounds That Don't Work

| Approach | Why It Fails |
|----------|-------------|
| Materialized CTEs | Read-only: `cannot execute CREATE TABLE in a read-only transaction` |
| Download raw + merge locally | OOM for large tables (S12: 25M rows/year × fundname column) |
| Multiple concurrent CTEs | PostgreSQL parallelism saturates at 3-4 heavy queries |
| Chunked downloads with OFFSET | Slow, no stable sort guarantee, gaps/duplicates |
| SAS raw output → Python conversion | SAS7BDAT files are huge (1-12GB); `pd.read_sas` loads entire file into RAM → OOM |

## Benchmark Reference

Actual timings from WRDS cloud (2024), processing 2003–2024:

| Task | PostgreSQL (Python) | SAS (qsas/SGE) | Winner |
|------|-------------------|-----------------|--------|
| ISS proxy votes (filtered read) | **13.5s** | ~30s (startup overhead) | PostgreSQL |
| ISS N-PX fund votes → (item×block) cells, 2005-2025 | 2,100s sequential local | **839s** (21-task array, aggregate on grid) | SAS (2.5×) |
| 13-F inst. ownership (per-year CTE) | **5.2 min** | ~8 min | PostgreSQL |
| MF holdings via MFLINKS (S12, 250M rows) | ~3.5 hours (est.) | **20 min** (9× parallel + PG split) | SAS (10×) |
| S12 bulk read (split_s12.sas via PG) | N/A | **15 min** (single PG read, ~40GB) | Hybrid |
| CUSIP→PERMNO mapping | **<1s** | ~5s | PostgreSQL |
| Full pipeline (all SAS + PG read) | ~4 hours (est.) | **20 min** (hybrid) | Hybrid |

## Code Examples

Working implementations are in `../npx-ownership-panel/scripts/` in the WRDS skill — copy and customize rather than rewriting:

| Task | File | Approach |
|------|------|----------|
| ISS N-PX fund votes → (item×block) cells | `build_npx.sas` + `run_npx_array.sh` | Year-parallel SGE array over a 329 GB table; hash-merge a pushed-up crosswalk, aggregate in place (~839s for 21 years) |
| ISS proxy votes | `build_meetings.sas` | SAS with optional SharkRepellent/ISS recs (~12s) |
| 13-F institutional ownership | `build_inst_own.sas` | SAS crspmerge + cfacshr + DBREADTH/HHI (~3 min) |
| S12 bulk read + partition | `split_s12.sas` | PostgreSQL read → year-range partitions on /scratch (~15 min) |
| MF holdings via MFLINKS | `tfn_holdings_parallel.sas` | SAS hash merge + SGE parallel, reads /scratch (~5 min each) |
| MFLINKS prereqs | `build_mflinks.sas` | SAS proc sort + proc sql (~1 min) |
| Pipeline orchestration | `run_pipeline.sh` | SGE hold_jid dependency chain |
| Final merge | `merge_panel.sas` | SAS MERGE_ASOF + pivotalness (~5 sec) |

## Splitting Year Ranges for Parallel Jobs

**Always profile row counts before choosing year ranges.** Data volume grows over time — equal-width year ranges produce wildly unequal workloads.

### Anti-Pattern: Equal-Width Splits

```bash
# BAD — 2019-2024 has 10x the data of 2003-2006
YEAR_RANGES=("2003 2006" "2007 2010" "2011 2014" "2015 2018" "2019 2024")
```

### Correct Pattern: Profile First, Then Split

```sql
-- Run this BEFORE designing the pipeline
SELECT EXTRACT(YEAR FROM fdate) AS yr, COUNT(*) AS n
FROM tfn.s12
GROUP BY 1 ORDER BY 1;
```

Then split so each chunk has roughly equal row counts:

```bash
# GOOD — balanced by data volume, not year count
# S12 example: ~4M/yr pre-2017, ~20-26M/yr post-2017
YEAR_RANGES=("2003-2010" "2011-2016" "2017-2018" "2019-2019" "2020-2020" "2021-2021" "2022-2022" "2023-2023" "2024-2024")
```

### Rule of Thumb

For WRDS financial data, row counts can increase 5× over a decade. S12 went from ~4M rows/year (2003-2016) to ~20-26M rows/year (2018-2024). Always profile before splitting. Recent years should get 1 year each; early years can be 6-8 year ranges.

## Decision Flowchart

```
Is the query a single-table read or simple join?
├── YES: Will the result set fit in memory (<5M rows)?
│   ├── YES → PostgreSQL (server-side WHERE + GROUP BY)
│   └── NO → PostgreSQL with per-year chunking
└── NO: Does the pipeline need intermediate datasets?
    ├── YES: Can intermediates be avoided with CTEs?
    │   ├── YES (result still <5M rows/year) → PostgreSQL CTEs
    │   └── NO (multi-hop joins, large intermediates) → SAS
    └── NO → PostgreSQL (single query)

For the chosen approach:
├── PostgreSQL: Use `pd.read_sql` with server-side aggregation
├── SAS: Use hash merges + SGE array jobs
└── Both needed? → Hybrid pipeline (SAS ETL → parquet → Python analysis)
```
