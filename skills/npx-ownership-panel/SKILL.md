---
name: npx-ownership-panel
description: "ALWAYS use before building anything that joins proxy votes to ownership — 'build the N-PX panel', 'proxy voting panel', 'how did index funds vote on this item', 'passive vs active voting', 'fund-level votes with ownership attached', 'voting by block', 'link ISS funds to CRSP', 'risk.voteanalysis_npx', 'N-PX votes by meeting/agenda item', 'institutional ownership per proposal', '13F or S12 holdings joined to votes', 'build the ownership panel'. Use proactively instead of writing a local pipeline — the panel already exists end-to-end on the WRDS grid. NEGATIVE ROUTING: querying the underlying ISS, Thomson or 13F tables directly, WRDS connection patterns, and the data-defect reference are the wrds skill; generic data building, merging and profiling with no proxy-vote leg is ds — this skill owns the assembled panel and its DAG, not raw table access."
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
| 2 | Institutional holdings | **`build_inst_own.py` (SEC EDGAR 13F) — canonical.** `build_inst_own.sas` (Thomson S34) is fallback-only | — |
| 3 | N-PX fund votes | `build_npx.sas` (SGE array, one task per year) | **leg 4** |
| 4 | ISS→CRSP crosswalk | `npx_linking/` → `stage_npx_link.sas` | — |
| 5 | Short interest | `build_short_interest.py` — `comp.sec_shortint` × CCM, feeds `ior_net` | — |

Legs 1, 2, 4 start together. **Leg 4 hard-gates leg 3** — the array hash-merges
the crosswalk; without it every task opens a missing dataset and exits 0 having
written nothing.

**Which leg needs a fund link, and which does not.** Leg 2 (13F) answers *institutional ownership
of a STOCK* and aggregates to `permno × quarter` — **no fund-level link is needed for it**, so
work spent linking N-PX filers to 13F filers does not serve it. Leg 1 (S12) is what estimates
*shares voted by index funds*, and that is the leg `wficn` serves. Route link work to leg 1.

**`wficn` is in leg 1 only because the holdings come from S12.** Its three jobs are: bridge S12
`fundno` → `crsp_fundno` for `crsp.portnomap`'s `index_fund_flag`/`et_flag`; act as the
`(wficn, rqdate, cusip8)` dedup key; and supply `count(distinct wficn)` as `num_mf_owners`.
`crsp_portno` can do all three — `portnomap` already carries both flags, dedup on `crsp_portno` is
already the house rule, and `crsp.holdings` is keyed on it. Sourcing leg 1 from `crsp.holdings`
drops `wficn`, `mflink1/2`, `mfl2` and `mfl3` from the chain and moves coverage from **87.33% to
93.54%** of the 229,787,146-row vote universe. Before switching, check `crsp.holdings`' start date
against the panel start (S12 reaches 1980; votes start 2003-07-01) and reconcile shares between the
two sources — coverage parity with a shares disagreement is worse than the status quo.

**Before linking anything to 13F, check which question you have.** `N-PX`, `N-Q` and
`N-PORT` are all '40 Act filings from the same registrant, so the registrant CIK — parsed
from the N-PX filing path — is already the join key, and **1,374 of 1,377 panel registrant
CIKs (99.8%) file `N-Q` or `N-PORT`, covering 99.11% of the vote universe**. Stock-level
institutional ownership comes from 13F collapsed to cusip × quarter and needs NO fund link;
**shares held by a fund come from `N-PORT` `balance` per `<seriesId>`**, which is the same
identifier the vote panel carries, also with NO link. An ISS→13F crosswalk is needed only
when the question is explicitly about a MANAGER's own reported book. Caveat: `N-PORT` is
structured XML from 2019-04 (41.19% of the panel's vote rows); `N-Q` covers 2003-2021 but
carries no series id and is unstructured, so earlier holdings are registrant-level and need
parsing.

**If you do need an ISS-institution → 13F-manager link, do not match on the ISS name.** The
deterministic linker is `npx-reconcile/src/link13f/` (92.37% of the vote universe, gate-passing).
The channel that carries it is **N-CEN Item C.7**, where a registrant declares its adviser's legal
name per series per year — reached from the N-PX `filepath`, which encodes the registrant CIK.
Brand strings do not resolve: `Fidelity` appears in **none** of the 25,073 EDGAR conames, while
`FIDELITY SELECTCO, LLC` does. Name rules alone plateau near 60%, and the 13F `om` family graph
adds **zero** institutions on its own. Attribute advisers **per series** (`<mgmtInvSeriesId>`), not
per trust: a 34-series trust lists 34 advisers and only one advises the fund that voted. Validate
with holdings overlap, which **rejects only** — the known-wrong `Russell → JPMorgan` pair scores
0.932 against a random-pair p90 of 0.940. A further 4.13% of the universe has advisers that file
no 13F at all, so it is unlinkable rather than unlinked.

**Leg 2 has two sources for one quantity, and they are NOT interchangeable.**
Thomson S34 decayed after 2013 and undercounts; the EDGAR scrape exists for that
reason. EDGAR wins where present, S34 is fallback-only, **never blended**.

`build_inst_own.py` (EDGAR) is the canonical builder and carries every
data-quality fix. `build_inst_own.sas` reads `tfn.s34type3` only — despite what
an earlier version of this table said, it does not consume EDGAR at all.

**The two use different `cfacshr` join dates and both are right.** EDGAR is
as-filed and not pre-adjusted, so the correct factor is at **`rdate`** — `fdate`
can be far later on a late filing or a carried-forward vintage, and a split in
between would apply a factor from a date the shares were not held. Thomson
pre-adjusts shares from `rdate` to `fdate` (reference D2: `fdate` is "the date
Thomson's share adjustments are made to"), so there the correct factor is at
**`fdate`**. Changing either to match the other introduces a bug. The SAS header
says so at the join site.

## One entry point, and what is reachable from it

`run_pipeline.sh` is the only pipeline entry point. Everything in `scripts/` is
reachable from it, or from the documented crosswalk prerequisite below — there is
no second DAG and no dead script. If you add one, keep that true; an orphan
script in a skill is an invitation to run the wrong thing, and this skill shipped
three builders of one quantity before it was cleaned up.

Two roots, deliberately:

| Root | What it is |
|---|---|
| `run_pipeline.sh` | the DAG. Submits everything with `qsub -hold_jid` and returns |
| `npx_linking/` (`python -m npx_linking run`) | the crosswalk, built **locally** and scp'd in (below). Not part of the DAG because leg 3 hard-gates on its output existing |

`npx_link_to_csv.py` and `npx_linking/family_overlay.example.csv` are used by hand
in that prerequisite step, not invoked by the DAG.

**Legs 2 and 5 are Python and need `polars`; every other leg is SAS.** The
preflight imports them before submitting anything, so a missing package fails in
one second instead of thirty minutes into a grid run.

For S12 data-quality controls (the 2017Q4 feed change, coverage end, the MFLINKS
gap) use the `wrds` skill's `references/tfn-ownership.md` **D5**, and the detectors
in `skills/wrds/scripts/ownership_dq.py`. Deliberately not duplicated here.

### The linking chain is vendored, not reimplemented

`npx_linking/` is a copy of mirror's `scripts/linking/` — the implementation that
produced the frozen `npx_crsp_link` baseline. It replaced a second, flattened
single-file linker that shared **zero function names** with it: not drift, a
reimplementation of the same six-tier ladder. Two rival linkers deciding every
fund's block is the one duplication worth paying to remove.

Verified on adoption: the vendored package reproduces mirror's fingerprints
exactly — `npx_crsp_link` `4fdf9818…`, `fundid_seriesid` `93583072…`,
`sec_series_master_series` `5919545e…`.

`config_obs.py` is vendored **with** it. The chain reads 26 symbols from it: 15
paths/scalars and 11 `L2_`/`L3B_` tuning constants — the TF-IDF n-gram range and
candidate threshold, the legal-suffix and "formerly" regexes, family stopwords,
the succession share bar. Those constants *are* the matching behaviour, so
re-declaring them would fork the ladder's semantics while looking like config.

**Sync the directory and `config_obs.py` together.** A partial sync is how the
two forked the first time.

Run it standalone with:

```bash
NPX_LINK_ROOT=/path/to/project python -m npx_linking run
python -m npx_linking stages        # what runs, in dependency order
python -m npx_linking fingerprint   # byte-identity of each stage output
python -m npx_linking verify        # rebuild in a sandbox and diff
```

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

> **STALE — re-measure before quoting.** The timings and the identity digest below
> were measured 2026-07-25, before the data-quality pass. They describe a pipeline
> that no longer matches the canonical builder: leg 2 is now EDGAR (`build_inst_own.py`)
> rather than the Thomson SAS path, and leg 5 (short interest) did not exist.
>
> Wall time should be close to unchanged — this table's own conclusion is that the
> critical path is `tfn_holdings` ×9 and the N-PX array, and leg 2 is not on it. The
> fixes are cheap: the `msf_v2` splice is one extra query, the `value = 0` filter is
> one predicate on an existing pass, disabling the cusip6 fallback *removes* 2.66M
> rows of join work, and the short-interest pull ran 9.5s.
>
> ~~**The identity digest WILL change and that is intended.** Re-freeze it deliberately
> once the corrected DAG has run clean.~~ **DONE — re-frozen 2026-07-28, see below.**
>
> A timed run includes the detector sweep (`dq_panel.py`, seconds, held on the merge)
> so the number means "a panel you can use", not "a panel that exists". This was a
> standing instruction that nothing implemented — no script referenced
> `ownership_dq.py` at all — so every wall time quoted before 2026-07-27 was the
> time to build a panel of unmeasured quality.

Clean checkout on WRDS, one `bash run_pipeline.sh`, 2026-07-25. Two runs, both clean:

| Run | S12 scope | Wall | `ERROR` lines |
|---|---|---:|---:|
| Reduced | 2 of 9 partitions | 12m 17s | 0 |
| Full | 9 of 9, sequential PG split | 34m 46s | 0 |
| **Full + S12 array, `build_meetings` native** | **9 of 9** | **36m 1s** | **0** |

**Identity (2026-07-25 baseline, now superseded):** that run's dump was
byte-identical to its frozen baseline — 2,018,866 lines,
`sha256 22f13e7679…955`. Converting `build_meetings` from a PostgreSQL
pass-through to a native indexed read moved **no value at 12 significant digits**.

### Re-frozen 2026-07-28

```
sha256  8ae22b4af350be27889b26b6d09b2f3ee77b7a81a00dd55eea4cac2907f1be3a
lines   1,994,945          (was 2,018,866, -23,921)
run     34m26s, orphans=0, 0 ERROR, mf_own_chunks=9 npx_cell_years=21/21
```

**What moved the digest**, all deliberate, none a regression to chase:

| change | effect |
|---|---|
| leg 2 Thomson S34 → SEC EDGAR | universe and level shift |
| CRSP SIZ → CIZ (#99/#100) | +3.2–5.0% distinct permnos per year-end; **`cfacshr` basis changes, so `io_total` LEVELS are not comparable across this boundary — ratios are** |
| denominator no longer filtered by the analysis universe (#115) | untestable rows **50.9% → 1.1%** |
| cusip8 not cusip6 (#109) | drops spurious issuer-level attachments |
| `__no_fund_votes__` block label (#126) | the `block` column now carries a label where it was null on 26,924 rows |

**Known and open at freeze time**, stated so the baseline is not read as
"everything reconciles":

- Against mirror's previous artifact the panel has **53,555 fewer vote-carrying
  cells** and **22,473 fewer items with vote data**. Consistent with the tighter
  universe, but that is an expectation, not a measurement — undecomposed.
- **15 rows** in the `inst_own` reconciliation are unexplained (0.002%), recorded
  WONT-FIX.

Both are differences from a *superseded* artifact rather than internal
inconsistencies, which is why they do not block the freeze. Full detail:
mirror `docs/investigations/2026-07-28_grid_run_reconciliation.md`.

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

**`run_pipeline.sh` now does this for you** — `dq_sweep` is the last node, held on
the merge, and it reports rather than gates. Read it out of the run:

```bash
grep -rE 'PREREQ|UNIVERSE|OPTIONAL|DQ|ERROR' logs/    # every gate, one grep
```

Measured on the 2026-07-27 run (675,639 × 22 leg-2 panel):

```
DQ rows=675,639 coverage_end=0 duplicate_grain=0 join_coverage_tail=0
   unit_discontinuity=0 split_factor_ratio=2747 owner_dropout=5577
DQ impossible_ratio=11,761/378,129=3.110% testable=56.0%_of_panel
```

**Read that denominator.** `impossible_ratio` can only fire on rows carrying both
`io_total` and a positive `tso` — 378,129 of 675,639. The remaining 297,510 (44%)
are invisible to it, so "3.110%" does not mean "the panel is 96.9% clean". The
check is also one-sided: a denominator that is too *small* trips >100%, one that is
too *large* never trips anything and just biases ownership downward.

To run it by hand, or against a panel built elsewhere:

```bash
uv run python3 tests/ownership_dq_test.py          # 105 assertions, stdlib only
qsub -v OWNERSHIP_DQ=/path/to/ownership_dq.py run_dq.sh    # on the grid
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
