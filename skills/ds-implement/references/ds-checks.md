# DS Common Checks

Shared check definitions for data quality verification. Referenced by ds-validate, ds-review, ds-fix, and ds-verify.

**Iron Law: Both entry and midpoint MUST Read() this file before evaluating data quality. Inlined copies will drift.**

## Check Matrix

| Check ID | Description | ds-validate | ds-review | ds-fix | ds-verify |
|----------|-------------|-------------|-----------|--------|-----------|
| DQ1 | Empty/constant columns | ✅ | ✅ | ✅ | ✅ |
| DQ2 | High-null columns (>50%) | ✅ | ✅ | ✅ | ✅ |
| DQ3 | Duplicate rows on key columns | ✅ | ✅ | ✅ | ✅ |
| DQ4 | Row count traceability (vs LEARNINGS.md) | ✅ | ✅ | ✅ | ✅ |
| DQ5 | Cardinality check on categoricals | ✅ | ✅ | ✅ | ❌ |
| DQ6 | Output-first verification (shape before/after) | ❌ | ❌ | ✅ | ✅ |
| COV | Sample-period coverage (each windowed source spans its Required window) | ✅ | ✅ | ✅ | ✅ |
| R1 | Reproducibility (same inputs → same outputs) | ❌ | ❌ | ❌ | ✅ |
| M1 | Spec compliance (all SPEC.md objectives addressed) | ✅ | ✅ | ✅ | ✅ |
| UNI | Universe agreement (every source admits the SAME entities) | ✅ | ✅ | ✅ | ✅ |
| DEN | Every reported rate states its denominator | ✅ | ✅ | ✅ | ✅ |
| DEL | Coverage improved because the BASE shrank | ✅ | ✅ | ✅ | ✅ |
| ENUM | Every check above RUN, or marked N/A with a reason | ✅ | ✅ | ✅ | ✅ |

## Data Quality Checks (DQ1-DQ6)

### DQ1: Empty/Constant Columns

Detect columns with zero information (useless data kept in analysis).

```python
for col in df.columns:
    if df[col].nunique() <= 1:
        print(f"WARNING [DQ1]: {col} is constant or empty ({df[col].nunique()} unique values)")
```

**Confidence if triggered:** >= 80 (report as issue)

### DQ2: High-Null Columns

Detect columns with >50% null values still present in analysis data.

```python
null_pct = df.isnull().mean()
high_null = null_pct[null_pct > 0.5]
if len(high_null) > 0:
    print(f"WARNING [DQ2]: Columns >50% null still in data:\n{high_null}")
```

**Confidence if triggered:** >= 80

### DQ3: Duplicate Rows / Grain Integrity

Three levels — DQ3 is NOT just `df.duplicated()`. An all-columns dup check is
unreliable in both directions: it misses amendments/restatements (one field changed),
and it reports ZERO duplicates after a join fan-out, because the fanned rows differ in
the joined columns — only the keyed check (a) reveals them. The same applies to
remediation: `drop_duplicates()` without `subset=` silently keeps fan-out rows.
PLAN.md must declare both the row primary key (`pk_cols`) and the coarser
business/event key (`event_cols`); this check verifies the grain and surfaces what
exact-row dedup misses.

```python
# pk_cols and event_cols come from PLAN.md (the declared grain, sourced from the
# dataset's reference skill — e.g. WRDS Form 4: pk=(dcn,seqnum), event=(personid,trandate,trancode,shares,price))

# (a) Row PK uniqueness — MUST hold; if not, an upstream join fanned out
pk_dupes = df.duplicated(subset=pk_cols).sum()
if pk_dupes > 0:
    print(f"FAIL [DQ3a]: {pk_dupes} rows violate the declared PK {pk_cols} (join fan-out?)")

# (b) Exact-duplicate rows (byte-identical ingestion artifacts)
exact = df.duplicated(keep=False)
if exact.sum() > 0:
    print(f"WARNING [DQ3b]: {exact.sum()} byte-identical duplicate rows")

# (c) Business/event-key collisions — same real-world event under >1 PK, NOT byte-identical.
#     Catches amendments/restatements (e.g. Form 4 4/A) that (a) and (b) both miss.
collisions = df.groupby(event_cols).size()
n_collide = (collisions > 1).sum()
if n_collide > 0:
    print(f"WARNING [DQ3c]: {n_collide} event keys appear >1x — check for amendments/restatements; "
          f"resolve by supersession (keep latest filing) not blind drop_duplicates")
```

**Confidence if triggered:** >= 80 for (a); >= 70 for (b)/(c) (may be legitimate multi-lot rows — confirm against the declared grain before dropping)

### DQ4: Row Count Traceability

Verify final row count matches the chain documented in LEARNINGS.md.

```python
print(f"Final row count: {len(df)}")
# Compare against LEARNINGS.md pipeline:
# raw → cleaned → joined → final
# Each step should show row count
```

**Confidence if mismatch:** >= 90 (critical — rows appeared or disappeared without explanation)

### DQ5: Cardinality Check

Detect categorical columns with suspicious cardinality.

```python
for col in df.select_dtypes(include='object').columns:
    n_unique = df[col].nunique()
    if n_unique > 0.9 * len(df):
        print(f"WARNING [DQ5]: {col} has near-unique cardinality ({n_unique}/{len(df)}) — likely an ID, not a category")
    if n_unique == len(df):
        print(f"INFO [DQ5]: {col} is fully unique — confirm this is a key, not a category used in groupby")
```

**Confidence if triggered:** >= 80

### DQ6: Output-First Verification

For each data operation, verify state before and after.

```python
print(f"Before: {df.shape}")
df = df.merge(other, on='key')
print(f"After: {df.shape}")
print(f"Nulls introduced: {df.isnull().sum().sum()}")
df.head()
```

**Required outputs by operation:**

| Operation | Required Output |
|-----------|-----------------|
| Load data | shape, dtypes, head() |
| Filter | shape before/after, % removed |
| Merge/Join | shape, null check, sample |
| Groupby | result shape, sample groups |
| Model fit | metrics, convergence |

### COV: Sample-Period Coverage

Verify every windowed data source (raw pull, cache, intermediate, master) covers the Required window of every task that reads it. This catches the silent-truncation trap: a source pulled for one task's window and reused by a task with a *wider* window, leaving the uncovered span with zero data — a truncated series still produces plausible numbers, so nothing fails loudly. Definition and gate: constraint C6 (`references/constraints/ds-sample-coverage.md`).

```python
# required = (start, end) for THIS source = union of the sub-windows of every task that
# reads it, taken from SPEC.md's "Sample Period & Coverage Requirements" table.
lo, hi = df[date_col].min(), df[date_col].max()
req_lo, req_hi = required  # e.g. ("2005-01-01", "2025-12-31")
if lo > pd.Timestamp(req_lo) or hi < pd.Timestamp(req_hi):
    print(f"FAIL [COV]: {source} covers {lo:%Y-%m}–{hi:%Y-%m} but is required to cover "
          f"{req_lo}–{req_hi}. Uncovered span has ZERO data. "
          f"Must be dispositioned in the coverage table (CLOSE=re-pull, or documented reason).")
```

**Confidence if triggered:** >= 85 unless the gap has an explicit disposition in SPEC/PLAN's coverage table (task genuinely doesn't need the span, or the vendor legitimately lacks it). An undispositioned gap is a high-confidence issue.

## Methodology Checks

### M1: Spec Compliance

Verify all objectives from .planning/SPEC.md are addressed in the analysis output.

- [ ] Each objective has corresponding output
- [ ] Success criteria can be verified against actual results
- [ ] Constraints were respected (especially replication requirements)
- [ ] Analysis answers the original question

## Reproducibility Checks

### R1: Fresh Re-Run

Execute analysis fresh (not from cache) and compare outputs.

```python
# Run 1
result1 = run_analysis(seed=42)
hash1 = hash(str(result1))

# Run 2
result2 = run_analysis(seed=42)
hash2 = hash(str(result2))

assert hash1 == hash2, "Results not reproducible!"
```

## How to Use in Subagent Prompts

When dispatching a review or verification subagent, reference checks by ID:

```
"Run checks DQ1-DQ5, COV, M1 from references/ds-checks.md on the final analysis data.
Report any WARNING as confidence >= 80."
```

This ensures both ds-review and ds-fix run identical checks from a single source of truth.

---

## UNI: Universe Agreement Across Sources

Every source must admit the **same entities**. `COV` asks whether each source spans
the window; `UNI` asks whether they agree about who is in it.

A universe predicate applied independently in more than one place is the defect.
It looks like local correctness and produces a global disagreement no single
script can see.

```python
# The universe is ONE declared object (PLAN.md), read by every leg.
UNIVERSE = {"start": "2003-01-01", "end": "2025-12-31",
            "entity_filter": "sharetype='NS' AND securitytype='EQTY' ..."}

# Then assert the legs agree, per source, on ENTITIES not just rows:
for name, src in sources.items():
    extra = set(src.entities) - set(primary.entities)
    missing = set(primary.entities) - set(src.entities)
    print(f"[UNI] {name}: +{len(extra):,} not in primary, -{len(missing):,} absent")
```

**Apply the filter where scope is decided, ONCE — not everywhere it is available.**
A filter on a *lookup* (a denominator, a crosswalk) is not scope, it is data loss.

> Measured instance: an ownership panel applied its universe predicate to the
> share-count lookup as well as the entity selection. 401,002 of 787,178 rows
> (50.9%) carried a null denominator — and **every one of them had a real
> numerator**, a holding the panel was declining to divide.
>
> Two teams then published opposite readings of that number, both defensible,
> because they measured **different artifacts**. At the intermediate table the
> nulls were manufactured by the filter. At the analysis panel there were *zero*
> null denominators, because a second source supplied one and the affected
> securities were mostly outside that source's universe anyway (12% pass-through
> vs 78% for unaffected ones). Neither reading was wrong; neither named its
> artifact. **State which table a coverage number is measured on** — "43.7% of
> rows are untestable" is not a property of a pipeline, it is a property of one
> step in it.
>
> The residue is the real finding: 1,512 entities that *never* get a denominator
> from the first source reach the panel via the second. They are **single-sourced,
> not unmeasured** — a third category both framings had collapsed away.

**Confidence if sources disagree:** >= 85

---

## DEN: Every Rate States Its Denominator

A percentage whose base is not printed beside it is not a finding. Report
`numerator/denominator = rate`, and state what the base excludes.

```python
n_flag, n_base, n_total = flagged.height, testable.height, df.height
print(f"[DEN] rate={n_flag:,}/{n_base:,}={100*n_flag/n_base:.3f}%")
if n_base < n_total:
    print(f"[DEN] base is {100*n_base/n_total:.1f}% of rows — "
          f"{n_total-n_base:,} are INVISIBLE to this check, not passing it")
```

**Also state the GROUPING KEY.** A rate computed at the wrong grain is not a
smaller error than a wrong numerator; it is a different statistic wearing the
right name.

> Measured instance: an ambiguity rate published as 0.010% was computed at
> `fundno`; the pipeline grouped at `wficn`. At the correct key the same quantity
> was ~180x larger. Two offsetting errors made the wrong number look like an
> independent reproduction of the right one.

**Confidence if a rate is reported without its base:** >= 80

---

## DEL: Coverage That Improved By Deletion

**A coverage metric can improve because the uncovered rows left.** This is the
most flattering possible way to lose data and reads as progress in every summary.

Any favourable move in a coverage/quality metric MUST be reported with the change
in its base:

```python
print(f"[DEL] coverage {before_pct:.1f}% -> {after_pct:.1f}%   "
      f"base {n_before:,} -> {n_after:,} ({100*(n_after-n_before)/n_before:+.1f}%)")
if after_pct > before_pct and n_after < n_before:
    print("[DEL] WARNING: coverage rose while the base SHRANK — "
          "confirm rows were fixed, not dropped")
```

> Measured instance: adding a share-class filter to a crosswalk raised
> "testable" from 56.0% to 98.9% — by deleting 41% of the rows. The uncovered
> rows had not acquired the missing field; they had been removed. The metric that
> caught it was the one printing its own denominator.

**Confidence if coverage rises while base falls:** >= 90

### DEL in its time-series form: the base moves on its own

A coverage share quoted as a single number is a **sample average over a trend**, and
the trend is usually the finding. Print coverage per period before quoting it once.

```python
print(df.group_by("year").agg(
    pl.len().alias("n"),
    (100 * pl.col("no_denom").mean()).round(1).alias("pct_uncovered")).sort("year"))
```

> Measured instance: an "43.7% untestable" figure was carried through a project as a
> constant. Per year it ran 37.7% → 63.8%, monotone, never reversing — a 26pp drift in
> how much of the reported population was measurable at all. Two sessions quoting
> 43.7% and 50.9% were both correct; they had averaged over different windows. Every
> ratio in the study inherited that drift, so a level change and a coverage change were
> not separable in any before/after comparison.

**A before/after on a ratio must report the base's coverage at BOTH ends.**

**Confidence if a coverage share is quoted without its per-period profile:** >= 80

---

## ENUM: Every Check Run, Or Explicitly Not Applicable

Silence is indistinguishable from a pass. A check that is simply absent from the
output looks exactly like one that ran clean.

Emit a line for **every** check in the matrix. A check with no applicable input
says so, and why:

```
[ENUM] DQ1 run  DQ2 run  DQ3 run  DQ4 run  DQ5 run  COV run  UNI run
[ENUM] N/A: DQ6 (no before/after shape — single-pass build)
[ENUM] N/A: R1  (reproducibility is a verify-phase check)
```

> Measured instance: a pipeline's own SKILL.md said timed runs should include the
> detector sweep. Nothing referenced the detector module at all, so every runtime
> ever quoted described a dataset of unmeasured quality. Once wired, the sweep ran
> 7 of 17 available detectors — the seven that happened to be familiar. Four of
> the other ten fired immediately.

**Confidence if a matrix check produced no line:** >= 85
