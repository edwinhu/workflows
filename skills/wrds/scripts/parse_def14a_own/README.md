# parse_def14a_own — DEF 14A beneficial-ownership tables on the WRDS grid

Parses `DEF 14A` proxy statements straight out of `/wrds/sec/archives` into
gzipped TSV: **one row per (filing, holder row × share class)**, plus a manifest
row per filing. The table it extracts is the proxy's *Security Ownership of
Certain Beneficial Owners and Management*: named 5% holders, individual
directors and officers, and the "all directors and executive officers as a
group" row.

Ported from `r2000/tools/proxyown` on 2026-09-28. The extraction core is that
code unchanged; only the driver differs (archive filelist in, gzipped TSV out,
SGE shards instead of a local fetch manifest). Parity was verified before the
port was accepted — see *Measured numbers* below.

## Why this is a binary and not a `scan_covers` profile

The wrds skill's Iron Law says EDGAR extraction is a `scan_covers` profile, with
two sanctioned exceptions (`parse_13f`, `parse_npx`). This is a third, for the
same structural reason and no other: `scan_covers` reduces a regex to **one
value per column per filing**, and its `FullBody` mode hands the whole document
to a pattern. A proxy ownership table is a *record table* — tens to hundreds of
(holder, shares, percent, class) rows per filing — and, worse, its columns only
exist in the HTML **DOM**. Stripping tags to run a pattern over the text
destroys the row/column structure the extraction depends on: the same choice
measured R=0.245 for a regex director parser against R=0.813 for the DOM parser
in the board-structuring project. `html.Parse` → colspan/rowspan-expanded grid →
column-role inference is not expressible as a profile field.

Cover-page or header extraction from a proxy is still a profile. This exception
covers the ownership table only.

## Layout

```
parse_def14a_own_go/     the parser (Go; stdlib + golang.org/x/net/html)
  sgml.go                primary document out of an SGML dissemination file; HTML vs ASCII
  grid.go                HTML DOM -> per-<table> rectangular grid, colspan/rowspan expanded
  section.go             finds the ownership heading; labels table_kind
  extract.go             grid -> rows: column roles, multi-class pairing, the comp-table guard
  parse.go               share counts, percents, footnote markers, group rows
  textfallback.go        pre-2001 ASCII (<TABLE>/<S>/<C>, dot leaders, column-aligned)
  main.go                filelist driver; gzipped TSV rows + manifest
  *_test.go              16 tests over synthetic fixtures
sge/
  make_filelists.sas     per-year DEF 14A filelists from /wrds/sec/sasdata/wrds_forms
  scan_sizes.py          stat every filing -> sizes.tsv  (shard planning input)
  build_shards.py        byte-balanced shard lists
  scan_shard.sh          SGE array worker, one shard per task
  submit_shards.sh       SGE array wrapper
  run_sas.sh             run one SAS program on a compute node
  run_python.sh          run one python3 script on a compute node
gold/                    gold-set builders (WRDS Blockholders, FactSet, ISS directors)
                         + the holdout splits
  sample_full_archive.py the FIXED year-stratified full-archive sample (seed 20260929)
  build_regress_set.py   the FIXED regression set — the diff of the two full-archive
                         panels — and the round filelist (gold ∪ ISS ∪ sample ∪ regress)
scorer/score.py          scores parser output against the gold sets; --check gates the grind
scorer/score_test.py     tests for the ISS name matcher, the duplicate-excess counters
                         and the regression-set recovery counters (stdlib)
thresholds.json          the locked pass thresholds
lock.sha256              scorer + gold + thresholds hashes the scorer verifies before scoring
check.sh                 the grind's --check
gate.sh                  the grind's --gate (2026-09-30): open when the round is done OR
                         provably orphaned, shut while a job is queued/running
gate_lib.sh              sourced by run_baseline.sh: records the submitted job ids and the
                         round state that gate.sh reads. Not executable on its own
gate_test.sh             gate.sh + gate_lib.sh against a stubbed qstat, no grid (24 checks)
run_baseline.sh          build -> stage -> qsub -> fetch -> score, one command
                         (--fetch-only skips build/submit: brings an orphaned round home)
GRIND_PLAN.md            baseline, thresholds argument, and the launch commands
GRIND_PROMPT.md          the per-iteration prompt the loop hands a fresh agent
```

## Running it

Everything runs on compute nodes. SAS is not on the login host's PATH, and the
login host must not run compute at all.

```bash
ROOT=/scratch/nyu/eddyhu/parse_def14a_own
mkdir -p $ROOT/{bin,filelists/shards,out,logs}
cp -r sge $ROOT/ && cp parse_def14a_own_go/parse_def14a_own_go $ROOT/bin/

# 1. filelists, one per FILING-date year
qsub -pe onenode 2 -l m_mem_free=8G sge/run_sas.sh $ROOT/sge/make_filelists.sas

# 2. true file sizes — wrds_forms.fsize is unusable
qsub -pe onenode 2 -l m_mem_free=8G sge/run_python.sh $ROOT/sge/scan_sizes.py $ROOT/filelists

# 3. byte-balanced shards
python3 $ROOT/sge/build_shards.py $ROOT/filelists/sizes.tsv \
        $ROOT/filelists/shards --target-mb 400

# 4. SMOKE TEST FIRST — one shard
cd $ROOT && qsub -t 1-1 sge/submit_shards.sh

# 5. full run, once the smoke test is clean
qsub -t 1-$(wc -l < filelists/shards/chunks.txt) sge/submit_shards.sh
```

Output lands in `$ROOT/out/<shard>.tsv.gz` plus a matching
`.manifest.tsv.gz`. For the gold-linked subset the whole sequence is one
command: `bash run_baseline.sh`.

### Full archive, 1994-2026

`make_filelists.sas` takes `-sysparm "OUTDIR|D0|D1"` (defaults reproduce the
gold-linked 1996-2021 range), passed as `run_sas.sh`'s second argument. Use a
SEPARATE `$ROOT` so the gold run's filelists and outputs are not clobbered:

```bash
ROOT=/scratch/nyu/eddyhu/def14a_full
qsub -pe onenode 2 -l m_mem_free=8G -o $ROOT/logs/ -e $ROOT/logs/ \
     sge/run_sas.sh $ROOT/sge/make_filelists.sas "$ROOT/filelists|01JAN1994|31DEC2026"
qsub -pe onenode 2 -l m_mem_free=8G -o $ROOT/logs/scan_sizes.out -j y \
     sge/run_python.sh $ROOT/sge/scan_sizes.py $ROOT/filelists
python3 sge/build_shards.py filelists/sizes.tsv filelists/shards --target-mb 400
qsub -cwd -t 1-1004 -tc 10 -l m_mem_free=16G -pe onenode 1 -o $ROOT/logs/ -j y \
     -v DEF14A_ROOT=$ROOT,SHARD_LIST=$ROOT/filelists/shards/chunks.txt,\
SHARD_DIR=$ROOT/filelists/shards,OUT_DIR=$ROOT/out,BIN=$ROOT/bin/parse_def14a_own_go,\
ARCHIVE_ROOT=/wrds/sec/archives,CONCURRENCY=4 \
     sge/scan_shard.sh
```

`scan_shard.sh` and `submit_shards.sh` carry no `#$ -cwd`, so `qsub -cwd` and a
path relative to `$ROOT` are required; `submit_shards.sh`'s hard-coded `#$ -o`
points at the gold root, which is why the full run bypasses it and qsubs
`scan_shard.sh` directly with `-v`.

**`m_mem_free=16G` and `CONCURRENCY=4` are not optional at this scale.** The
full archive contains a **558.4 MB** filing (`0000028412-24-000226`) and 1,090
filings over 50 MB; `x/net/html` builds a DOM several times the source size, and
the gold run's `4G`/`8` would run four of those concurrently.

**Measured, 2026-09-29, SGE array 40330353** (commit `4b36a962`, binary rebuilt
from source, sha256 `8236f718…`):

```
filelist:  207,912 DEF 14A filings, 1994-08-30 .. 2026-09-25, 33 year buckets
sizes:     files=207912 missing=0 total_gb=391.36 mean_kb=1973.8
shards:    shards=1004 bytes_min=227.9MB max=605.8MB mean=418.5MB imbalance=44.7%
run:       1004/1004 status=0, 0 failed, 0 resubmitted
           files=207912 rows=2903798 manifest=207912
           wall 2,618 s (43 min 38 s) at -tc 10; Σ task wall 22,907 s; longest task 320 s
```

Panel-wide `filing_yield_parsed_percent` **0.8454** and
`group_row_detection_rate` **0.7838**, both below the gold dev split (0.8921 /
0.9067) — the gold sets are built from Blockholders / FactSet / ISS and
under-represent 1994-1996 entirely. Full per-year table, spot checks and the
duplicate-row diagnostic: `~/projects/r2000/scratch/def14a_full_run.md`.

**Re-run 2026-09-29 at commit `092b6fb9`, SGE array 40334523** — same filelist and
shard plan (all three hashes reproduced), binary sha256 `d53b81d7…`. The current
panel is that run; the `4b36a962` panel is kept beside it at
`/data/def14a_own/panel_e4e78a95/`:

```
run:       1004/1004 status=0, 0 failed, 0 resubmitted
           files=207912 rows=3156227 manifest=207912  (+8.69% rows)
           wall 4,851 s (1 h 21 m) at -tc 10; Σ task wall 29,683 s
           shard-paired against run 1: 1.30x slower, 983/1004 shards slower, none >2x
yield:     filing_yield_parsed_percent 0.8486 (+0.32 pp), group_row_rate 0.7798 (-0.41 pp)
dups:      identical-row excess 1.90% -> 0.28%; same-(kind,holder,class) 8.43% -> 2.21%
```

The group-row rate FELL in 14 of 33 years by more than 0.5 pp. 1,181 filings lost
their group row; in 1,057 of them the lost row carried no percent and came from a
compensation or option table, but **124 filings lost a percent-carrying D&O group
row, and 1,070 filings went from ≥1 row to 0 rows** (against 465 the other way) —
the tables that used to produce the additive-layout duplicates are now rejected
whole in some filings. Per-year table, flags and spot checks:
`~/projects/r2000/scratch/def14a_full_run2.md`.

**Known defect 4 as measured on the `4b36a962` panel — mostly bought back at HEAD
(2.43% under the same key, see the re-run block above), but the mechanism below is
what the remaining excess is.** It is a GRAIN defect, not only
an over-emission one. Exact-key duplicate rows — same
`(accession, cik, holder_name, share_class)` — are **9.00%** of the panel, and
32.65% in 2009, 19.93% in 2018, 18.75% in 2024. Diagnosed 2026-09-29 (duckdb over
the panel, then `-debug` on 12 of the worst filings; full write-up in
`GRIND_PLAN.md` §9 and `~/projects/r2000/scratch/def14a_dup_setup.md`):

```
excess TOTAL                                       261,460   9.004%
  SAME table_kind  — over-emission                 244,792   8.430%
     of which inside ONE table_index               125,576   4.324%
  CROSS table_kind — the 5% table AND management     16,668   0.574%   (legitimate)
```

**86.5% of the within-one-table excess carries `share_class=""`.** The class or
series identity of a value column is never written into `share_class`, so rows that
ARE distinct collapse onto one key: a multi-level header naming the class over each
`(shares, percent)` pair, a row-level `Title of Class` / `Title of Series` column
roled `other` (or, worse, roled `name`, so `holder_name` becomes `Admiral Shares`),
and fund-family proxies with one 5%-holder table per fund. A separate, genuinely
spurious family is director COMPENSATION tables attached once per fund, with
dollars in `shares`.

**So do NOT blindly deduplicate on that key.** 59,969 of the excess rows carry
DIFFERING `shares` — those are real per-series holdings whose label is missing, and
dropping them loses data. Until the parser populates `share_class`: dedup only
where the duplicate rows are byte-identical, and treat a filing with many
same-`table_kind` duplicates (the fund-family and multi-class families above) as
unusable for a `shares` sum. **Also note** that co-registrant copies inflate the
per-CIK count and are by design: counting each accession once, 2018's same-kind
excess is 4,718, not 18,165.

### The filelist carries metadata, unlike parse_13f's

`parse_13f`'s filelists are bare archive paths because a 13F carries its own
period of report inside the document. A proxy's ownership table does not carry
the filing date, so `filelist_YYYY.tsv` here is TAB-separated:

```
relpath <TAB> cik <TAB> accession <TAB> form <TAB> fdate [<TAB> company]
```

A bare path list still works — `cik` and `accession` are recovered from the path
— but `filing_date` and `proxy_year` come out empty.

**The `put` statements need `+(-1)` before every tab.** SAS list output inserts a
blank after each item, so without it every field — the archive path included —
carries a trailing space and nothing stats. Fixed 2026-09-29; before that the
SAS generator had never been run end to end (the gold filelist was built in
Python), and the first full-archive size scan reported all 207,898 files
missing. Do NOT add `+(-1)` after a quoted literal: PUT writes those with no
trailing blank, so it eats the last character.

**The grain is `(cik, accession)`, not `accession`.** 1,798 accessions in
1994-2026 appear under more than one CIK — co-registrant proxies, stored once
per CIK directory in the archive — so the same document is parsed twice and
contributes two identical row sets under different `cik`s. Deduplicate on
`accession` before any firm-level count.

## Output contract

`<shard>.tsv.gz`, 19 columns, one row per (filing, holder row × share class):

```
accession  cik  company  filing_date  table_kind  table_index  row_index
holder_name  shares  percent  percent_marker  share_class  is_group_row
group_n_persons  footnote_markers  parser  source_file  proxy_year  is_institution
```

`shares` and `percent` are EMPTY when the document did not state one — never
zero. `percent_marker` carries the unparseable-but-meaningful forms (`*`,
`<1%`, `none`). `percent` is **percent of class**, which for a dual-class firm
is not percent of shares outstanding (see *Known defects*).

`<shard>.manifest.tsv.gz`, 14 columns, one row per filing *whatever happens to
it*:

```
accession  cik  filing_date  form  source_file  bytes  parser  tables_seen
tables_used  n_rows  n_percent_parsed  has_group_row  parse_status  error
```

**A filing that parses to zero rows is invisible in the rows file.** It looks
exactly like a proxy with no ownership table. That is what the manifest is for:

```bash
# filings where a table was found but nothing parsed out of it
gzip -dc out/*.manifest.tsv.gz | awk -F'\t' '$13=="ok" && $9>0 && $10==0'
# filings that failed to read at all
gzip -dc out/*.manifest.tsv.gz | awk -F'\t' '$13!="ok"'
```

`scan_shard.sh` asserts `manifest_rows == files_in` and exits 5 otherwise: a
silently short shard becomes a silently short panel.

## Measured numbers

**Parity against the r2000 extractor** (2026-09-28). The same 273 cached DEF 14A
filings for 10 companies, 1997-2024, 260 MB, run through the ported binary:

```
$ ./parse_def14a_own_go -files-from filelist.tsv \
    -archive-root /home/eh/projects/r2000/data/raw/def14a_test \
    -out rows.tsv.gz -manifest man.tsv.gz -concurrency 24
filelist rows in: 273
filings processed: 273
filings with >=1 table row: 271
filings with >=1 parsed percent: 257
filings with a D&O group row: 230
filings with a read/parse error: 0
ownership rows out: 6651
exit=0
```

Identical to the r2000 run on every count (271 / 257 / 230 / 6,651), so the port
changed the driver and nothing else.

**Determinism** (E1/E4). Three consecutive runs, byte-identical output:

```
$ sha256sum rows{1,2,3}.tsv.gz
11e7f77d47b452597cbd24ab828f03cef598a0701d10d8982f6c3a44e0102eb6  rows1.tsv.gz
11e7f77d47b452597cbd24ab828f03cef598a0701d10d8982f6c3a44e0102eb6  rows2.tsv.gz
11e7f77d47b452597cbd24ab828f03cef598a0701d10d8982f6c3a44e0102eb6  rows3.tsv.gz
```

The sort must be STABLE: workers finish in arbitrary order and two rows with an
equal key (the same table row emitted for two class pairs) would otherwise swap
between runs.

**Precision** (measured in r2000, unchanged by the port): 298/303 = 98.35%
automated on a 10-proxy hand-checked sample, 303/303 = 100% after
hand-adjudicating the five failures, all of which were the *harness* breaking on
accented names. Quote 98.35% — it is the reproducible figure.

**On a WRDS compute node** (2026-09-28, SGE job 40327330, one shard of 10
filings — the mandatory smoke test before anything larger):

```
[scan_shard] task=1 shard=smoke_00 slots=1 concurrency=8 start=2026-09-28T23:26:12-04:00
filelist rows in: 10
filings processed: 10
filings with >=1 table row: 10
filings with >=1 parsed percent: 10
filings with a D&O group row: 8
filings with a read/parse error: 0
ownership rows out: 196
[scan_shard] task=1 shard=smoke_00 status=0 files=10 ownership_rows=196 manifest_rows=10 wall=2s
```

**Full gold-linked pass** (SGE array 40327587, 13 byte-balanced shards, 1 slot
each, longest task 54 s):

```
$ ssh wrds 'qsub ... sge/run_python.sh sge/scan_sizes.py .../filelists'
files=9968 missing=0 total_gb=4.94 mean_kb=519.9 -> .../filelists/sizes.tsv
$ python3 sge/build_shards.py filelists/sizes.tsv filelists/shards --target-mb 400
shards=13 filings=9968 bytes_min=408.2MB max=408.2MB mean=408.2MB imbalance=0.0%
$ bash run_baseline.sh
ownership rows=156750 manifest rows=9968 filelist rows=9968
```

9,968 filings / 4.94 GB / 156,750 ownership rows, every filing accounted for in
the manifest. Per-metric scores against the gold sets, the miss decomposition and
the proposed thresholds are in [`GRIND_PLAN.md`](GRIND_PLAN.md).

## Gold sets, holdout and scoring

Data lives outside git, under `/data/def14a_own/gold/` locally (mirror the same
four files to WRDS scratch when scoring there). Each artifact has a JSON sidecar
carrying its SQL, parameters, pull date, row counts and sha256.

```bash
python3 gold/pull_def14a_index.py                 # DEF 14A index, metadata only
python3 gold/build_gold_blockw.py                 # (a) WRDS Blockholders 1996-2001
python3 gold/build_gold_factset.py --user edwin_hu  # (b) FactSet stakes 2006-2021
python3 gold/make_holdout.py                      # 20% of FIRMS held out, seed 20260928
python3 gold/profile_iss.py                       # (c) READ-ONLY profile of the ISS tables
python3 gold/build_gold_iss.py                    # (c) ISS directors 2002-2024, linked
python3 gold/sample_gold_iss.py                   # (c) sample seed 20260929 + split seed 20260930
python3 gold/sample_full_archive.py               # (d) the FIXED full-archive sample, seed 20260929
bash make_lock.sh                                 # hash-lock scorer + gold + sample + thresholds
python3 gold/build_regress_set.py                 # (e) the FIXED regression set + round filelist
bash make_lock.sh                                 # hash-lock scorer + gold + sample + thresholds
bash run_baseline.sh                              # grid pass + score
bash check.sh                                     # the check: 0 pass, 1 short, 2 no output, 3 lock broken
bash gate.sh                                      # the gate: 0 spend a model call, 1 wait
bash gate_test.sh                                 # the gate's test (stubbed qstat, no grid)
```

### The gate — and why it is not `test -f round-ready`

`run_baseline.sh` removes `$DEF14A_WORK/out/round-ready` when it starts a pass and
re-creates it after the fetch and score, so a bare `test -f` on it looked like a
sufficient gate. It is not: **twice on 2026-09-29** a grind iteration ended while its
round's SGE job was still queued, the iteration's process group died, `qsub -sync y` died
with it, and the marker was therefore never written — the loop then waited forever on a
file no surviving process was going to create.

So `run_baseline.sh` now records the submitted job ids and its own pid **before** it waits
(`out/round-jobs.tsv`, `out/round-state.json`, written by `gate_lib.sh` at the moment SGE
prints the id, which is before `-sync y` blocks), and `gate.sh` decides from the grid and
the process table rather than from a process surviving:

| exit | when |
|---|---|
| 0 | `out/round-ready` exists (normal) |
| 1 | the recorded `run_baseline.sh` pid is alive, per `/proc/<pid>/cmdline` |
| 1 | a recorded SGE job id is still in `qstat` |
| 1 | a job named `^def14a` is on the grid but not in `round-jobs.tsv` (an un-recorded round) |
| 1 | the scheduler could not be reached — a failed query is not a finished job |
| 0 | nothing recorded and no `def14a` job on the grid; **no marker is invented** |
| 0 | **orphaned** — pid gone, jobs gone, marker absent → re-creates it, reason in `out/round-orphaned` |

Every branch says why, on stdout and in `out/round-gate.log`. `gate.sh` never fetches and
never scores: if the orphaned round died at `phase=array` or earlier, its grid output was
never brought home, and the message says to run `bash run_baseline.sh --fetch-only` before
trusting any metric from `$DEF14A_WORK/out`. Overrides: `DEF14A_QSTAT` (the listing
command — the test stubs it), `DEF14A_JOB_NAME_RE` (default `^def14a`),
`DEF14A_GATE_QUIET=1`.

Gold set (c) needs a DEF 14A index that reaches past 2021, which
`def14a_index.tsv.gz` does not; `def14a_index_iss.tsv.gz` (2002-2025, 149,759
rows) is pulled by running `pull_def14a_index.py` with `--start 2002-01-01 --end
2025-12-31` into a scratch dir and renaming. The original index is left alone so
gold sets (a) and (b) stay reproducible.

**ELEVEN metrics gate as of 2026-10-01** (the eight below plus
`regress_zero_row_recovered`, `regress_group_row_recovered` and, since 2026-10-01,
`regress_lost_recovered` over the lost set (c), all floors at 0.95 —
see the regression-ruler section). `minimums` are floors, `maximums` are
ceilings, and score.py reads both from the locked thresholds file. The duplicate-row
round (`GRIND_PLAN.md` §9) added a fourth ruler — `gold/sample_full.tsv`, a fixed
year-stratified sample of the whole archive (8,250 filings, ~250 per filing year
1994-2026, seed 20260929, gold-linked filings excluded) — and three gates over it:
a duplicate-rate ceiling pooled ≤ 0.01, the same ceiling per year ≤ 0.02, and
`sample_yield_worst_year_margin` ≥ 0.0 (a per-year no-regression floor
recorded in `_sample_yield_floor_by_year`). **The duplicate ceilings were REDEFINED
later the same day** (`GRIND_PLAN.md` §10): they now key on the IDENTICAL ROW —
`sample_dup_excess_identical_row_rate` and `_max_year`, same 0.01 / 0.02 — because
the earlier key, `(accession, cik, holder_name, share_class)` within one
`table_kind`, counted one holder listed once per managed account with distinct
shares and percent as duplicates. `sample_dup_excess_same_table_rate` and
`_max_year` are kept as DIAGNOSTICS. `run_baseline.sh` therefore submits
`gold/round_filelist.tsv` — gold ∪ ISS ∪ sample ∪ regress, **22,856** filings since
the regression round (21,128 before it) — and score.py exits **2** if the output does
not cover the sample or the regression set.

**`iss_director_recall` is GATED as of 2026-09-29** (`GRIND_PLAN.md` §8.5A) at
the permanent no-regression floor **0.82** — it was 0.90 as a round target while
the ISS round ran, and was reset when the round closed (§8.5B, step 2). The other three ISS metrics —
`iss_share_agreement_1pct`, `_5pct` and `iss_individual_precision_proxy` — stay
DIAGNOSTIC: they print with their denominators, by era, on every scoring run and
cannot change `check.sh`'s exit code.

**Every round parses BOTH gold filelists.** `run_baseline.sh` defaults to
`gold_filelist_all.tsv` and refuses to submit a filelist that does not cover both
`gold_filelist.tsv` and `gold_iss_filelist.tsv`; `score.py` exits 2 if the parser
output does not cover the ISS gold filings, so a gated recall is never computed
over a denominator the round chose for itself. The union filelist is a superset
of `gold_filelist.tsv`, and because `score.py` keys on `(cik, accession)` the
existing gold round is unaffected (verified: the four pre-existing gated metrics
byte-identical before and after — 0.8921 / 0.7873 / 0.8304 / 0.9067).

`scorer/score_test.py` (11 tests, stdlib) covers the ISS surname + first-initial
matcher, the natural-person test and the era buckets. Run it after any edit to
those functions: they decide every ISS number.

`factset_own` is licensed on the `edwin_hu` account only; `block_all` and
`wrdssec` are on `eddyhu`. Never pull the filing text through SQL —
`wrds_sec_search.filing_def` is 45 GB of document bodies and the archive is
mounted on the compute nodes.

`score.py --holdout` refuses (exit 4) while `GRIND_ITERATION` is set. The holdout
is scored once, by a human, after a grind ends.

### Result — ISS director-recall round, 2026-09-29 (CLOSED)

`check.sh` green at **iteration 7**, commit `e3864f83`. Dev (2,259 ISS filings,
19,586 non-flagged director rows): `iss_director_recall` **0.9135**,
`filing_yield_parsed_percent` 0.8921, `holder_recall_blockw` 0.7871,
`holder_precision_blockw` 0.8301, `group_row_detection_rate` 0.9067.

ISS holdout (741 filings, 6,759 non-flagged director rows), pre → post:
`iss_director_recall` **0.8735 → 0.9130**, `iss_share_agreement_1pct` 0.7666 →
0.7687 (diagnostic), `iss_individual_precision_proxy` 0.9733 → 0.9840
(diagnostic). Post metrics:
`/data/def14a_own/work/metrics_iss_holdout_post_20260929.json`. The +0.0395
holdout gain against +0.0452 on dev says the recall generalised rather than
being bought from the dev split; 0.9130 leaves 0.0930 of margin over the 0.82
floor.

**ALL THREE HOLDOUTS ARE SPENT.** `holdout_20260928_spent.tsv` and `holdout.tsv`
(both blockw) and `holdout_iss.tsv` (ISS, scored pre and post on 2026-09-29)
have each been scored and are dev data from here on. A future round that needs
an honest generalisation estimate must draw a fresh split first.

### The REGRESSION ruler — a fixed diff of the two full-archive panels (2026-09-29)

Built once by `gold/build_regress_set.py` from `/data/def14a_own/panel_e4e78a95`
(parser `4b36a962`) against `/data/def14a_own/panel` (parser `092b6fb9`), because the
`092b6fb9` re-run bought a 6.8x fall in the identical-row duplicate rate and +0.32 pp
of yield while losing recall no gate could see: **1,070** filings went from >= 1
ownership row to zero, and **1,181** lost a D&O group row (1,618 group rows, 176 of
them carrying a percent).

```
gold/gold_regress.tsv       1,893 candidate filings, one row each, with set flags
gold/regress_filelist.tsv   the parser-format filelist the round submits
gold/gold_regress.json      sidecar: the rules, the counts, the hashes
gold/round_filelist.tsv     gold ∪ ISS ∪ sample ∪ regress = 22,856 filings
```

| set | definition | n | gated |
|---|---|---:|---|
| (a) zero-row | old `n_rows` > 0, new `n_rows` == 0, after exclusions | **648** (933 before the 2026-09-30 correction) | `regress_zero_row_recovered` >= 0.95 |
| (b) group-row | old group row, new none, >= 1 lost group row had a percent | 83 | `regress_group_row_recovered` >= 0.95 |
| (b) share-only | the same without the percent requirement | 1,054 | diagnostic |
| excluded | old rows demonstrably wrong — X1 `$` in a holder name (96), X2 >= 3 rows all one identical (shares, percent) pair (58), X3 fund dollar-range table (327), X4 per-fund compensation table (43) | **437** | diagnostic, per clause |

X1/X2 were checked against the documents — dollar-range-of-equity tables
(`0001193125-12-089540`, `0000875626-06-000515`, `0000930413-02-002213`,
`0000950116-02-000782`) and a summary compensation table (`0000891554-99-000468`). The
wider rule "the old parse emitted no percent anywhere" was REJECTED because GE 2013
(`0001206774-13-001019`) states no percent at all and its old rows are the real table.

**X3 and X4 were added 2026-09-30**, quoted verbatim from the grind's own floors
`regress-zero-row-ceiling-0.761-dollar-range-tables` and
`regress-zero-row-ceiling-0.734-refined`, which measured that set (a) was mis-specified:
205 N-1A fund dollar-range tables and 43 per-fund compensation tables (all 43 one
document, `0000051931-18-000890`, under 43 co-registrant CIKs) had OLD rows that were
themselves wrong and that the duplicate round removed on purpose, capping the gate at
685/933 = 0.7342. X3 = no old row carries a percent AND >= half the old `shares` values
are in `{0,1,10000,50000,100000,500000,1000000}`. X4 = no percent anywhere AND >= 3
distinct old `table_index` values AND >= half the old rows carry a `holder_name`
repeating 3+ times. **The 0.95 thresholds did not move**; the SET was corrected, 285
filings left set (a), and `regress_filelist.tsv` / `round_filelist.tsv` are
byte-identical, so nothing about what a round parses changed. See GRIND_PLAN §12.

`regress_excluded_emitting_rows_rate` reports the **422** excluded filings that were
zero-row candidates, and score.py now also prints a rate PER CLAUSE
(`regress_x3_dollar_range_table_emitting_rows_rate` and friends, denominators x1 83 /
x2 58 / x3 325 / x4 43, overlapping); a rise means the round re-accepted those tables,
and `textMoneyBlock` must not be weakened. Both gates read **0.0000 at HEAD by
construction** when the set was cut — the panel is the parser at HEAD.

`gold_regress.tsv` joins `lock.sha256`, which now covers **10** files.

### Wall time per shard — diagnostic, never gated (2026-09-29)

`run_baseline.sh` fetches the shard logs to `$DEF14A_WORK/shard_logs/`, writes
`$DEF14A_WORK/shard_wall.tsv` (`shard`, `files`, `ownership_rows`, `wall_s`) and prints
shards / total / median / max / mean and the slowest five. The duplicate rounds made
the parser **1.30x** slower shard-paired over the full archive (22,907 s -> 29,683 s,
983 of 1,004 shards slower, worst on the late-era HTML shards). It is reported so the
cost stays visible; gating it would pay the loop to stop parsing.

## Known defects

Carried over from the r2000 build and not yet fixed; these are the grind's work
list, and the scorer's miss decomposition counts them.

1. **ASCII group rows that wrap over three lines are not assembled.** Berkshire's
   pre-2001 proxies write "Directors and / executive / officers as a group" down
   the name column. The values extract correctly but attach to a holder called
   "Directors and", and `is_group_row` is false.
2. **Percent of class is not percent of shares outstanding.** For a dual-class
   firm the insider block sits in the super-voting class, so a max across classes
   is a voting statistic. Both conventions are defensible and the parser emits
   neither as canonical — it emits the class label and lets the consumer choose.
3. **ASCII multi-column percent rows are truncated to one holding per line**
   unless two complete (shares, percent) pairs are present. Deliberate — it
   removes voting-power and economic-interest columns that were being emitted as
   phantom classes — but it drops genuine second-class values in a few pre-2001
   filings.
4. **Extra tables are sometimes attached** (a 401(k) table, an option table with
   no percent). They inflate `n_rows` and contribute nothing to a percent-keyed
   summary.
5. **Hard-wrapped ASCII is unrecovered.** A proxy wrapped at ~60 characters
   splits every table row across two lines; no re-flow heuristic exists.
6. **`table_kind` was never audited.** Precision was measured on values, not on
   labels.

## Rebuilding the parser

Go is not installed on the grid. Build locally and copy the static binary:

```bash
cd parse_def14a_own_go && go vet ./... && go test ./... && \
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false \
    -o parse_def14a_own_go .
```

**`-buildvcs=false` is not optional, and it is why the binary kept looking
"modified" after a run it did not change.** `go build` defaults to
`-buildvcs=auto`, which stamps the git revision into the binary. Identical source
at two commits therefore produces two different sha256s of *exactly the same
length*, which reads like a rebuild and is not one. Measured 2026-09-29:

```
$ go version -m parse_def14a_own_go            # the working-tree binary
	build	vcs.revision=4b36a9621372be775e1833da7e067117fbdace7e
	build	vcs.modified=false
$ git show HEAD:…/parse_def14a_own_go | go version -m /dev/stdin   # the committed one
	build	vcs.revision=e3864f835cf6fb596b906068ddabe0b80603cf0c
	build	vcs.modified=true
```

Same source, two stamps, two hashes (`8236f718…` vs `181617fd…`). With
`-buildvcs=false` the build is reproducible and invariant to repo state — three
builds, one clean and one with a dirty tree, all `beb332f1aed4cb96…`:

```
$ for i in 1 2; do CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -buildvcs=false -o /tmp/novcs_$i .; done
$ sha256sum /tmp/novcs_1 /tmp/novcs_2
beb332f1aed4cb9609ec3444c60560ab08b6d08d9ac78a47936ce07dd303672d  /tmp/novcs_1
beb332f1aed4cb9609ec3444c60560ab08b6d08d9ac78a47936ce07dd303672d  /tmp/novcs_2
```

`run_baseline.sh` passes the flag, so the committed binary is reproducible from
HEAD source by anyone who runs the command above.

`-debug <file>` prints the document-item stream and every candidate grid for one
filing, which is the first thing to run on a filing the parser got wrong.
