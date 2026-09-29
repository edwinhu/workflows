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
scorer/score.py          scores parser output against the gold sets; --check gates the grind
scorer/score_test.py     tests for the ISS name matcher and person test (stdlib)
thresholds.json          the locked pass thresholds
lock.sha256              scorer + gold + thresholds hashes the scorer verifies before scoring
check.sh                 the grind's --check
run_baseline.sh          build -> stage -> qsub -> fetch -> score, one command
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

### The filelist carries metadata, unlike parse_13f's

`parse_13f`'s filelists are bare archive paths because a 13F carries its own
period of report inside the document. A proxy's ownership table does not carry
the filing date, so `filelist_YYYY.tsv` here is TAB-separated:

```
relpath <TAB> cik <TAB> accession <TAB> form <TAB> fdate [<TAB> company]
```

A bare path list still works — `cik` and `accession` are recovered from the path
— but `filing_date` and `proxy_year` come out empty.

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
bash make_lock.sh                                 # hash-lock scorer + gold + thresholds
bash run_baseline.sh                              # grid pass + score
bash check.sh                                     # the gate: 0 pass, 1 short, 3 lock broken
```

Gold set (c) needs a DEF 14A index that reaches past 2021, which
`def14a_index.tsv.gz` does not; `def14a_index_iss.tsv.gz` (2002-2025, 149,759
rows) is pulled by running `pull_def14a_index.py` with `--start 2002-01-01 --end
2025-12-31` into a scratch dir and renaming. The original index is left alone so
gold sets (a) and (b) stay reproducible.

**`iss_director_recall` is GATED as of 2026-09-29** (`GRIND_PLAN.md` §8.5A) at
the permanent no-regression floor **0.82** — it was 0.90 as a round target while
the ISS round ran, and was reset when the round closed (§8.5B, step 2). The
gated count is therefore **five**. The other three ISS metrics —
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
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o parse_def14a_own_go .
```

`-debug <file>` prints the document-item stream and every candidate grid for one
filing, which is the first thing to run on a filing the parser got wrong.
