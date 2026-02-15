# SAS ETL Performance Patterns on WRDS

Reference for writing efficient SAS code on the WRDS cloud (SAS Grid / SGE cluster). Every pattern here exists because the naive alternative is 10-100x slower or silently prevents index usage.

## Contents

- [Hash Object Merge](#hash-object-merge) - O(1) lookup, no sorting required
- [Hash Accumulator](#hash-accumulator) - Aggregate without PROC MEANS
- [Index-Friendly WHERE Clauses](#index-friendly-where-clauses) - The #1 performance mistake
- [SGE Array Jobs](#sge-array-jobs) - Year-parallel processing on WRDS grid
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

```bash
# GOOD — per-year log files avoid lock contention
#$ -o logs/etl_$TASK_ID.log

# BAD — single log file causes write contention across parallel tasks
#$ -o logs/etl.log
```

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

1. **SAS = ETL only.** Merge, aggregate, export. Move all filtering and analysis to downstream notebooks (Python/R).
2. **Export fund-year level counts**, not pre-aggregated rates. Maximizes downstream flexibility.
3. **Parallelize by year** even when hash merge is fast. SGE array jobs are free parallelism.
4. **Benchmark single-year first** before submitting full array. Check log for errors and timing.
5. **One script per logical step.** Don't chain unrelated operations in a single SAS program.
