# 13F EDGAR Scrape — Measured Performance on the WRDS Grid

Everything here was measured on wrds-cloud on 2026-07-25 against
`/wrds/sec/archives`, not derived. Where a number is extrapolated it says so.

## Contents

- [The scheduler is the constraint](#the-scheduler-is-the-constraint) — 10 slots per user, 8 per job
- [The corpus](#the-corpus) — 248,500 filings, 45.31 GB, 38 quarters
- [Single-task scaling](#single-task-scaling) — per-slot throughput peaks at ONE slot
- [Full-run wall clock](#full-run-wall-clock) — 8m23s shipped, 2m32s optimised
- [Where the CPU went](#where-the-cpu-went) — encoding/xml was 63%
- [Array design](#array-design) — shard on bytes, one slot per task
- [Byte-identity method](#byte-identity-method)
- [What identity testing does not prove](#what-a-canonical-hash-identity-test-does-not-prove)
- [Fixed: filings declared windows-1252 parsed to zero rows](#fixed-filings-declared-windows-1252-parsed-to-zero-rows) — 7,023 filings, 2.6M rows; impact is conditional on your denominator and source
- [Separate trap: the `value` column changes units at 2023Q1](#separate-trap-the-value-column-changes-units-at-2023q1)

## The scheduler is the constraint

Not CPU, not NFS. Three limits, all verified by submission:

| Limit | Value | How it was established |
|---|---|---|
| Slots per user in `all.q` | **10** | `qconf -srqs` → `max_user_jobs`: `limit users {*} queues {all.q} to slots=10`. Confirmed by `qstat`: an 8-slot job plus a 2-slot job ran, a third queued. |
| Slots per single job | **8** | `qsub -pe onenode 10` → `Unable to run job: Too many slots requested, jobs may not use over 8 slots.` (server JSV) |
| Other queues | **none available** | `qsub -q ssdwork.q` → `Unable to run job: Invalid queue ssdwork.q.` The JSV rejects it even though the queue has 300 free slots and no `user_lists`. |

`schedule_interval` is 4 s with `flush_submit_sec`/`flush_finish_sec` at 1 s, so
array dispatch is prompt; the ceiling is the slot count, not the scheduler's
reaction time.

**The practical consequence.** Ten slots is the entire budget for this leg, and
it is shared with every other job the same account runs. Any wall-clock claim
that assumes more than ten concurrent slots is wrong. In particular
*"N concurrent tasks"* is not the unit — a 4-slot task consumes four of the ten,
so only **two** run at once.

## The corpus

`13F-HR` and `13F-HR/A`, filing-date quarters 2016Q4–2026Q1, from
`/wrds/sec/sasdata/wrds_forms.sas7bdat` (grid SAS, ~10 s; no PostgreSQL):

| | |
|---|---|
| Quarters | 38 |
| Filings | **248,500** |
| Input bytes | **45.31 GB** (`os.path.getsize`, 0 missing) |
| Holdings rows produced | **86,444,026** |
| Per-quarter filings | 4,508 (2016Q4) → 9,511 (2026Q1) |

`13F-NT` (notice, no holdings table) is excluded; including it would add
131,127 filings that produce no rows.

> **`fsize` on `wrds_forms` is not usable for shard planning.** It is populated
> for older filings and collapses for recent ones — 2021Q2 reports 0.016 GB
> across 6,307 filings (~2.6 KB each) against a true ~1 GB. Stat the archive
> instead: 248,500 `getsize` calls take **7 seconds** with 48 threads.

## Single-task scaling

2024Q2, 8,114 filings, 1.44 GB, one job, `GOMAXPROCS=NSLOTS`,
`concurrency=NSLOTS*8`, shipped parser:

| Slots | Wall | filings/s | **filings/s per slot** | CPU/wall | Peak RSS |
|---:|---:|---:|---:|---:|---:|
| 1 | 90.9 s | 89.3 | **89.3** | 0.94 | 454 MB |
| 2 | 54.4 s | 149.3 | **74.6** | 1.78 | 684 MB |
| 4 | 27.9 s | 291.2 | **72.8** | 3.56 | 1,048 MB |
| 8 | 17.5 s | 462.7 | **57.8** | 5.94 | 1,217 MB |

Two things follow, and they point the same way:

1. **Per-slot throughput is highest at one slot** and decays to 65% of that by
   eight. Amdahl on the 1→8 speedup (5.18×) puts the serial fraction at ~7.8%,
   which the CPU profile then localised exactly (the single gzip writer
   goroutine, below).
2. **Under a fixed slot cap, many small tasks beat few big ones.** Ten 1-slot
   tasks and two 4-slot tasks both consume the same budget; the first shape
   does more work with it.

`m_mem_free=4G` per slot — what the previous submit script asked for — over-reserves
by roughly 8× against a measured 454 MB at one slot. 2G is ample and schedules faster.

## Full-run wall clock

All 38 quarters, 248,500 filings, measured end to end (makespan = last task
end − first task start, so scheduling gaps are included):

| Run | Parser | Shape | Makespan | filings/s | **filings/s per slot** |
|---|---|---|---:|---:|---:|
| **A** | shipped | 38 quarter shards × 4 slots | **503.4 s (8m 23s)** | 493.6 | 63.8 |
| **B** | optimised | 38 quarter shards × 4 slots | **190.0 s (3m 10s)** | 1,307.7 | 180.6 |
| **C** | optimised | 230 byte-balanced shards × 1 slot | **151.8 s (2m 32s)** | 1,637.3 | 195.9 |
| **E** | optimised **+ charset fix** | 230 byte-balanced shards × 1 slot | 301.9 s † | 823.1 † | 183.7 |

† Run E was deliberately throttled to 4–8 concurrent tasks (`qsub -tc`) to leave
slots for a concurrent goal-critical job, so its mean occupancy was 4.48 of 10
and its makespan is not comparable to A–C. Its **per-slot** rate is: the charset
fix costs **6.2%** of throughput (195.9 → 183.7 filings/s per slot) for the 3.04%
more rows it recovers and the transcoding it does. At full occupancy it projects
to ~135 s.

A→B isolates the parser change (same array shape): **2.65× on makespan, 2.83×
on slot-seconds** (3,897 → 1,376). B→C isolates the array shape: a further
**1.25×**, from higher per-slot throughput at one slot (180.6 → 195.9 filings/s
per slot), better occupancy (7.24 → 8.36 of 10 slots) and a much shorter tail
(task p90 13.4 s → 6.1 s). End to end, **A→C is 3.32×**.

> **Read makespan with the queue depth attached.** None of these three runs had
> all ten slots to itself — mean occupancy was 7.74 (A), 7.24 (B) and 8.36 (C)
> of 10, because a second job stream shared the account throughout. Makespan is
> therefore *pessimistic and not exactly reproducible*; the contention-robust
> number is **filings/s per slot**, which is computed from slot-seconds and is
> unaffected by queue wait. Comparisons between A, B and C are sound because all
> three ran under comparable contention. On a grid where all ten slots were
> genuinely free, run C's per-slot rate implies **248,500 / (195.9 × 10) ≈ 127 s**
> — a projection, not a measurement.

**Observed-slot vs full-parallelism, stated separately as they must be:**

| Basis | Wall clock | Status |
|---|---:|---|
| One 4-slot task, serial over all 38 quarters, shipped parser | 64.9 min | computed from 3,897 slot-seconds |
| **10 slots (the real cap), shipped parser, quarter shards** | **8m 23s** | **MEASURED** (run A) |
| **10 slots, optimised parser, byte-balanced 1-slot shards** | **2m 32s** | **MEASURED** (run C) |
| 38 shards fully parallel, 4 slots each (152 slots) | ~35 s | **NOT ACHIEVABLE** — needs 15× the slot cap |

### On the previously reported 1m 23s

The extrapolation in `npx-ownership-panel` reached **1m 23s** for this leg by
dividing a 13.9 min serial estimate by "10 concurrent, the observed slot count".
The per-slot measurement underneath it is sound — 284 filings/s at 4 slots
reproduces here as 273–291 filings/s — but the divisor conflates *ten slots*
with *ten tasks*. The tasks measured were 4-slot tasks, so ten of them would
need 40 slots against a hard cap of 10. The correct divisor for that shape is
**two** concurrent tasks, which lands at 8m 23s — and 8m 23s is what a full run
actually took.

The optimised leg does reach 2m 32s, but by making each slot do 2.8× the work,
not by finding slots that do not exist.

## Where the CPU went

`runtime/pprof`, 2024Q2 at `GOMAXPROCS=4`, 104.06 s of samples:

| Component | Share | Note |
|---|---:|---|
| `encoding/xml.(*Decoder).Token` | **63.4%** | of which ~31 pp in `nsname`/`name`/`readName`/`isName` — namespace-name validation |
| `compress/flate` (gzip writer) | **9.2%** | single goroutine; this *is* the serial fraction Amdahl predicted |
| GC (`gcBgMarkWorker`, `scanobject`) | ~6.2% | allocation pressure from the token stream |

Two changes followed, both stdlib-only, no new dependencies:

- **A hand-rolled information-table scanner** (`xml_fast.go`). The information
  table is machine-generated, attribute-free and entity-simple, so it does not
  need a general XML parser. The scanner reproduces the exact
  StartElement/EndElement/CharData sequence `encoding/xml` emits, and **refuses**
  anything it cannot mirror — CDATA, DOCTYPE, multi-colon names, unknown
  entities, mismatched end tags, non-UTF-8 declarations — falling back to
  `encoding/xml` for those. Correctness never depends on the scanner being
  complete, only on it being honest about its limits. Measured fallback rate:
  **2.6% (2016Q4), 4.8% (2024Q2)**, almost entirely the windows-1252 filings
  described below.
- **`gzip.BestSpeed` instead of the default level.** Halves the serial stage.
  Measured cost on 2024Q2: 71.4 MB → 81.4 MB, **+14.0%** on disk. The
  decompressed stream is unchanged, which is the only thing downstream reads.

The text-mode parser (`text_parser.go`) was **not** touched, and should not be:
across all three sampled quarters, 100% of rows parsed in `xml` mode. Its
per-line `regexp.Compile` in `extractBCSCascade` is a real inefficiency but it is
unreachable for filings from 2013Q3 on, so optimising it would buy exactly
nothing for this window.

## Array design

Measured answers to the four questions:

| Question | Answer | Basis |
|---|---|---|
| **Shard key** | Byte-balanced packing (LPT) **within quarter**, ~200 MB per shard | Contiguous equal-*count* chunks gave a **2× duration spread** (19.4 s vs 42.8 s for two 2,254-filing chunks of 2016Q4): archive path order is CIK order, and CIK correlates with filer size. Packing on measured bytes cuts imbalance to 10.4%. Sharding within quarter keeps the output quarter-partitioned, which is what the panel consumes, at negligible balance cost. |
| **Slot count** | **1 slot per task**, array self-throttles to 10 | Per-slot throughput 89.3 f/s at 1 slot vs 57.8 at 8. Confirmed at full scale: 195.9 vs 180.6 f/s per slot (run C vs run B). |
| **Memory per task** | **`m_mem_free=2G`** | Peak RSS 454 MB at one slot. The previous 4G was an ~8× over-reserve. |
| **Staging vs parsing** | **Fused — no staging stage at all** | `/wrds/sec/archives` is mounted directly on the compute nodes. There is nothing to stage: rclone is for moving filings *off* WRDS. A copy-first design would add a pointless pass over 45 GB. `sys` CPU is 3% of `user` CPU, so NFS is not a bottleneck at ten slots. |

Shard granularity has a floor. At 200 MB the median task runs 5.6 s against a
4 s `schedule_interval`, and mean occupancy was 8.36 of 10 slots — ~16% lost to
dispatch gaps. Coarser shards waste less on dispatch but leave a longer tail.

> **Not established:** whether 200 MB is the optimum. A 400 MB / 114-shard
> comparison run was submitted and then **cancelled** to free slots for a
> concurrent job, so the tail-versus-dispatch trade is reasoned, not measured.
> 200 MB is a working choice that measured well, not a tuned one.

## What a canonical-hash identity test does not prove

**It proves a refactor was faithful. It cannot prove the behaviour was right.**

The optimisation below passes identity against the shipped parser on all 38
quarters. The shipped parser was also silently dropping 7,678 filings. Both
parsers lose the same 3.04% of holdings rows and agree exactly on the loss, so
the hashes match — and the match says nothing about whether either output is
correct. A byte-identical reproduction of a bug is still a bug.

This is a property of the method, not a defect in it. `canonical_hash.py`,
canonical dumps, per-column sums, row-count assertions: every one of them
answers *"did this change alter behaviour?"* and none of them answers *"was the
behaviour right?"* The second question needs a test against ground truth — here,
the observation that a 13F-HR with a populated information table must not parse
to zero holdings.

Worth internalising because the failure is invisible in exactly the way the
identity test is: a filing that yields zero rows looks identical, downstream, to
an institution that did not file. No orphan, no row-count mismatch, no universe
check catches it.

## Byte-identity method

Parquet and sas7bdat embed timestamps, so file bytes are the wrong test. This
leg emits gzipped TSV, and gzip embeds nothing that varies here, but the
**row order is genuinely non-deterministic** regardless: worker goroutines push
to the writer in completion order, so two runs of unmodified code produce
different row orders. Canonical-dump equality is therefore the only meaningful
test, exactly as for the parquet legs.

For each quarter: `gzip -dc | LC_ALL=C sort | sha256sum`, plus row count,
manifest row count, per-column sums for all five numeric columns
(`value`, `shares`, `voting_sole`, `voting_shared`, `voting_none`), the
`cusip_valid` count, the `parse_mode` histogram and the `parse_status`
histogram — so a mismatch localises to a column instead of a hex string.

There are no floats anywhere in this output. Every numeric column is written by
`strconv.FormatInt`, so the fixed-precision rendering that the parquet legs need
is not a concern here; integers are exact.

**Result — all 38 quarters, 86,444,026 holdings rows, 248,500 manifest rows:**

```
IDENTITY: PASS — every quarter's canonical digest identical
  shipped parser (run A)  sha256(all 38 digests) = 671ef9d298a22d815b3048b012610982d8be7d45468afdfa4c7a2338d1df939a
  optimised parser (run B) sha256(all 38 digests) = 671ef9d298a22d815b3048b012610982d8be7d45468afdfa4c7a2338d1df939a
```

Three further checks:

- **The shared `canonical_hash.py`** (the primitive the other pipeline legs use)
  agrees, reached independently through parquet rather than sorted text:

  ```
  A.parquet  rows 2,692,060 x 23  sha256 c1a62dccf1e0779208b16bbfe150a35b7dae3563ca17cca7cef49ac6ff9c4565
  B.parquet  rows 2,692,060 x 23  sha256 c1a62dccf1e0779208b16bbfe150a35b7dae3563ca17cca7cef49ac6ff9c4565
  IDENTICAL (canonical sort + 12 sig digits)
  ```


- **Differential harness.** `parse_13f_go -verify-fast-xml` parses every filing
  *both ways* and compares row structs field by field. Over 2016Q4 and 2024Q2
  (12,622 filings): **0 mismatches**.
- **Frozen pre-change baseline.** Three quarters were hashed before any code was
  written; those digests match run A exactly, confirming the canonical dump is
  stable across runs despite the non-deterministic row order.
- **The committed binary is the benchmarked one.** The shipped
  `parse_13f_go` is built `-trimpath -ldflags=-s`, which the benchmark binary
  was not, so it was re-checked rather than assumed: 500 filings, 702,339 rows,
  identical holdings and manifest digests.

### Shard shape does not affect output

Run C (230 byte-balanced shards) hashes identically to run A (38 quarter shards)
on all 38 quarters. Regrouping which filings land in which output file changes
nothing, as it should: the parser holds no cross-file state.

## Fixed: filings declared windows-1252 parsed to zero rows

Found while building the differential harness, then fixed. This mattered more
than the speedup.

### The failure

`encoding/xml` refuses any document whose declaration names a non-UTF-8 encoding
when `Decoder.CharsetReader` is nil. It failed on the first token,
`parseInfoTable` broke out of its loop, and the filing returned **zero holdings
rows while still recording `parse_status=ok`, `parse_mode=xml`, `n_rows=0`** in
the manifest. Ordinary 13F-HRs with populated tables, whose only distinguishing
feature was `<?xml version="1.0" encoding="windows-1252"?>`.

A filing that parses to zero rows is an institution vanishing from ownership for
that quarter, and it is invisible downstream: a missing institution looks exactly
like an institution that did not file.

### Blast radius, measured

Re-parsed the exact set of filings that produced zero rows under the shipped
parser (7,678 of 248,500, extracted from the run A manifests):

| | |
|---|---|
| Filings recovered | **7,023** (2.83% of the corpus) |
| Holdings rows recovered | **2,628,463** — +3.04% on 86,444,026 |
| Reported value recovered | **withdrawn — see the value-unit break below** |
| Distinct institutions affected | **768** |
| Still zero after the fix | 655 — genuinely empty tables, no charset error remained |

No filing hit a charset we cannot decode: windows-1252 and ISO-8859-1 covered
the entire affected set.

**Who.** Overwhelmingly large foreign banks and asset managers plus public
pensions — Royal Bank of Canada, Barclays, CalPERS, DZ Bank, Schroder, Nomura,
Caisse de Dépôt, Two Sigma, Farallon, MetLife, Saudi PIF. Consistent with filing
agents serving clients whose names carry accented characters.

**Index managers: none of the big nine, but the set is not index-free.** No
BlackRock, Vanguard, State Street, Geode, Northern Trust, Fidelity/FMR,
Dimensional, Invesco or Schwab filing was ever affected. But smaller index and
ETF sponsors are in the 768: Global X Japan, Mirae Asset Global ETFs Holdings,
Pacer Advisors, Tortoise Index Solutions, DoubleLine ETF Adviser, Amundi Smith
Breeden. "Zero index exposure" would be too strong; "none of the largest index
managers" is what the evidence supports.

**Large active managers are hit, which is the part that matters for `ior`.**
Barrow Hanley, Fiduciary Management, Gardner Russo & Quinn, Congress Asset
Management and Cooke & Bieler are affected in **36–38 of 38 quarters** — missing
from the entire panel, not occasionally. Others are intermittent: RBC in 11
quarters of 38, CalPERS in 8, Two Sigma in 5, MetLife in 1.

That split matters more than the totals. A filer missing in *every* quarter is a
constant level bias for that institution. A filer missing in *some* quarters is
worse for anything computed on changes — the institution appears to exit and
re-enter, manufacturing spurious ownership churn in breadth, turnover and
entry/exit measures.

### Whether this reaches your panel depends on two things

The mechanism is: holdings that should exist do not. What that does to a
published number depends entirely on how the number is built, so state your own
case rather than inheriting one.

**(a) What is the denominator?**

- *Institutional aggregate* (share of total institutional ownership): the drop
  removes non-index holdings from the denominator, so index and passive shares
  are **inflated**, and the 2023Q3 step below makes that inflation
  **time-varying**. This is the dangerous case.
- *Shares outstanding* (`pct = holdings / tso`): the denominator is untouched.
  Dropped filings **understate** institutional ownership (`ior`) and leave any
  ratio whose numerator comes from a different source — mutual-fund/S12-derived
  `mf_pct`, `passive_pct`, `index_pct` — **completely unaffected**.

**(b) Where do institutional holdings come from?**

- *This EDGAR parse*: affected.
- *Thomson `s34`* (`tfn.s34type1` / `s34type3`): **not affected at all.** Thomson
  is an independent source; nothing in this defect touches it.

Both conditions must point at you for the bug to reach your numbers. A pipeline
with a `tso` denominator that sources institutional ownership from Thomson is
clear on both counts.

### The 2023Q3 step, which is the finding worth keeping

Recovered filings per quarter run ~85–130 through 2023Q2, then jump to 213 in
2023Q3 and hold near 400:

```
2016Q4  108   2019Q4  107   2022Q4   80   2025Q1  403
2018Q4  118   2020Q4   97   2023Q2   85   2025Q2  447
2019Q2  120   2021Q4   78   2023Q3  213   2025Q4  402
2019Q3  116   2022Q2   89   2023Q4  416   2026Q1  378
```

As a share of holdings rows, unit-free:

| Era | Recovered rows | Baseline rows | Share |
|---|---:|---:|---:|
| 2016Q4–2023Q2 | 876,663 | 54,844,449 | **1.60%** |
| 2023Q3–2026Q1 | 1,751,800 | 31,599,577 | **5.54%** |

**A 3.47× step up.** Distinct affected filers go from 157 to 519; recovered
filings from 2,793 to 4,230 against a *smaller* filing base. The break is a
filing-agent effect, not a filer one: agents `0001140361` (1,139 filings),
`0000905148` (501), `0000945621` (209) and others show `pre=0, post=N` — they
began emitting windows-1252 declarations partway through 2023.

For a pipeline in case (a) above, that is the paper-killing shape: a step change
in dropped non-index ownership at 2023Q3 reads as a **rise in passive share from
2023Q3 onward** — a trend in the outcome variable manufactured by a parser bug.
For a pipeline in case (b), it is 5.5% of recent holdings rows simply missing.

### The fix

`charset.go` transcodes windows-1252 and ISO-8859-1 filing XML to UTF-8 and drops
the now-inaccurate declaration before either parser sees the bytes. Both are
single-byte tables, so it needs no dependency. It is applied to the information
table and to `primary_doc.xml` — the latter matters because a rejected primary
doc silently loses `isAmendment`, `amendmentType` and `reportType`, so an
amendment stops being flagged and a notice stops being recognised.

A charset we cannot decode now returns an **error** instead of an empty table, so
the silent case cannot recur:

```
parse_status=error  error_msg=information table declares unsupported encoding "..."
```

`-decode-charset=false` reproduces the pre-fix output exactly; that is how the
recovery delta above was measured.

### Identity after the fix — expected to break, and it does

The post-fix output is **deliberately not** identical to the frozen baseline. It
is the same output plus 2,628,463 rows across 7,023 filings. Both digests are
recorded so the change is auditable in either direction:

| Baseline | Canonical digest over 38 quarters | Rows |
|---|---|---:|
| Pre-fix (runs A, B, C) | `671ef9d298a22d815b3048b012610982d8be7d45468afdfa4c7a2338d1df939a` | 86,444,026 |
| Post-fix (run E) | `d5cfd2ad2d55dbde740945297bb76c038585ebf1aa80912ab1fde38bd4e769c8` | 89,072,489 |

**All 38 quarters changed** — no quarter was clean. Manifest rows are unchanged
at 248,500, confirming the fix adds holdings to filings already being processed
rather than pulling in new filings. The full-run delta of +2,628,463 rows matches
the targeted re-parse of the 7,678 affected filings exactly, so the fix touched
those filings and nothing else.

The optimisation and the correctness fix are separate commits for exactly this
reason: the first must not change a byte, the second must.

## Separate trap: the `value` column changes units at 2023Q1

Found while trying to express the recovery above as a share of reported value.
It is not a parser defect — it is a property of the source — but it invalidates
any sum of `value` that spans 2023Q1, so it belongs next to the rest.

Mean reported value per holding, from the run A per-quarter sums:

```
2022Q2     177,575     2023Q1  12,794,119
2022Q3     142,336     2023Q2  16,698,741
2022Q4     152,644     2023Q3  17,571,065
```

Quarter-sharp, ~84× on the mean, and permanent. Composition cannot do that in one
quarter, and the distribution confirms it is a rescaling rather than a few large
filers — for 2022Q4 → 2023Q1 the median moves 565 → 249,875 (**442×**) and p90
19,329 → 9,555,120 (**494×**). Consistent with Form 13F moving from thousands of
dollars to whole dollars.

**It is not a clean 1000×, and that is the trap inside the trap.** p10 moves only
38× against p90's 494×, so the post-2023 population is *mixed*: most filers
switched to whole dollars, some are still reporting thousands. There is no single
scale factor that repairs the column.

Consequences:

- **Do not sum or average `value` across 2023Q1.** A panel-wide total is
  meaningless, and a value-weighted statistic spanning the boundary is dominated
  by the units, not the holdings.
- **A value-based share is only interpretable within an era**, and even then only
  loosely, given the mixed population after 2023Q1.
- This is why the recovery above is reported in **filings and rows**, which are
  unit-free. An earlier draft of this document quoted "+3.84% of reported value";
  that figure summed a column whose unit changes mid-panel, over a recovered set
  concentrated in the post-2023 era where the unit is ~1000× larger. It was
  withdrawn rather than patched — there is no correct scalar to patch it with.

Detect it yourself before trusting any value aggregate:

```bash
gzip -dc out/*.tsv.gz | awk -F'\t' '$12>0 {
  q=substr($5,1,4)"Q"int((substr($5,5,2)-1)/3)+1; v[q]+=$12; n[q]++ }
  END{ for (k in v) printf "%s %.0f\n", k, v[k]/n[k] }' | sort
```
