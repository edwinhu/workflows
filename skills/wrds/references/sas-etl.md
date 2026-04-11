# SAS ETL Performance Patterns on WRDS

Reference for writing efficient SAS code on the WRDS cloud (SAS Grid / SGE cluster). Every pattern here exists because the naive alternative is 10-100x slower or silently prevents index usage.

## Contents

- [Hash Object Merge](#hash-object-merge) - O(1) lookup, no sorting required
- [Hash Accumulator](#hash-accumulator) - Aggregate without PROC MEANS
- [Index-Friendly WHERE Clauses](#index-friendly-where-clauses) - The #1 performance mistake
- [SGE Array Jobs](#sge-array-jobs) - Year-parallel processing on WRDS grid
- [Project Organization Patterns](#project-organization-patterns) - Paired scripts, stacking, shared macros
- [PROC SQL Optimization](#proc-sql-optimization) - Indexed joins, pass-through, monotonic
- [SAS Macro Patterns](#sas-macro-patterns) - Safe resolution, quoting, debugging

---

## Hash Object Merge

**Preferred over `PROC SORT` + `DATA` merge for all lookup joins.** Hash objects load the small table into memory for O(1) key lookup against the large table. No sorting required.

### Basic Hash Merge (1:1 lookup)

```sas
data want;
  /* Load small lookup table into hash ONCE at initialization */
  if _n_ = 1 then do;
    declare hash h(dataset: "lib.lookup_table");
    h.defineKey("gvkey");
    h.defineData("conm", "sic");
    h.defineDone();
  end;

  /* Sequential read of large table — O(1) lookup per row */
  set lib.large_table;
  if h.find() = 0 then output;  /* 0 = found */
run;
```

### When to Use Hash vs Sort-Merge

| Scenario | Use Hash | Use Sort-Merge |
|----------|----------|----------------|
| Small lookup + large fact table | **Yes** — load small into hash | No |
| Both tables very large (>50M rows each) | Only if enough memory | **Yes** |
| Many-to-many merge | Possible with multidata | **Simpler** |
| Already sorted by key | Still faster (no I/O) | Acceptable |
| Need all non-matches | Use `h.find() ne 0` | Use `if a and not b` |

**Rule of thumb:** If either table fits in memory (<4GB), use hash.

### Hash with Multiple Data Columns

```sas
declare hash h(dataset: "lib.lookup");
h.defineKey("gvkey", "fyear");     /* Composite key */
h.defineData("at", "sale", "ni");  /* Multiple data columns */
h.defineDone();
```

### Left Join with Hash (keep non-matches)

```sas
data want;
  if _n_ = 1 then do;
    declare hash h(dataset: "lib.lookup");
    h.defineKey("gvkey");
    h.defineData("conm");
    h.defineDone();
    call missing(conm);  /* Initialize to missing for non-matches */
  end;

  set lib.large_table;
  rc = h.find();  /* rc=0 found, rc≠0 not found — row kept either way */
  if rc ne 0 then call missing(conm);  /* Reset for non-matches */
  output;
run;
```

---

## Hash Accumulator

Aggregate data in a single pass without `PROC MEANS` or `PROC SQL GROUP BY`. Faster for large datasets because it avoids sorting.

### Count + Sum by Group

```sas
data _null_;
  if _n_ = 1 then do;
    declare hash h();
    h.defineKey("gvkey", "fyear");
    h.defineData("gvkey", "fyear", "count", "total_sale");
    h.defineDone();
    call missing(gvkey, fyear, count, total_sale);
  end;

  set lib.large_table end=eof;

  /* Try to find existing group */
  if h.find() ne 0 then do;
    count = 0;
    total_sale = 0;
  end;

  /* Accumulate */
  count + 1;
  total_sale + sale;

  /* Update or add */
  h.replace();

  /* Output at end of file */
  if eof then h.output(dataset: "lib.summary");
run;
```

### Critical: h.output() Quoting

```sas
/* BAD — single quotes prevent macro resolution */
h.output(dataset: 'lib.summary_&year.');  /* Literal &year., not resolved */

/* GOOD — double quotes allow macro resolution */
h.output(dataset: "lib.summary_&year.");  /* Resolves to summary_2020 etc. */
```

### Critical: put Statements with Hash Methods

```sas
/* BAD — inline method call in put statement fails */
put h.num_items=;

/* GOOD — assign to temp variable first */
_n_items = h.num_items;
put "Hash has " _n_items " items";
```

---

## Index-Friendly WHERE Clauses

**This is the #1 SAS performance mistake.** Wrapping an indexed column in a function prevents SAS from using the index, forcing a full table scan.

### The Anti-Pattern (NEVER DO THIS)

```sas
/* BAD — function on indexed column prevents index usage */
where year(meetingdate) = &year.;
where month(datadate) = 12;
where upcase(ticker) = 'AAPL';
where substr(gvkey, 1, 3) = '001';
where datepart(meeting_dt) > '01jan2020'd;
```

**Why it's slow:** SAS cannot use the index on `meetingdate` when it's wrapped in `year()`. It must read every row and compute `year()` on each one — a full table scan.

### The Correct Pattern (ALWAYS DO THIS)

```sas
/* GOOD — range-based filter allows index usage */
where meetingdate between "01jan&year."d and "31dec&year."d;
where datadate between "01dec&year."d and "31dec&year."d;
where ticker = 'AAPL';  /* No function needed if case matches */
where gvkey =: '001';   /* Prefix operator, index-friendly */
where datepart(meeting_dt) between '01jan2020'd and '31dec2020'd;
```

### Quick Reference: Function-Free Alternatives

| Anti-Pattern | Correct Pattern | Why |
|---|---|---|
| `year(date) = 2020` | `date between "01jan2020"d and "31dec2020"d` | Range scan vs full scan |
| `month(date) = 6` | `date between "01jun&yr."d and "30jun&yr."d` | Same — avoid function |
| `year(date) >= 2015 and year(date) <= 2020` | `date between "01jan2015"d and "31dec2020"d` | Single range, one index probe |
| `upcase(col) = 'X'` | `col = 'X'` or pre-standardize | Remove function wrapper |
| `substr(key, 1, 3) = 'ABC'` | `key =: 'ABC'` | Prefix operator uses index |
| `int(datetime/86400) = date` | Convert outside WHERE, merge on result | Functions prevent index |

### Compound Date Filters

```sas
/* BAD — two function calls */
where year(datadate) = &year. and quarter(datadate) = 4;

/* GOOD — single range */
where datadate between "01oct&year."d and "31dec&year."d;
```

---

## SGE Array Jobs

WRDS runs Sun Grid Engine (SGE) for batch processing. Array jobs parallelize embarrassingly parallel tasks (e.g., year-by-year ETL).

### Basic Array Job Template

```bash
#!/bin/bash
#$ -t 2003-2020        # Task range: one task per year
#$ -l m_mem_free=4G    # Memory per task (increase for hash-heavy)
#$ -cwd                # Run in current directory
#$ -j y                # Merge stdout/stderr

year=$SGE_TASK_ID
qsas -sysparm "$year" -log "logs/etl_${year}.log" scripts/etl_year.sas
```

### SAS Script Receiving Year

```sas
/* Receive year from SGE via -sysparm */
%let year = &sysparm.;
%put NOTE: Processing year &year.;

/* Use in queries */
data want;
  set lib.source(where=(datadate between "01jan&year."d and "31dec&year."d));
  /* ... processing ... */
run;
```

### Critical: Parameter Passing

```bash
# GOOD — use -sysparm for SGE task parameters
qsas -sysparm "$year" script.sas

# BAD — -set is unreliable for SGE variables
qsas -set year "$year" script.sas    # Often fails silently

# BAD — %sysget is unreliable in SGE context
# %let year = %sysget(SGE_TASK_ID);  # May return blank
```

### Log Management

SGE jobs produce **three separate output streams** that must all be captured to `logs/`:

| Stream | Source | How to capture |
|--------|--------|---------------|
| **SGE stdout/stderr** | Shell script `echo`, error messages, SAS startup errors | `#$ -o logs/job.log -j y` or `qsub -o logs/ -j y` |
| **SAS log** | SAS `NOTE:`, `WARNING:`, `ERROR:`, macro resolution, step timings | `sas -log logs/script.log` |
| **SAS listing** | `PROC PRINT`, `PROC SQL` output, `PROC CONTENTS` | `sas -print logs/script.lst` |

**If you only set `#$ -o`, you only get SGE output.** SAS writes its log and listing to the working directory by default (or `$HOME` without `-cwd`) — not to SGE's stdout. You must explicitly route all three.

```bash
#!/bin/bash
#$ -cwd
#$ -j y                     # merge stderr into stdout

SCRIPT="$1"
SYSPARM="${2:-}"
mkdir -p logs

BASENAME=$(basename "$SCRIPT" .sas)
LOGNAME="logs/${BASENAME}"
[ -n "$SYSPARM" ] && LOGNAME="logs/${BASENAME}-${SYSPARM}"

# Route SAS log + listing to logs/ (prevents lock contention for parallel jobs)
if [ -n "$SYSPARM" ]; then
    sas -sysparm "$SYSPARM" -log "${LOGNAME}.log" -print "${LOGNAME}.lst" "$SCRIPT"
else
    sas -log "${LOGNAME}.log" -print "${LOGNAME}.lst" "$SCRIPT"
fi
```

For Python jobs, stdout/stderr go to SGE output directly — no separate routing needed:

```bash
#!/bin/bash
#$ -cwd
#$ -j y
mkdir -p logs
# -u for unbuffered output so SGE log updates in real time
pixi run python -u "$@"
```

**Key rules:**
- **Per-job log files** — never share a log file across parallel jobs (SAS write-locks its log)
- **`mkdir -p logs`** in the wrapper — job may be first to run on a fresh checkout
- **`-j y`** — always merge stderr into stdout; split streams are harder to correlate
- **Include sysparm in log name** — `logs/tfn-2019-2019.log` not `logs/tfn.log`
- **SAS log buffering** — SAS flushes logs in 64K blocks, not line-by-line; don't expect real-time updates like Python `-u`
- **Check SGE output too** — SAS startup failures (bad `/sastemp` permissions, missing libraries) appear in the SGE log, not the SAS log

### Memory Allocation

| Workload | Recommended Memory |
|----------|-------------------|
| Simple filtering/subsetting | `2G` |
| Hash merge (lookup < 1M rows) | `4G` |
| Hash merge (lookup 1-10M rows) | `8G` |
| Hash accumulator (many groups) | `8G` |
| Large PROC SQL joins | `16G` |

### Workflow: Benchmark Before Full Array

```bash
# Step 1: Test single year interactively
qsas -sysparm "2020" -log "logs/test_2020.log" scripts/etl_year.sas

# Step 2: Check log for errors and timing
grep -E "(ERROR|WARNING|real time)" logs/test_2020.log

# Step 3: If clean, submit full array
qsub scripts/etl_array.sh

# Step 4: Monitor
qstat -u $USER
```

---

## Project Organization Patterns

Patterns observed across multiple WRDS research projects (close, bank_pin, robo, muni, pass, pin-code).

### Paired .sas/.sh Files

Every SAS script gets a matching shell wrapper. The wrapper handles SGE directives, log routing, and parameter passing — the SAS script stays pure logic.

```
project/
├── close_trade.sas       # SAS logic
├── close_trade.sh        # SGE wrapper
├── mid.sas
├── mid.sh
├── fi.sas
├── fi.sh
└── logs/
```

```bash
# close_trade.sh — SAS wrapper
#!/bin/bash
#$ -cwd
sas -sysparm $1-$2 close_trade.sas -log logs/ctrade-$1-$2.log -print logs/ctrade-$1-$2.lst
```

```bash
# run_python.sh — Python wrapper using project-local pixi
#!/bin/bash
#$ -cwd
# -cwd ensures pixi resolves from the project's pixi.toml
pixi run python -u "$@"
```

**Why `#$ -cwd` matters:** Without it, SGE jobs run from `$HOME`. `pixi run` won't find `pixi.toml`, relative paths break, and `autoexec.sas` may not load. With `-cwd`, the job inherits the project directory — pixi environments, SAS scripts, and log directories all resolve correctly.

### Multi-Dimensional Sysparm

Pass multiple parameters via `-sysparm` with a delimiter, parse with `%scan`:

```sas
/* Receive year-month from sysparm (e.g., "2017-03") */
%let yyyy = %scan(&sysparm., 1, '-');
%let m = %scan(&sysparm., 2, '-');
%let mm = %sysfunc(putn(&m., z2.));  /* zero-pad month */
```

Use hyphens as delimiter — works with `%scan` and is visually clear in job names and log files.

### SGE Array vs Manual Qsub Loop

**Array job** (`#$ -t`) — SGE manages iteration. Best for uniform tasks (same script, different year):

```bash
#!/bin/bash
#$ -N bank_pin_taq
#$ -cwd
#$ -j y
#$ -t 2003-2024
mkdir -p logs
sas -sysparm $SGE_TASK_ID data.sas -log logs/data-$SGE_TASK_ID.log -print logs/data-$SGE_TASK_ID.lst
```

**Manual qsub loop** — shell manages iteration. Best when jobs have dependencies or non-uniform parameters:

```bash
for range in "2003-2010" "2011-2016" "2017-2018"; do
    JOB=$(qsub -N tfn_${range} -hold_jid "$PREREQ_JOB" \
        run_sas.sh tfn_holdings.sas "$range" | awk '{print $3}')
done
```

| Use | Array `#$ -t` | Manual qsub loop |
|-----|---------------|-------------------|
| Uniform year-by-year | Preferred | Works |
| Unequal year ranges | Can't do | Required |
| Job dependencies (hold_jid) | Only on whole array | Per-job control |
| Monitoring | `qstat` shows array | `qstat` shows individual jobs |

### Stack Pattern (Array → Concatenate → Export)

Array jobs write per-year datasets to `/scratch`. A final step concatenates and exports:

```sas
/* Stack yearly outputs using SAS name range (colon or hyphen) */
data all_results;
    set scratch.agreement_2003-scratch.agreement_2024;
run;

/* Or using wildcard prefix */
data all_results;
    set scratch.mf_own_:;  /* matches mf_own_2003_2010, mf_own_2011_2016, etc. */
run;

proc export data=all_results
    outfile="/scratch/nyu/hue/results.csv"
    dbms=csv replace;
run;
```

**Key:** The stack step runs as a separate qsub job with `hold_jid` on all array jobs, ensuring all pieces exist before concatenation.

### Shared SAS Macros in ~/sas/

Reusable macros kept in `~/sas/` and loaded with `%INCLUDE`:

| Macro | File | Purpose |
|-------|------|---------|
| `%MERGE_ASOF` | `~/sas/MERGE_ASOF.sas` | Backward as-of merge (most recent obs in B for each A) |
| `%CC_LINK` | `~/sas/CC_LINK.sas` | CRSP-Compustat linking with book equity |

```sas
%INCLUDE "~/sas/MERGE_ASOF.sas";
%MERGE_ASOF(a=events, b=ownership, merged=panel,
    idvar=permno, datevar=recorddate,
    num_vars=ior mf_pct passive_pct);
```

These macros are project-agnostic — they work with any dataset that has the required variables.

### Gzipped CSV Ingest

Read compressed CSV directly without decompressing to disk:

```sas
filename ZIPFILE ZIP "/scratch/nyu/hue/data_2020.csv.gz" gzip;
data raw;
    infile ZIPFILE delimiter=',' MISSOVER DSD firstobs=2;
    informat date ANYDTDTE9. amount BEST12. cusip $9.;
    format date B8601DA10.;
    input date amount cusip $;
run;
```

### TAQ Millisecond Data Pattern

TAQ data is partitioned by year-month with separate master and trade files:

```sas
/* Combine master files across year boundary for symbol continuity */
data mastm_&yyyy.;
    set taq.mast_%sysevalf(&yyyy.-1):
        taq.mast_&yyyy.:
        taq.mast_%sysevalf(&yyyy.+1):;
    SYM_ROOT = scan(SYMBOL, 1, ' ');
    SYM_SUFFIX = scan(SYMBOL, 2, ' ');
run;

/* Trade files use month suffix */
data trades / view=trades;
    set taqmsec.ctm_&yyyy.&mm.:;
run;
```

**Note:** TAQ master files must span year boundaries (prior + current + next year) to handle symbols that list/delist near year-end.

---

## PROC SQL Optimization

### Pass-Through SQL (Skip SAS Processing)

When querying WRDS PostgreSQL tables, pass-through avoids loading data into SAS first:

```sas
proc sql;
  connect to postgres (server="wrds-pgdata.wharton.upenn.edu"
                       port=9737 database=wrds user=&user.
                       password=&pass.);

  create table work.want as
  select * from connection to postgres (
    SELECT gvkey, datadate, at, sale
    FROM comp.funda
    WHERE indfmt = 'INDL' AND datafmt = 'STD'
      AND popsrc = 'D' AND consol = 'C'
      AND datadate BETWEEN '2015-01-01' AND '2020-12-31'
  );

  disconnect from postgres;
quit;
```

**Benefit:** Filtering happens on the PostgreSQL server — only matching rows transfer to SAS.

### Indexed Joins in PROC SQL

```sas
/* GOOD — join condition on indexed columns */
proc sql;
  create table want as
  select a.*, b.conm
  from lib.funda a
  inner join lib.company b
    on a.gvkey = b.gvkey;  /* gvkey is indexed */
quit;

/* BAD — function on join column prevents index */
proc sql;
  create table want as
  select a.*, b.conm
  from lib.funda a
  inner join lib.company b
    on substr(a.gvkey, 1, 6) = b.gvkey;  /* Index killed */
quit;
```

### Using `calculated` Keyword

```sas
/* BAD — re-evaluating expression in HAVING */
proc sql;
  select gvkey, sum(sale) as total_sale
  from lib.funda
  group by gvkey
  having sum(sale) > 1000;  /* Re-computes sum */

/* GOOD — reference the calculated alias */
proc sql;
  select gvkey, sum(sale) as total_sale
  from lib.funda
  group by gvkey
  having calculated total_sale > 1000;  /* Uses already-computed value */
quit;
```

### monotonic() for Row Numbers

```sas
/* Add row numbers without sorting */
proc sql;
  create table want as
  select monotonic() as rownum, *
  from lib.source;
quit;
```

**Note:** `monotonic()` is undocumented and unreliable with WHERE clauses or joins. Use only for simple sequential numbering on a single table.

---

## SAS Macro Patterns

### Safe Macro Variable Resolution

```sas
/* Always terminate macro variables with a period */
%let year = 2020;
libname out "/data/output_&year.";      /* Resolves to output_2020 */
libname out "/data/output_&year";       /* Also works but ambiguous */
libname out "/data/output_&year._final"; /* Period consumed by terminator — use: */
libname out "/data/output_&year._final"; /* _final is NOT a macro var, so this works */
```

### Quoting in Macro Context

```sas
/* Single quotes block resolution — double quotes allow it */
%let lib = mylib;
data "&lib..table";     /* Resolves: mylib.table */
data '&lib..table';     /* Literal: &lib..table — WRONG */

/* In hash output — ALWAYS double quotes */
h.output(dataset: "&lib..summary_&year.");
```

### Conditional Macro Logic

```sas
%macro etl(year=);
  %if &year. < 2010 %then %do;
    /* Legacy format */
    %let source = lib.legacy_&year.;
  %end;
  %else %do;
    /* Current format */
    %let source = lib.current_&year.;
  %end;

  data want_&year.;
    set &source.;
    /* processing */
  run;
%mend;
```

### Debugging Macros

```sas
options mprint mlogic symbolgen;  /* Show resolved macro code in log */
/* mprint: shows generated SAS statements */
/* mlogic: shows macro logic flow (IF/THEN/DO) */
/* symbolgen: shows macro variable resolution */

/* Turn off after debugging */
options nomprint nomlogic nosymbolgen;
```

---

## Pipeline Design Principles

1. **SAS should aggregate before handing off to Python.** If SAS outputs raw detail rows (millions per chunk), Python will OOM reading the SAS7BDAT files. Push CUSIP→PERMNO mapping, TSO joins, and final aggregation into SAS. Output the small analytical dataset, not intermediate holdings.
2. **Export fund-year level counts**, not pre-aggregated rates. Maximizes downstream flexibility.
3. **Parallelize by year** even when hash merge is fast. SGE array jobs are free parallelism.
4. **Balance year ranges by row count, not equal width.** Financial data volume grows over time — profile `SELECT year, COUNT(*) GROUP BY year` before choosing splits. S12 went from ~4M/yr (2003-2016) to ~20-26M/yr (2018-2024). Recent years need 1 year each; early years can be 6-8 year ranges.
5. **Avoid NFS contention on large SAS files.** Multiple parallel SAS jobs reading the same large NFS file (e.g., `tfn.s12` at 44GB) causes each to take ~40 min instead of ~5 min. Solution: read once via PostgreSQL (`PROC SQL; CONNECT TO POSTGRES`), write year-range partitions to `/scratch`, then parallel jobs read their own partition. See `split_s12.sas` in `examples/voting_ownership_pipeline/`.
6. **Use `/scratch` for inter-job data, not `/sastemp`.** `/sastemp` is per-node local disk — invisible to jobs on other grid nodes. Only `/scratch` (NFS-shared) works for passing data between SGE jobs.
7. **Benchmark single-year first** before submitting full array. Check log for errors and timing.
8. **One script per logical step.** Don't chain unrelated operations in a single SAS program. Use paired `.sas`/`.sh` files.
9. **Use shell wrappers for qsub with `#$ -cwd`.** Always use a `.sh` script with `#$ -cwd` rather than `qsub -b y sas script.sas`. The `-cwd` directive is critical: it sets the working directory to the project root, so the job can find project-local `pixi` environments (`pixi run python script.py`), relative script paths, and `autoexec.sas`. Without it, jobs run from `$HOME` and can't resolve any project-local paths.
10. **Use SGE array jobs for uniform tasks.** `#$ -t 2003-2024` is cleaner than a manual qsub loop when each task is the same script with a different year. Use manual loops only when tasks have dependencies or non-uniform parameters.
11. **Stack after parallel, then export.** Array jobs write per-year datasets to `/scratch`. A final hold_jid step concatenates with `SET scratch.prefix_:` and exports to CSV/parquet.
