# ISS Voting + Institutional/Mutual Fund Ownership Pipeline

All-SAS pipeline for building a meeting-level panel with proxy voting outcomes and ownership data. Runs on WRDS SGE grid with maximum parallelism.

## One command

```
Workflow({ name: 'npx-ownership-pipeline',
           args: { wrdsProjectDir: '~/projects/pass', outLib: '/scratch/<school>/<user>/npx' } })
```

`workflows/npx-ownership-pipeline.js` coordinates all four data legs and emits
the analysis-ready panel:

| Output | Grain | What it is |
|---|---|---|
| **`out.pass_npx`** | **`(itemonagendaid, block)`** | **the deliverable** — item-level ownership panel JOINED to each item's per-block observed For/Against/Abstain split |
| `out.pass` | `itemonagendaid` | the item-level ownership panel alone (unchanged) |

The join happens **on the grid**, in `merge_panel.sas`. Nothing is left to be
merged locally — shipping the joined result is the point.

The four legs, and their real dependency structure:

| # | Leg | Source | Depends on |
|---|---|---|---|
| 1 | S12 mutual-fund holdings | `split_s12.sas` → `tfn_holdings_parallel.sas` ×9 | — |
| 2 | Institutional holdings | `build_inst_own.sas` (Thomson S34) **+** EDGAR 13F scrape (`skills/wrds/scripts/parse_13f/`) | — |
| 3 | N-PX fund votes | `build_npx.sas` × 21 (SGE array) | **leg 4** |
| 4 | ISS→CRSP crosswalk | `npx_linking/` → `stage_npx_link.sas` | — |

Legs 1, 2 and 4 start together. **Leg 4 hard-gates leg 3**: the array hash-merges
the crosswalk, and without it every task opens a missing dataset and exits 0
having written nothing. A leg that fails verification stops its own branch
without killing the others.

Leg 2 has **two sources for one quantity**. Thomson S34 decayed after 2013 and
undercounts; the EDGAR scrape exists for that reason. **EDGAR wins where present,
S34 is fallback-only, and they are never blended** — the workflow asserts that no
manager-quarter carries both.

The workflow **coordinates and verifies; it does not execute SAS.** Every leg
runs on the grid over ssh: the agents `qsub`, poll `qstat`, then read logs and
datasets to assert concrete row counts. No leg is believed because its job exited
0 — during development an array lost a task to a node eviction and still reported
clean, producing 20 of 21 outputs with no error anywhere.

The two shell orchestrators still work and are the fallback if you want to drive
a single leg by hand: `run_pipeline.sh` (item level) and `run_npx_pipeline.sh`
(fund level). They cannot see each other, which is why the workflow exists.

## One universe, asserted

`pipeline_config.sas` declares the date window, the meeting-type list and the
vote-result list **once**. `build_meetings.sas` (ownership leg) and
`stage_npx_link.sas` (N-PX leg) both `%include` it; neither may re-declare them.

This is not tidiness. Before it, the two legs carried their own filters:

```
build_meetings.sas    2003-2024, voteresult in ('Pass','Fail'), 5 meetingtypes
stage_npx_link.sas    2005-2025, no voteresult filter, no meetingtype filter
```

Nothing detected the disagreement, and this project has already widened its
meeting-type filter once — which changes the item universe. Two things now make
divergence impossible rather than merely detectable:

1. **Workflow preflight** compares the declared universe against
   `pipeline_config.sas` on the grid and **refuses to start any leg** if they
   differ.
2. **`merge_panel.sas` asserts** that every item in `out.meetings` exists in
   `out.npx_items` and calls `abort abend` if not. It **fails**, it does not warn.

(The reverse containment is expected: `build_meetings.sas` additionally drops
records with an unusable `base`, turnout > 120, and `votedFor <= 0` with `'Pass'`,
so `npx_items` is a superset. That difference is reported, not asserted.)

The N-PX leg is documented in [its own section below](#fund-level-n-px-leg).

## Architecture

```
Step 1 (all parallel):
┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  ┌───────────────┐
│ build_meetings  │  │ build_inst_own   │  │ build_mflinks  │  │   split_s12   │
│    (~12 sec)    │  │    (~3 min)      │  │    (~1 min)    │  │   (~15 min)   │
└────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │ (PG read →   │
         │                    │                    │           │  /scratch)    │
         │                    │                    │           └──────┬────────┘
         │                    │                    └─────┬────────────┘
         │                    │                          │
         │                    │         ┌────────────────▼───────────────────┐
         │                    │         │ tfn_holdings_parallel.sas ×9      │
         │                    │         │ (reads /scratch, zero contention) │
         │                    │         │      (~5 min each)               │
         │                    │         └────────────────┬──────────────────┘
         │                    │                          │
         └────────────────────┼──────────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │   merge_panel.sas   │
                   │  (MERGE_ASOF all)   │
                   │     (~5 sec)        │
                   └─────────────────────┘

Total wall time: ~20 min
```

## Files

| File | Language | Purpose |
|------|----------|---------|
| `run_pipeline.sh` | bash | SGE orchestration — submits all jobs with hold_jid dependencies |
| `run_sas.sh` | bash | SGE wrapper for SAS scripts (supports -sysparm) |
| `build_meetings.sas` | SAS | ISS vote results → turnout/forpct → CRSP permno + CIK → out.meetings |
| `build_inst_own.sas` | SAS | S34 13-F → cfacshr adjustment → IO metrics (DBREADTH, HHI, AUM) → out.inst_own |
| `build_mflinks.sas` | SAS | Build mfl2/mfl3 prereqs for TFN jobs |
| `split_s12.sas` | SAS | Read S12 via PostgreSQL, write year-range partitions to /scratch |
| `tfn_holdings_parallel.sas` | SAS | Partitioned S12 → MFLINKS → CUSIP→PERMNO → TSO → aggregate → out.mf_own_YYYY_YYYY |
| `merge_panel.sas` | SAS | Concatenate MF chunks + MERGE_ASOF all inputs → `out.pass`; stack + re-aggregate N-PX cells, **assert one universe**, join → `out.pass_npx` |
| `pipeline_config.sas` | SAS | **The universe** — date window, meeting types, vote results. Both legs `%include` it |

### Python alternatives (kept for reference)

| File | Purpose |
|------|---------|
| `build_votes.py` | PostgreSQL version of build_meetings (simpler, fewer variables) |
| `build_inst_own.py` | PostgreSQL version of build_inst_own (no DBREADTH/HHI/AUM) |
| `merge_panel.py` | pandas merge_asof version (parquet I/O) |
| `sas_to_parquet.py` | Concat SAS outputs to parquet (only needed for Python merge) |
| `run_python.sh` | SGE wrapper for Python (unbuffered output) |
| `run_mflinks.sh` | Legacy SGE wrapper for mflinks |

## Usage

```bash
# Copy to WRDS project directory
scp -r voting_ownership_pipeline/* wrds:~/projects/myproject/

# Ensure autoexec.sas is set up with libnames (out, tfn, crsp, mfl, risk, wrdssec)
# And ~/sas/MERGE_ASOF.sas exists

# Run the full pipeline
ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh"

# Monitor
ssh wrds "qstat -u $USER"
```

## Key Design Decisions

1. **All SAS for data building.** SAS streams from disk (no memory management), the crspmerge macro handles CRSP extraction reliably, and the original logic includes cfacshr share adjustment, DBREADTH (Lehavy & Sloan 2008), and IOC_HHI that the Python versions omitted.

2. **SAS aggregates before merge.** The TFN script does CUSIP→PERMNO mapping, TSO joins, and permno-quarter aggregation. Output is ~50K rows per chunk, not millions of raw holdings.

3. **PostgreSQL for large NFS reads.** `tfn.s12` (44GB SAS file on NFS) causes severe I/O contention when read by multiple parallel jobs (~40 min each vs ~5 min solo). `split_s12.sas` reads it once via WRDS PostgreSQL (`tr_mutualfunds.s12`), writing year-range partitions (~40GB total) to `/scratch`. Each TFN job then reads its own partition with zero contention. Note: WRDS PostgreSQL schema names differ from SAS libnames (`tfn.s12` → `tr_mutualfunds.s12`, `tfn.s34` → `tr_13f.s34`).

4. **Year ranges balanced by row count.** S12 data exploded from ~4M rows/year (2003-2016) to ~20-26M rows/year (2018-2024). Ranges are sized so each chunk is ~22-34M rows: early years get 6-8 year ranges, recent years get 1 year each.

5. **Shell wrappers for all qsub jobs.** Always use `.sh` with `#$ -cwd`, never `qsub -b y sas script.sas`.

6. **Maximum parallelism.** meetings, inst_own, mflinks, and split_s12 all start simultaneously. TFN holdings (9 jobs) start after mflinks + split_s12 finish. Merge waits for everything.

## Customization

- **Date range:** Edit `%let year1/year2` in each SAS script, year ranges in `split_s12.sas`, and `YEAR_RANGES` in `run_pipeline.sh`
- **Output library:** Controlled by `autoexec.sas` (libname `out`)
- **Additional ownership variables:** Edit the aggregation step in `tfn_holdings_parallel.sas`
- **MERGE_ASOF path:** Edit the `%INCLUDE` in `merge_panel.sas`

---

# Fund-level N-PX leg

The pipeline above builds the **item-level** panel. It had no **fund-level** leg —
who each fund voted for on each item. This adds it.

```
npx_link_to_csv.py ──► npx_link.csv ──scp──► stage_npx_link.sas ──► out.npx_link  (27K)
  (local, from the                                              └──► out.npx_items (849K)
   ISS→CRSP crosswalk)                                                    │
                                                                          ▼
                                       run_npx_array.sh: build_npx.sas × 21
                                       (one SGE task per year, SGE_TASK_ID IS the year)
                                       329 GB source, hash-merged and reduced IN PLACE
                                                          │
                                                          ▼
                                       npx_cells_to_parquet.py  ──► 2,254,660 cells, 20.8 MB
                                                          │
                                                        1 scp
                                                          ▼
                                                    your laptop
```

## Credit

**The year-parallel array + hash-merge design is not new.** It is adapted from
`npx_agreement.sas` / `npx_agreement.sh` in the *robo* project, which already ran
`#$ -t 2003-2020` over `risk.voteanalysis_npx` with an ISS-recommendation hash
keyed on `itemOnAgendaID`, and already carried the index-friendly-`where=` fix.
Two things change here:

| | original | here |
|---|---|---|
| hash payload | `scratch.iss_recs` (item → ISS rec) | `out.npx_link` (fundid → block) |
| accumulator key | `(fundid, year)` / `(institutionid, year)` | `(itemonagendaid, block)` |

That leg was orphaned in another project, which is why the mirror project ended
up shipping 144,376,253 rows to a local machine for want of it.

## Files

| File | Language | Purpose |
|---|---|---|
| `run_npx_pipeline.sh` | bash | Orchestration — stage → array → parquet, with `hold_jid` |
| `npx_link_to_csv.py` | Python | **Local.** Crosswalk parquet → CSV for SAS (with label-length/comma guards) |
| `stage_npx_link.sas` | SAS | Stage the two hash inputs: crosswalk + item universe |
| `run_npx_stage.sh` | bash | SGE wrapper for the staging step |
| `build_npx.sas` | SAS | **The array task.** One year, hash-merge, accumulate to cells |
| `run_npx_array.sh` | bash | SGE array wrapper; `-t` takes the year range |
| `npx_cells_to_parquet.py` | Python | Stack + re-aggregate + reconcile → one parquet |
| `pull_npx_items.py` | Python | **Local.** The 849K-row item table + fund names, pulled once |
| `npx_linking/` | Python | Building the crosswalk itself — see its README |

## Usage

```bash
# 0. Build the crosswalk locally (npx_linking/), then export + push it
./npx_link_to_csv.py --in npx_crsp_link.parquet --out npx_link.csv
scp npx_link.csv *.sas *.sh *.py wrds:~/projects/myproject/

# 1. TEST BEFORE SCALING — two years first
ssh wrds "cd ~/projects/myproject && bash run_npx_pipeline.sh 2023 2024"

# 2. Full panel
ssh wrds "cd ~/projects/myproject && bash run_npx_pipeline.sh 2005 2025"

# 3. Reconcile without opening 21 logs
ssh wrds "grep -h NPXSTAT ~/projects/myproject/logs/build_npx_*.log"

# 4. One transfer back
scp wrds:/scratch/<school>/<user>/npx/npx_block_direction.parquet .

# 5. The item-level attributes to join the cells against (local, ~15s)
./pull_npx_items.py --items --out items.parquet
```

## Benchmark — measured 2026-07-25, not estimated

Baseline: `pull_npx_v2.py`, sequential year-by-year PostgreSQL pull to a local
machine. **~35 min (2,100 s)** for 21 years, 144,376,253 rows, ~304 MB parquet.

| Approach | Wall | Bytes back | Rows back |
|---|---:|---:|---:|
| Sequential local PostgreSQL pull (baseline) | **2,100 s** | 304 MB | 144,376,253 |
| PostgreSQL narrow semi-join, 21-task grid array | ~340 s* | ~90 MB | 144,375,860 |
| **SAS array, aggregate on the grid** | **839 s** | **20.8 MB** | **2,254,660 cells** |
| — same, excluding one straggler node | **~234 s** | | |

\* extrapolated from measured single-year narrow pulls (2023: 162 s, 2024: 142 s);
only the 2-year smoke test was run at that tier.

**So: ~2.5x faster as measured end-to-end, ~9x on healthy nodes, and it returns
15x fewer bytes in the form the analysis actually consumes.**

Per-task wall times were **8 s (2005) to 74 s (2024)**, summing to 1,615 s — that
is what this would cost sequentially *on the grid*. SGE ran ~10 tasks
concurrently, not 21, so the array does not achieve a full 21x.

### The straggler — read this before quoting the fast number

One task (2020) took **742 s against a 60 s median**, on `wrds-sas36`. It hung
during autoexec libname assignment, produced no error, and eventually completed.
That single task is the difference between 234 s and 839 s.

Two consequences, both already handled:

- **Never quote the best-case wall.** A 21-task array over shared NFS will have a
  straggler often enough that ~14 min is the honest planning number.
- **A task can vanish silently.** During this run the 2020 output was missing
  while the array reported clean. `npx_cells_to_parquet.py --expect-years`
  turns that into a hard failure instead of a panel quietly missing a year.
  Re-run one year with `qsub -t 2020-2020 run_npx_array.sh`.

### Reconciliation

```
PASS reconciliation: 144,375,860 == expected
  2,254,660 cells, 20.8 MB, 64x reduction
  unlinked vote rows: 598 (0.00%)
```

The assembled cells account for **exactly** the PostgreSQL semi-join row count
for 2005–2025. Note the target is the **semi-join** count (144,375,860), not the
**inner-join** count (144,376,253) — see below.

## Why this design

### 1. Do not ship the rows

The joined result carries item-level columns (`cusip`, `sponsor`, `voteresult`,
`meetingtype`, `mgmtrec` — avg 33.7 text bytes) with only **848,736 distinct
values**, replicated across **144,376,253 rows**: ~170x redundant. And the
analysis does not want rows at all — it wants per-`(item, block)` For/Against/
Abstain cells, which are 2.25M rows. **64x reduction.**

The only reason that aggregation was ever done locally is that the `fundid →
block` assignment lives in a locally-built crosswalk. That crosswalk is 26,686
rows / 660 KB. **Push it up.**

### 2. The date range is not the analysis universe

| Filter | Rows |
|---|---:|
| `n.meetingdate` in 2005–2025 | 237,057,808 |
| items present in `vavoteresults` (semi-join) | 144,375,860 |
| same via `INNER JOIN` | 144,376,253 |

The 92.7M difference is N-PX rows whose item has no US vote-results record
(non-US meetings, items ISS never scored). **Partitioning on the date alone
inflates every block's denominator by ~64%.** `out.npx_items` (848,506 keys)
restores the intended universe in the same pass — exactly as the original's
`iss.find()` did, which was a lookup *and* a semi-join filter.

### 3. The hash cannot fan out; the INNER JOIN can

`vavoteresults` is **not unique on `itemonagendaid`**: 848,736 rows / 848,506
distinct in-window (230 `Pending`+final versioning pairs). An `INNER JOIN`
therefore multiplies the N-PX side by 393 rows. A hash keyed on
`itemonagendaid` holds one entry per key and structurally cannot.

### 4. Index-friendly `where=`

`meetingdate between "01jan&year."d and "31dec&year."d` uses
`voteanalysis_npx.sas7bndx` (15 GB). `year(meetingdate) = &year.` applies a
function to the indexed column, defeats the index, and makes every task
full-scan **329 GB**. The original already carried this fix; do not regress it.

Consequence worth noting: because the index makes each task read only its own
year, 21 concurrent readers of one 329 GB NFS file did **not** hit the
contention that `split_s12.sas` exists to avoid for `tfn.s12`. No pre-split step
is needed here.

### 5. SAS-specific traps encountered

- **Hash data variables RETAIN on a `find()` miss.** The miss branch must reset
  them explicitly, or every unlinked fund inherits the previous fund's block.
- **Use assignment (`n_for = n_for + 1`), never the sum statement (`n_for + 1`),
  inside a hash accumulator.** The sum statement retains across the whole step,
  independent of which hash entry you are on, and smears one cell's counts into
  the next.
- **`linesize=100` silently truncates a wide `put`** mid-number. One fact per
  `put` line — that is how the `unlinked` coverage metric disappeared from the
  log on the first run.
- **`qsub -v` sets shell env vars, which SAS macro code cannot see.** Pass
  parameters via `-sysparm` and `%scan` them.
- **`%let x = %sysfunc(coalescec(&x., default))` is not a defaulting idiom** —
  when `x` is undefined it is a recursive self-reference and errors. Put the
  `%if` inside a macro; open-code `%IF` fails with "Expected %DO not found".
- **`select ... into :mvar format=comma12.`** makes the value unusable in
  `%EVAL`. Use `trimmed` for anything you will do arithmetic on.

### 6. Cells can straddle year partitions

4 `itemonagendaid`s carry N-PX rows in more than one meeting year (restated
filings), so their cells arrive split across two task outputs.
`npx_cells_to_parquet.py` **re-aggregates** on `(itemonagendaid, block)` rather
than plain-concatenating, and asserts the grain is unique.

## Output schema

`npx_block_direction.parquet` — grain `(itemonagendaid, block)`, 2,254,660 rows.

| Column | Meaning |
|---|---|
| `itemonagendaid`, `block` | the grain |
| `n_rows` | vote rows in this cell |
| `n_for` / `n_against` / `n_abstain` / `n_other` | unweighted direction counts |
| `sv_for` / `sv_against` / `sv_abstain` | `sharesvoted`-weighted sums |
| `tna_for` / `tna_against` / `tna_abstain` | `tna_latest`-weighted sums |
| `n_no_sv` / `n_no_tna` | rows carrying **no** weight — the residual each weighting silently excludes |
| `part_year` | meeting year of the task that produced the cell |

`Withhold` folds into `Against` (on director elections it *is* the
against-equivalent). Frequency votes (`One Year`/`Two Years`/`Three Years`) and
proxy-contest card labels (`Do Not Vote`/`None`) land in `n_other` — **counted,
never dropped.**

**Always publish `n_no_sv` / `n_no_tna` alongside any weighted split.**
`sharesvoted` is 0% populated pre-2023, ~15% in 2023, 96% in 2024+ (gotcha #10 in
`references/iss-voting.md`), so a share-weighted 2019 figure looks precise and is
computed from nothing.

## See also

- [`references/npx-crsp-linking.md`](../../references/npx-crsp-linking.md) — building the crosswalk (the hard half)
- [`references/iss-voting.md`](../../references/iss-voting.md) — the tables themselves
- [`references/postgres-vs-sas.md`](../../references/postgres-vs-sas.md) — when to use which engine

---

# Engine choice per leg: native SAS vs PostgreSQL

**Every source table in this pipeline is indexed on both sides.** Check before
choosing, and beware how easy it is to check wrongly:

```bash
ls -la /wrds/<lib>/sasdata/<ds>/           # NO head — see the warning below
```
```sql
SELECT indexname FROM pg_indexes WHERE tablename = '<table>';
```

> **Do not pipe the listing through `head`.** Both of the checks that concluded
> "`tfn.s12` has no SAS index" were truncated: `ls … | head -6` cut at exactly
> six lines and the index was line seven; `find … -name '*.sas7bndx' | head -12`
> filled all twelve lines with hits from another directory, so `s12/` never
> printed. Absence of output from a truncated command is not evidence of
> absence. The listing even showed `total 109843524` — 104 GB against a 44 GB
> data file — and the unexplained 60 GB *was* the index.

| Table | SAS data | SAS index | Engine shipped |
|---|---:|---:|---|
| `risk.voteanalysis_npx` | 329 GB | **15 GB** | native — proven, 21 tasks, 839s |
| `risk.vavoteresults` | 836 MB | **52 MB** | native — SAS copy verified `==` PG |
| `tfn.s34` | 21.6 GB | **8.0 GB** | native |
| `tfn.s12` | 47.4 GB | **19.6 GB** | PostgreSQL — **see below** |

Index presence alone does not decide the engine. `tfn.s12` is indexed and its
native read measures *faster*, and it still ships on PostgreSQL — for a reason
that is about identity, not speed.

## The S12 read path — measured, not inferred

This leg has been argued both ways. The measurements, 2026-07-25:

**`tfn.s12` IS indexed.** Two independent checks:

```
$ ls -la /wrds/tfn/sasdata/s12/
-rw-r----- wrdsadmn 47,389,081,600  s12.sas7bdat
-rw-r----- wrdsadmn 19,589,038,080  s12.sas7bndx     <-- 19.6 GB index

proc contents data=tfn.s12 out2=... ;
  INDEXES: cusip · fdate · rdate_cusip · rdate_fundno · ticker
```

`rdate_cusip` and `rdate_fundno` are composite indexes **led by `rdate`**, which
is the column `split_s12.sas` filters on, and `fdate` is a simple index.

**Nine concurrent native reads do not contend.** One SGE task per partition,
each `set tfn.s12(where=(rdate between …))`, all nine running together:

| Range | wall | Range | wall | Range | wall |
|---|---:|---|---:|---|---:|
| 2003-2010 | 375s | 2019 | 259s | 2022 | 131s |
| 2011-2016 | 134s | 2020 | 293s | 2023 | 107s |
| 2017-2018 | 134s | 2021 | 339s | 2024 | 141s |

**Wall = 375s** (all concurrent), against **910s** for the sequential PG path.
Row counts were **identical to the PG path on all nine partitions**
(34,212,190 · 27,141,268 · 29,551,018 · 22,369,087 · 23,985,898 · 25,693,786 ·
26,528,617 · 25,076,427 · 22,936,627), so the universe does not move.

This contradicts the README's original rationale — *"tfn.s12 (44GB SAS file on
NFS) causes severe I/O contention when read by multiple parallel jobs (~40 min
each vs ~5 min solo)"*. That incident is real but it is **not reproduced here**,
and the likely reason is the same one the N-PX leg documents: a `where=` that
defeats the index full-scans, while an index-friendly `BETWEEN` on date literals
does not. 375s for nine concurrent readers of a 47.4 GB file is not contention.

**What is still shipped, and why.** The pipeline keeps the PostgreSQL read.

Both stories about *why* were wrong. The README's original rationale — NFS
contention — does not reproduce. The later correction — that `tfn.s12` lacks a
SAS index and therefore needs PG — is false; the index is 19.6 GB and is listed
above. Neither claim survives measurement.

What is true is narrower: the native path is **2.4x faster and measured**
(375s vs 910s, identical row counts on all nine partitions), and it has **not
been identity-tested**. Row counts matching is necessary, not sufficient. PG
numeric conversion and a native SAS datastep read can land a weighted fraction
one ULP apart, and a weighted `for_frac` is exactly the value most likely to
move. So PG is retained on an evidence-based hold with an explicit reopen
condition:

> **Reopen when:** `canonical_dump.sas` + `canonical_hash.py` show the native
> path reproducing the frozen `out.pass_npx` hash at 12 significant digits.
> Upside is 535s plus eliminating ~41 GB of scratch staging.

**The uncontested S12 win, now implemented.** The nine PG extracts were nine
independent, disjoint, indexed queries executed *sequentially in one job*.
`run_s12_array.sh` makes them an SGE array. `-tc 6` is load-bearing, not tuning:

```sql
SELECT rolconnlimit FROM pg_roles WHERE rolname = current_user;   -- 7
```

Each task opens its own connection, so nine concurrent exceeds the per-role cap.
A refused connection is not reliably a loud error, so the failure mode is a
**silently missing partition**. Two guards close that:

- `tfn_holdings_parallel.sas` no longer silently falls back to a full `tfn.s12`
  scan when its partition is absent — that produced plausible output from a
  47.4 GB scan and hid the gap. It aborts unless `S12_ALLOW_FULLSCAN=1`.
- `merge_panel.sas` counts partitions against `S12_RANGES` and aborts on any
  missing, because a missing partition shows up as an ownership-*column* gap
  that the item-universe assertion cannot see.
