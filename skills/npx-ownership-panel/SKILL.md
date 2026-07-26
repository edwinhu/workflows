---
name: npx-ownership-panel
description: Build the meeting-level proxy-voting × ownership panel on the WRDS SGE grid — ISS N-PX fund votes reduced to (item × block) direction cells, joined to institutional and mutual-fund ownership. Use when working with risk.voteanalysis_npx, N-PX fund-level votes, ISS→CRSP fund linking, index/passive/active voting blocks, or a proxy-voting panel that needs ownership attached.
---

# N-PX × Ownership Panel

Builds `out.pass_npx` — item-level ownership joined to each item's per-block
observed For/Against/Abstain split — entirely on the WRDS grid.

**Verified end-to-end from a clean checkout on 2026-07-25.** One bash command,
WRDS credentials, nothing else: **34m 46s** wall at full scale, zero errors,
`out.pass_npx` at 2,018,866 rows. Cold from nothing — including building the
crosswalk and the 13F holdings — is **≈47 min**. Both are in
[Verification](#verification); the one-command claim is measured, not asserted.

## Why this exists as a skill

`npx_agreement.sas` sat in one project for five months doing exactly what
another project needed, and nothing surfaced it. The second project rebuilt it
locally in Python and shipped 144,376,253 rows to a laptop for want of a leg
that already existed. **The failure was findability, not capability.**

## The one command

```bash
scp -r scripts/* wrds:~/projects/myproject/          # + npx_link.csv (see below)
ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh"
```

It submits the whole DAG with `qsub -hold_jid` and **returns**. SGE sequences
the chain; nothing local stays alive. Disconnect, come back, collect the panel.

| Output | Grain | What it is |
|---|---|---|
| **`out.pass_npx`** | **`(itemonagendaid, block)`** | the deliverable — ownership panel + per-block vote direction |
| `out.pass` | `itemonagendaid` | item-level ownership panel alone |

## The four legs

| # | Leg | Script | Depends on |
|---|---|---|---|
| 1 | Mutual-fund holdings | `split_s12.sas` → `tfn_holdings_parallel.sas` ×N | — |
| 2 | Institutional holdings | `build_inst_own.sas` — native indexed read of `tfn.s34type1`/`s34type3` — + EDGAR 13F scrape | — |
| 3 | N-PX fund votes | `build_npx.sas` (SGE array, one task per year) | **leg 4** |
| 4 | ISS→CRSP crosswalk | `npx_linking/` → `stage_npx_link.sas` | — |

Legs 1, 2, 4 start together. **Leg 4 hard-gates leg 3** — the array hash-merges
the crosswalk; without it every task opens a missing dataset and exits 0 having
written nothing.

**Leg 2 has two sources for one quantity.** Thomson S34 decayed after 2013 and
undercounts; the EDGAR scrape exists for that reason. EDGAR wins where present,
S34 is fallback-only, **never blended**.

## Before you run: build the crosswalk

Leg 4's input is a `fundid → block` crosswalk you build once, locally. It is the
hard half — see [references/npx-crsp-linking.md](references/npx-crsp-linking.md).

```bash
cd scripts/npx_linking
export SEC_USER_AGENT="your name your@email.edu"
./download_sec_series_class.py --out data/raw/sec_series_class
SEC_SERIES_RAW=data/raw/sec_series_class SEC_SERIES_OUT=data/processed ./build_sec_series_master.py
./smoke_test.sh 2023                       # 8 assertions, ~2 min — run this first
./pull_npx_funds.py  --out npx_funds.parquet
./pull_crsp_funds.py --out crsp_funds.parquet
./build_npx_crsp_link.py --npx-funds npx_funds.parquet --crsp-funds crsp_funds.parquet \
    --sec-series-master data/processed/sec_series_master.parquet \
    --sec-series-names-long data/processed/sec_series_names_long.parquet \
    --out npx_crsp_link.parquet
cd .. && ./npx_link_to_csv.py --in npx_linking/npx_crsp_link.parquet --out npx_link.csv
```

Runs from WRDS credentials alone. Links **80.8%** of vote rows.

## Two invariants, both in SAS

They must hold for an unsupervised `bash run_pipeline.sh` with no harness
anywhere, so neither lives in an orchestrator.

**One universe.** `pipeline_config.sas` declares the date window, meeting types
and vote results once; both legs `%include` it. Before it they disagreed —
2003-2024 with filters vs 2005-2025 with none — and nothing detected it.

**Three hard gates in `merge_panel.sas`**, all `abort abend`:
- *Prerequisites*: every expected output exists. `-hold_jid` releases on
  **completion, not success**, so a dead leg otherwise lets the merge start.
- *S12 partitions*: all of `S12_RANGES` present. A refused PostgreSQL connection
  (per-role cap is **7**, hence `-tc 6`) leaves a partition missing, which shows
  up as an ownership-*column* gap the universe assertion cannot see.
- *Universe*: every `out.meetings` item exists in `out.npx_items`.

`tfn_holdings_parallel.sas` also no longer silently falls back to a full 47.4 GB
`tfn.s12` scan when its partition is absent — that produced plausible output and
hid the gap. Override with `S12_ALLOW_FULLSCAN=1` only deliberately.

Both fired during verification and caught real failures. That is the point.

## Verification

Clean checkout on WRDS, one `bash run_pipeline.sh`, 2026-07-25. Two runs, both clean:

| Run | S12 scope | Wall | `ERROR` lines |
|---|---|---:|---:|
| Reduced | 2 of 9 partitions | 12m 17s | 0 |
| Full | 9 of 9, sequential PG split | 34m 46s | 0 |
| **Full + S12 array, `build_meetings` native** | **9 of 9** | **36m 1s** | **0** |

**Identity: PASS.** The last run's canonical dump is byte-identical to the
frozen baseline — same 2,018,866 lines, same
`sha256 22f13e7679a3f9c15843116195625620dfe835a661ba6c593b1bd9d93503a955`.
Converting `build_meetings` from a PostgreSQL pass-through to a native indexed
read moved **no value at 12 significant digits**.

The S12 array cut the partition write from **910s sequential to ~270s** (9 tasks,
`-tc 6`), but total wall did not drop: the critical path is `tfn_holdings` ×9 and
the N-PX array, not the split. The win is real and in the wrong place to shorten
the pipeline — worth having, not worth claiming as a speedup.

Gates on the full run: `PREREQ mf_own_chunks=9 npx_cell_years=21/21` · `UNIVERSE
meetings_items=623,642 npx_items=712,466 orphans=0`.

S12 partitions (237.5M rows total): 34,212,190 · 27,141,268 · 29,551,018 ·
22,369,087 · 23,985,898 · 25,693,786 · 26,528,617 · 25,076,427 · 22,936,627.

N-PX leg: **140,382,295** vote rows kept, 2,130,231 cells pre-aggregation, **0
unlinked**. Crosswalk: 26,686 fundids, 712,466-item frame.

Final `out.pass_npx`, grain `(itemonagendaid, block)`, **2.28 GB**:

```
    n_rows      n_items   items_no_npx      vote_rows
 2,018,866      623,642         27,294    134,723,487

block           cells       vote_rows
active        572,426      75,563,301
index         585,916      48,517,584
passive       533,516       8,045,939
asset_owner   299,714       2,596,663
```

> Both runs produced an **identical panel**. The S12 leg populates mutual-fund
> ownership *columns* through `MERGE_ASOF`; it does not add rows. More partitions
> means more of those columns are non-missing, not a bigger panel.

### Cold vs warm

"Warm" = the crosswalk and the 13F holdings already on disk. Cold builds them.

| Term | Time | Basis |
|---|---:|---|
| **WARM — 4-leg pipeline** | **34m 46s** | **MEASURED**, full-scale clean-room run |
| (a) SEC series/class download | 1m 43s | MEASURED — 17 vintages, 128 MB, 0.5 s inter-request sleep |
| (a) `build_sec_series_master` | 10s | MEASURED |
| (b) `pull_npx_funds` | 6m 31s | MEASURED — server-side aggregation over 238M rows |
| (b) `pull_crsp_funds` | 7s | MEASURED |
| (b) crosswalk ladder | 2m 30s | MEASURED — TF-IDF over 26,929 fundids |
| **(c) 13F EDGAR parse** | **1m 23s** | **EXTRAPOLATED** — see below |
| **COLD TOTAL** | **≈ 47 min** | sum of the above |

**(c) method.** One recent dense quarter measured on a 4-slot compute node,
reading `/wrds/sec/archives` directly — never per-filing SEC.gov HTTP
(`edgar.md` iron law; on the grid the archive is a local mount, so no rclone leg
at all):

> **2024Q2: 7,680 filings · 1.44 GB input · 27 s parse wall · 2,489,014 rows ·
> 66.5 MB gz output** → **284 filings/s** at `GOMAXPROCS=4`, concurrency 32.

Extrapolated across the **38 quarters 2016Q4–2026Q1**, weighted by actual filings
per quarter from `wrdssec_all.wrds_forms` — **237,094 filings**, 44 GB input,
~77M output rows. Weighting is not cosmetic: a flat `38 × 2024Q2` would say
291,840 filings, **+23.1% too high**, because quarterly volume ranges 4,255 to
9,076 over the span.

- Serial (one 4-slot task): **13.9 min**
- 38-shard SGE array, 10 concurrent (**the observed slot count** on this
  cluster): **1m 23s** — the figure used in the table
- 38-shard array, full parallelism: 32 s (not claimed; the scheduler does not
  give 38 slots)

**The 35-minute local N-PX pull is gone from the cold path entirely.** The old
design downloaded 144,376,253 joined rows to a laptop — measured at ~35 min
sequential — before any analysis could start. The array reads
`risk.voteanalysis_npx` on the grid and ships 2.25M cells instead. That single
change is worth more than every other term in the cold budget combined, and it
is why cold-from-nothing is ~47 min rather than ~80.

**Straggler risk.** A 21-task array over shared NFS will hit one often enough
that the with-straggler figure is the planning number, not the best case. One
task took 742 s against a 60 s median and the array still reported clean at
20 of 21 outputs — which is why `merge_panel.sas` asserts coverage.

### Scope caveats

- The reduced run used 2 of 9 S12 partitions because that account's `/scratch`
  quota is **22 GB** against the ~41 GB the full set needs — measured, `dd`
  fails with "Disk quota exceeded". The full run used a directory with headroom.
  Check `quota` and trim `S12_RANGES` in `pipeline_config.sas` to fit; the chain
  completes either way over a narrower holdings window.
- (c) is the only extrapolated term. Everything else was run.

### Three defects the clean-room run surfaced, all fixed

- `tfn_holdings_parallel.sas` used **open-code `%IF`**, which errors on this SAS
  deployment. As shipped it had never run — it died before reading a row.
- `split_s12.sas` and `run_pipeline.sh` hardcoded the partition list
  **separately**. Now single-sourced from `pipeline_config.sas`.
- A greedy `sed` reading that list swallowed a `;` inside a trailing comment and
  submitted 11 jobs for a 2-partition list — the bash/SAS divergence the shared
  list exists to prevent.

## Data quality: run the detectors before you use the panel

This skill builds the panel; it does not certify the numbers in it. The sources
have documented defects, several of which produce a **complete-looking panel with
plausible values**, so they cannot be caught by eyeballing output.

Before analysis, run the detectors in the `wrds` skill against what you built:

```bash
uv run python3 tests/ownership_dq_test.py          # 105 assertions, stdlib only
# then, on your panel, via skills/wrds/scripts/ownership_dq.py
```

Read `skills/wrds/references/tfn-ownership.md` → **Known Data Defects (D1-D9)**
first. The ones that bite this pipeline specifically:

| | What it does to this panel |
|---|---|
| **D1** split mis-adjustment | Thomson pre-adjusts `shares` wrongly around split dates — *worse* in S12 than 13F (40.7% vs 34.5% outlier rate at >4:1 splits). WRDS's own conclusion is that there is **no clean fix**; winsorize split-adjacent quarters. |
| **D5** S12 feed change at 2017Q4 | Legacy SP → strategic collection: **+613% CUSIPs, +113% funds**. A genuine coverage expansion, so **no level comparison may span 2017Q4**. Count-based measures are unusable across it; share-based ones are mildly contaminated. |
| **D8** Int8 date overflow | Not a vendor defect — *yours*. `dt.month() * 100` overflows polars' Int8 and silently yields a valid-looking wrong date key. It once left a reference panel holding only March and December, which zeroed ownership for 49% of a panel and read as D1 for weeks. |
| **D9** ownership > 100% | Partly real: 13F is long-only, so lent shares are counted twice and >100% is **correct** for heavily shorted stocks (0.51% → 22.95% violation rate across short-interest buckets). **Do not clip at 100%** — that destroys real information. |

Two habits worth carrying over, both learned the expensive way here:

1. **Run `detect_calendar_bucket_gap` on every reference/dimension table at build
   time**, not just on the output panel. It is the one detector that catches a root
   cause rather than a symptom — a reference table missing a calendar bucket makes
   every downstream join fall back to a default, silently.
2. **A lent share carries no vote for the lender.** If you are using ownership as a
   *voting* weight, it overstates the block by roughly the securities-lending rate —
   ~1.5pp at the median, >12pp in heavily shorted names. Net it out or report
   robustness excluding high-short-interest firm-quarters.

## References

| File | What |
|---|---|
| [references/pipeline.md](references/pipeline.md) | full pipeline detail, benchmark, SAS traps |
| [references/npx-crsp-linking.md](references/npx-crsp-linking.md) | the crosswalk — digit guard, trust-prefix, cross-family veto, uint32 and TNA traps |
| [references/linking.md](references/linking.md) | running the linking ladder; tier coverage |

## Key facts

- `risk.voteanalysis_npx` is **238,445,215 rows / 329 GB**. Never download it.
  Aggregate on the grid: 2.25M cells instead of 144M rows, 20.8 MB instead of
  304 MB, 839s instead of a 35-minute sequential pull.
- **The date range is not the analysis universe.** `npx.meetingdate` over
  2005-2025 is 237,057,808 rows; items present in `vavoteresults` are
  144,375,860. Date alone inflates every block denominator by ~64%.
- **`vavoteresults` is not unique on `itemonagendaid`**, so an `INNER JOIN` fans
  out. A hash keyed on it cannot.
- Write `meetingdate between "01jan&year."d and "31dec&year."d`, never
  `year(meetingdate) = &year.` — a function on the indexed column defeats the
  15 GB index and full-scans 329 GB per task.
- **Budget for a straggler.** One array task took 742s against a 60s median and
  the array still reported clean at 20 of 21 outputs.

## See also

`wrds` skill — connection patterns, `references/iss-voting.md` for the tables
themselves, `references/postgres-vs-sas.md` for engine choice.
