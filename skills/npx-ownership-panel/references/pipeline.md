# ISS Voting + Institutional/Mutual Fund Ownership Pipeline

Grid pipeline for building a meeting-level panel with proxy voting outcomes and
ownership data. Runs on the WRDS SGE grid with maximum parallelism. Most legs are
SAS; legs 2 and 5 are Python.

## One command

```bash
scp -r scripts/* wrds:~/projects/myproject/     # + npx_link.csv (see below)
ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh"
```

`run_pipeline.sh` is **the only entry point**. It submits the whole DAG with
`qsub -hold_jid` and returns — SGE sequences the chain, nothing local stays
alive. There is no second orchestrator and no second DAG: an earlier version of
this skill shipped two shell drivers plus a JS workflow that could not see each
other, which is exactly how a leg gets run twice under different filters.

| Output | Grain | What it is |
|---|---|---|
| **`out.pass_npx`** | **`(itemonagendaid, block)`** | **the deliverable** — item-level ownership panel JOINED to each item's per-block observed For/Against/Abstain split |
| `out.pass` | `itemonagendaid` | the item-level ownership panel alone |

The join happens **on the grid**, in `merge_panel.sas`. Nothing is left to be
merged locally — shipping the joined result is the point.

The legs, and their real dependency structure:

| # | Leg | Source | Depends on |
|---|---|---|---|
| 1 | S12 mutual-fund holdings | `run_s12_array.sh` → `split_s12_one.sas` ×N → `tfn_holdings_parallel.sas` ×N | `build_mflinks.sas` |
| 2 | Institutional holdings | `build_inst_own.py` (SEC EDGAR 13F) → `import_inst_own.sas` | **leg 5** |
| 3 | N-PX fund votes | `run_npx_array.sh` → `build_npx.sas` × 21 (SGE array) | **leg 4** |
| 4 | ISS→CRSP crosswalk | `npx_linking/` → `npx_link_to_csv.py` → `stage_npx_link.sas` | — |
| 5 | Short interest | `build_short_interest.py` — `comp.sec_shortint` × CCM, feeds `ior_net` | — |
| A | Item-level vote results | `build_meetings.sas` | — |

Legs A, 1, 2/5 and 4 start together. **Leg 4 hard-gates leg 3**: the array
hash-merges the crosswalk, and without it every task opens a missing dataset and
exits 0 having written nothing. **Leg 5 gates leg 2**: `build_inst_own.py` nets
securities lending out of ownership, so the short-interest table must exist first.

Leg 2 has **two sources for one quantity, and they are NOT interchangeable**.
Thomson S34 decayed after 2013 and undercounts; the EDGAR scrape exists for that
reason. **EDGAR is canonical and carries every data-quality fix**;
`build_inst_own.sas` (Thomson S34) is fallback-only, is deliberately **not** in
the DAG, and the two are never blended. See SKILL.md for why they correctly use
different `cfacshr` join dates (`rdate` for EDGAR, `fdate` for Thomson).

**No leg is believed because its job exited 0.** `-hold_jid` releases a dependent
job when its predecessor *finishes*, regardless of exit status, and bash cannot
close that gap — during development an array lost a task to a node eviction and
still reported clean, producing 20 of 21 outputs with no error anywhere. So the
verification lives in `merge_panel.sas`, which counts the datasets each leg was
supposed to produce and `abort abend`s if any is missing. That holds for a plain
unsupervised `bash run_pipeline.sh` with no harness of any kind, which is the
whole point.

## One universe, asserted

`pipeline_config.sas` declares the date window, the meeting-type list, the
vote-result list and the S12 partition ranges **once**. `build_meetings.sas`
(ownership leg) and `stage_npx_link.sas` (N-PX leg) both `%include` it; neither
may re-declare them. `run_pipeline.sh` `sed`s `S12_RANGES` out of the same file
rather than carrying its own copy.

This is not tidiness. Before it, the two legs carried their own filters:

```
build_meetings.sas    2003-2024, voteresult in ('Pass','Fail'), 5 meetingtypes
stage_npx_link.sas    2005-2025, no voteresult filter, no meetingtype filter
```

Nothing detected the disagreement, and this project has already widened its
meeting-type filter once — which changes the item universe. Two things now make
divergence impossible rather than merely detectable:

1. **`run_pipeline.sh` preflight** fails before submitting anything if a script,
   the crosswalk CSV, the EDGAR holdings directory, `~/.pgpass`,
   `~/sas/MERGE_ASOF.sas`, `../src/wrds_pull.py`, or the Python packages legs 2
   and 5 need are absent. Its script list is exactly what the DAG submits or
   reaches — fallbacks that nothing opens (`split_s12.sas`,
   `build_inst_own.sas`) are deliberately **not** in it, so a tree that carries
   only the DAG's files still passes. It also echoes the declared universe
   out of `pipeline_config.sas` at the top of every run.
2. **`merge_panel.sas` asserts** that every item in `out.meetings` exists in
   `out.npx_items` and calls `abort abend` if not. It **fails**, it does not warn.

(The reverse containment is expected: `build_meetings.sas` additionally drops
records with an unusable `base`, turnout > 120, and `votedFor <= 0` with `'Pass'`,
so `npx_items` is a superset. That difference is reported, not asserted.)

The N-PX leg is documented in [its own section below](#fund-level-n-px-leg).

## Architecture

The DAG as `run_pipeline.sh` submits it (`hold_jid` edges are real dependencies,
not decoration):

```
  build_meetings ─────────────────────────────────────────────────┐
  short_interest ──→ build_inst_own ──→ import_inst_own ──────────┤
       (leg 5)         (EDGAR, py)      (csv → out.inst_own)      │
  build_mflinks ──┐                                               │
  s12_split ×N ───┴──→ tfn_holdings_parallel ×N ──────────────────┤
  npx_stage ───────────→ npx_array ×M (one task per year) ────────┤
                                                                  │
                                                    ┌─────────────▼─────────────┐
                                                    │      merge_panel.sas      │
                                                    │ prereq gate → universe    │
                                                    │ assert → join → pass_npx  │
                                                    └─────────────┬─────────────┘
                                                                  ▼
                                                           dq_sweep (reports)

Total wall time: ~35 min at full scale (see SKILL.md → Verification)
```

The critical path is `tfn_holdings` ×N and the N-PX array. `dq_sweep` is held on
the merge, costs seconds, and **reports rather than gates** — so a timed run
means "a panel you can use", not "a panel that exists".

## Files

Everything in `scripts/` is reachable from `run_pipeline.sh`, or from the
documented crosswalk prerequisite. Keep it that way; an orphan script in a skill
is an invitation to run the wrong thing.

### In the DAG

| File | Language | Purpose |
|------|----------|---------|
| `run_pipeline.sh` | bash | **The entry point.** Preflight, then submits every job with `hold_jid` dependencies and returns |
| `pipeline_config.sas` | SAS | **The universe** — date window, meeting types, vote results, `S12_RANGES`. Both legs `%include` it; `run_pipeline.sh` reads the same list |
| `build_meetings.sas` | SAS | ISS vote results → turnout/forpct → CRSP permno + CIK → `out.meetings` |
| `build_short_interest.py` | Python | Leg 5. `comp.sec_shortint` × CCM → the lending series `ior_net` nets out |
| `build_inst_own.py` | Python | Leg 2, **canonical**. SEC EDGAR 13F → `cfacshr` at `rdate` → IO metrics (DBREADTH, HHI, AUM) → parquet + CSV |
| `import_inst_own.sas` | SAS | Bridge: leg 2's CSV → `out.inst_own`, the dataset `merge_panel.sas` gates on |
| `build_mflinks.sas` | SAS | Build mfl2/mfl3 prereqs for the TFN jobs |
| `split_s12_one.sas` | SAS | **One** S12 partition per SGE task — reads `tr_mutualfunds.s12` via PostgreSQL, writes a year-range partition to `/scratch` |
| `tfn_holdings_parallel.sas` | SAS | Partitioned S12 → MFLINKS → CUSIP→PERMNO → TSO → aggregate → `out.mf_own_YYYY_YYYY` |
| `stage_npx_link.sas` | SAS | Stage the two hash inputs: crosswalk (`out.npx_link`) + item universe (`out.npx_items`) |
| `build_npx.sas` | SAS | **The array task.** One year, hash-merge, accumulate to `out.npx_cells_YYYY` |
| `merge_panel.sas` | SAS | Prereq gate → concatenate MF chunks + `MERGE_ASOF` all inputs → `out.pass`; stack + **re-aggregate** N-PX cells, **assert one universe**, join → `out.pass_npx` |
| `dq_panel.py` | Python | Post-merge detector sweep against the panel this run built. Reports, does not gate |

### SGE wrappers

| File | Wraps | Note |
|------|-------|------|
| `run_sas.sh` | any `.sas` | Generic wrapper, `-sysparm` supported. Builds the log name from the sysparm — so **not** usable when the sysparm is a path |
| `run_python.sh` | any `.py` | `m_mem_free=24G` is load-bearing: `build_inst_own.py` was SIGKILLed at the cgroup default |
| `run_s12_array.sh` | `split_s12_one.sas` | Array, one task per `S12_RANGES` entry. `-tc 6` is load-bearing (PG per-role cap is 7) |
| `run_npx_stage.sh` | `stage_npx_link.sas` | Not `run_sas.sh`: the sysparm is the crosswalk path |
| `run_npx_array.sh` | `build_npx.sas` | Array; `-t` takes the **year range** — `SGE_TASK_ID` *is* the year |
| `run_import.sh` | `import_inst_own.sas` | Not `run_sas.sh`: the sysparm is the CSV path |
| `run_dq.sh` | `dq_panel.py` | Last node, held on the merge |

### Reachable by hand, not from the DAG

| File | Purpose |
|------|---------|
| `npx_linking/` | Builds the crosswalk itself, **locally** — see [linking.md](linking.md) and [npx-crsp-linking.md](npx-crsp-linking.md). `config_obs.py` is vendored **with** the package; the tuning constants in it *are* the matching behaviour, so never re-declare them elsewhere |
| `npx_link_to_csv.py` | **Local.** Crosswalk parquet → CSV for SAS (label-length/comma guards). The only file that crosses the wire going up, ~700 KB |
| `build_inst_own.sas` | Leg 2 **fallback only** — Thomson `tfn.s34type3`. Not in the DAG. Read its header before swapping it in: it joins `cfacshr` at `fdate`, correctly, because Thomson pre-adjusts |
| `split_s12.sas` | The sequential form of the S12 split (one job, all partitions, measured 910s). Superseded by the array; kept as the single-job fallback |
| `freeze.sas` / `canonical_dump.sas` / `canonical_hash.py` | Identity testing — canonical sorted fixed-format dump + sha256, so a rewritten leg can be proven to move no value. This is what the S12 reopen condition below is written against |

## Usage

```bash
# Copy to the WRDS project directory
scp -r scripts/* wrds:~/projects/myproject/

# Ensure autoexec.sas is set up with libnames (out, tfn, crsp, mfl, risk, wrdssec)
# and ~/sas/MERGE_ASOF.sas exists; ~/.pgpass carries the WRDS PG credentials.
# Build the crosswalk locally first and scp npx_link.csv alongside (see below).

# Run the full pipeline — submits and returns
ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh"

# Or size the N-PX array explicitly (the item universe still comes from
# pipeline_config.sas, not from these arguments)
ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh 2005 2025"

# Monitor
ssh wrds "qstat -u \$USER"

# Every gate, one grep
ssh wrds "cd ~/projects/myproject && grep -rE 'PREREQ|UNIVERSE|OPTIONAL|DQ|ERROR' logs/"
```

## Key Design Decisions

1. **SAS for the heavy data building, Python only where the source demands it.**
   SAS streams from disk (no memory management), the crspmerge macro handles CRSP
   extraction reliably, and the original logic includes `cfacshr` share
   adjustment, DBREADTH (Lehavy & Sloan 2008), and IOC_HHI. Legs 2 and 5 are
   Python because their sources are parquet (the EDGAR 13F parse) and because
   that is where the data-quality fixes live; `import_inst_own.sas` bridges leg 2
   back into the SAS `out` library so the merge's prerequisite gate can see it.

2. **SAS aggregates before merge.** The TFN script does CUSIP→PERMNO mapping, TSO
   joins, and permno-quarter aggregation. Output is ~50K rows per chunk, not
   millions of raw holdings.

3. **PostgreSQL for the S12 read.** `split_s12_one.sas` reads
   `tr_mutualfunds.s12` via WRDS PostgreSQL, writing year-range partitions
   (~40GB total) to `/scratch`; each TFN job then reads its own partition. The
   original rationale (NFS contention) did **not** reproduce under measurement —
   the honest reason PG is retained is identity, not speed. See
   [The S12 read path](#the-s12-read-path--measured-not-inferred) below. Note
   that WRDS PostgreSQL schema names differ from SAS libnames (`tfn.s12` →
   `tr_mutualfunds.s12`, `tfn.s34` → `tr_13f.s34`).

4. **Year ranges balanced by row count.** S12 data exploded from ~4M rows/year
   (2003-2016) to ~20-26M rows/year (2018-2024). Ranges are sized so each chunk
   is ~22-34M rows: early years get 6-8 year ranges, recent years get 1 year each.

5. **Shell wrappers for all qsub jobs.** Always use `.sh` with `#$ -cwd`, never
   `qsub -b y sas script.sas`.

6. **Maximum parallelism.** meetings, short-interest→inst_own, mflinks and the
   S12 split array all start simultaneously; the N-PX stage starts with them.
   TFN holdings start after mflinks + the split array; the N-PX array starts
   after the stage. Merge waits for everything, and `dq_sweep` waits for the merge.

## Customization

- **Date range and partitions:** `pipeline_config.sas` — `%let year1/year2`,
  `MEETINGTYPES`, `VOTERESULTS`, `S12_RANGES`. Both legs and `run_pipeline.sh`
  read it; do not add a second copy anywhere.
- **Output library:** Controlled by `autoexec.sas` (libname `out`)
- **Additional ownership variables:** Edit the aggregation step in `tfn_holdings_parallel.sas`
- **MERGE_ASOF path:** Edit the `%INCLUDE` in `merge_panel.sas`

---

# Fund-level N-PX leg

The ownership legs build the **item-level** panel. This leg adds the
**fund-level** dimension — who each fund voted for on each item — reduced on the
grid to per-`(item, block)` direction cells and folded straight into the merge.

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
                                            out.npx_cells_YYYY × 21
                                                          │
                                                          ▼
                                       merge_panel.sas: stack + re-aggregate →
                                       out.npx_cells, then join → out.pass_npx
```

**The cells never leave the grid.** An earlier design stacked them into a local
parquet (`npx_block_direction.parquet`) and merged against the ownership panel on
a laptop; `merge_panel.sas` now does the stack, the re-aggregation and the join in
one place, which is also the only place that can assert the two legs share a
universe.

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

## Usage

The N-PX leg runs as part of `bash run_pipeline.sh`. To drive it alone — a smoke
test, or re-running a year that failed:

```bash
# 0. Build the crosswalk locally (npx_linking/), then export + push it
./npx_link_to_csv.py --in npx_linking/npx_crsp_link.parquet --out npx_link.csv
scp npx_link.csv *.sas *.sh *.py wrds:~/projects/myproject/

# 1. Stage the two hash inputs
ssh wrds "cd ~/projects/myproject && qsub -v \"LINKCSV=\$PWD/npx_link.csv\" run_npx_stage.sh"

# 2. TEST BEFORE SCALING — two years first
ssh wrds "cd ~/projects/myproject && qsub -t 2023-2024 -o logs/ -j y run_npx_array.sh"

# 3. Full panel, 21 tasks
ssh wrds "cd ~/projects/myproject && qsub -t 2005-2025 -o logs/ -j y run_npx_array.sh"

# 4. Reconcile without opening 21 logs
ssh wrds "grep -h NPXSTAT ~/projects/myproject/logs/build_npx_*.log"

# 5. Re-run a single missing year (merge_panel names the years in its PREREQ abort)
ssh wrds "cd ~/projects/myproject && qsub -t 2020-2020 -o logs/ -j y run_npx_array.sh"
```

`stage_npx_link.sas` logs `LINKSTAT` (crosswalk rows, dropped dupes, distinct
blocks) and `ITEMSTAT` (distinct items, fan-out rows); `build_npx.sas` logs
`NPXSTAT` per year (scanned / kept / cells / unlinked) and `NPXDONE`.

## Benchmark — measured 2026-07-25, not estimated

Baseline: a sequential year-by-year PostgreSQL pull of the joined rows to a local
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
15x fewer bytes in the form the analysis actually consumes.** (The "bytes back"
column is now moot in the shipped design — the cells stay on the grid and only
the finished panel is ever pulled. It is kept because it is the measurement that
justified moving the aggregation up.)

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
  while the array reported clean. `merge_panel.sas`'s prerequisite gate counts
  `out.npx_cells_YYYY` against the declared year range, logs
  `PREREQ … npx_cell_years=21/21`, names the missing years and **aborts** — a
  hard failure instead of a panel quietly missing a year. Re-run one year with
  `qsub -t 2020-2020 -o logs/ -j y run_npx_array.sh`.

### Reconciliation

The assembled cells accounted for **exactly** the PostgreSQL semi-join row count
for 2005–2025 on the 2026-07-25 run: 144,375,860, 2,254,660 cells, 64x reduction,
598 unlinked vote rows (0.00%). Note the target is the **semi-join** count
(144,375,860), not the **inner-join** count (144,376,253) — see below. Current
figures are in SKILL.md → Verification; the leg's per-year numbers come out of the
`NPXSTAT` lines.

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
contention that the S12 pre-split exists to avoid for `tfn.s12`. No pre-split
step is needed here.

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

A handful of `itemonagendaid`s carry N-PX rows in more than one meeting year
(restated filings), so their cells arrive split across two task outputs.
`merge_panel.sas` **re-aggregates** with `proc summary … nway` on
`(itemonagendaid, block)` rather than plain-concatenating `out.npx_cells_:` —
a plain concat would leave duplicate keys in a dataset whose stated grain is
unique.

## Cell schema

`out.npx_cells` — grain `(itemonagendaid, block)`. These are the columns
`merge_panel.sas` joins onto `out.pass` to produce `out.pass_npx`.

| Column | Meaning |
|---|---|
| `itemonagendaid`, `block` | the grain |
| `n_rows` | vote rows in this cell |
| `n_for` / `n_against` / `n_abstain` / `n_other` | unweighted direction counts |
| `sv_for` / `sv_against` / `sv_abstain` | `sharesvoted`-weighted sums |
| `tna_for` / `tna_against` / `tna_abstain` | `tna_latest`-weighted sums |
| `n_no_sv` / `n_no_tna` | rows carrying **no** weight — the residual each weighting silently excludes |

The per-year `out.npx_cells_YYYY` datasets additionally carry `part_year` (the
meeting year of the task that produced the cell). The `proc summary` that stacks
them drops it, since a re-aggregated cell may span two.

`Withhold` folds into `Against` (on director elections it *is* the
against-equivalent). Frequency votes (`One Year`/`Two Years`/`Three Years`) and
proxy-contest card labels (`Do Not Vote`/`None`) land in `n_other` — **counted,
never dropped.**

In `out.pass_npx`, items with no fund votes carry the `__no_fund_votes__` block
label rather than a null `block`, and null `n_rows`. **They are not cells** —
exclude them from cell-grain aggregations with `where block ne '__no_fund_votes__'`.

**Always publish `n_no_sv` / `n_no_tna` alongside any weighted split.**
`sharesvoted` is 0% populated pre-2023, ~15% in 2023, 96% in 2024+ (gotcha #10 in
the `wrds` skill's `references/iss-voting.md`), so a share-weighted 2019 figure
looks precise and is computed from nothing.

## See also

- [`npx-crsp-linking.md`](npx-crsp-linking.md) — building the crosswalk (the hard half)
- [`linking.md`](linking.md) — running the linking ladder; tier coverage
- [`../../wrds/references/iss-voting.md`](../../wrds/references/iss-voting.md) — the tables themselves
- [`../../wrds/references/postgres-vs-sas.md`](../../wrds/references/postgres-vs-sas.md) — when to use which engine
- [`../../wrds/references/tfn-ownership.md`](../../wrds/references/tfn-ownership.md) — the S12/13F data defects D1–D9

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
is the column the S12 split filters on, and `fdate` is a simple index.

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

This contradicts the original rationale — *"tfn.s12 (44GB SAS file on NFS)
causes severe I/O contention when read by multiple parallel jobs (~40 min each
vs ~5 min solo)"*, which still stands in the header of the superseded
`split_s12.sas`. That incident is real but it is **not reproduced here**, and
the likely reason is the same one the N-PX leg documents: a `where=` that
defeats the index full-scans, while an index-friendly `BETWEEN` on date literals
does not. 375s for nine concurrent readers of a 47.4 GB file is not contention.

**What is still shipped, and why.** The pipeline keeps the PostgreSQL read.

Both stories about *why* were wrong. The original rationale — NFS contention —
does not reproduce. The later correction — that `tfn.s12` lacks a SAS index and
therefore needs PG — is false; the index is 19.6 GB and is listed above. Neither
claim survives measurement.

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
independent, disjoint, indexed queries executed *sequentially in one job* — that
is `split_s12.sas`. `run_s12_array.sh` + `split_s12_one.sas` make them an SGE
array, one partition per task. `-tc 6` is load-bearing, not tuning:

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
