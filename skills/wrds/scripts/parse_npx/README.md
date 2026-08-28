# parse_npx — Form N-PX proxy-vote parser for WRDS EDGAR

A standalone Go binary that turns raw N-PX dissemination files on `/wrds/sec/archives`
into two gzipped TSVs: one row per vote, one row per filing. Sibling of
`../parse_13f/`, and modelled on it — filelist-driven, worker pool, no stdin, no
header row, all per-file errors to stderr.

It exists because the item-level proxy-vote panel in `skills/npx-ownership-panel`
is built entirely from ISS Voting Analytics, a vendor table whose fund-side
coverage is neither complete nor auditable. Form N-PX is the primary source for
the same votes, so parsing it gives the panel an independent measurement to
reconcile against rather than a number to trust.

## Why a standalone binary rather than a `scan_covers` profile

`skills/wrds/SKILL.md` carries an Iron Law against new standalone EDGAR binaries
in favour of a `scan_covers` profile. The law targets cover-page extraction.
`scan_covers` `FullBody` mode reads the entire file into one buffer per worker
and its `Field` model reduces a regex to one value per column. An N-PX filing is
23.8 MB with 28,067 nested vote records — neither one buffer nor one value per
column. This parser streams with `xml.Decoder` at constant memory instead.
`parse_13f` is the standing precedent for record-table payloads.

## Two eras

| era | when | shape |
|---|---|---|
| modern XML | filings from mid-2024, after the Rule 30b1-4 amendments | `primary_doc.xml` plus a `proxyVoteTable` document, structured per the SEC's `eis_NPX_PROXY_VOTING_RECORD.xsd` |
| legacy free text | before that | no common grammar; one named layout per filer family, dispatched through the registry |

Both eras carry `<SERIES-ID>` / `<CLASS-CONTRACT-ID>` /
`<CLASS-CONTRACT-TICKER-SYMBOL>` triples in the SGML header. Those are the link
key to ISS `seriesid`, and an N-PX registrant files for dozens of series at once,
so the header parser collects **every** triple. A first-match regex silently
drops all but one.

## Build

```bash
cd parse_npx_go
go build -o parse_npx_go .

# Cross-compile for a WRDS compute node:
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o parse_npx_go .
```

Stdlib only. There is no third-party dependency and `go.mod` requires nothing.

## CLI flags

### Parse mode (the default)

| flag | default | meaning |
|---|---|---|
| `-files-from` | — (**required**) | newline-delimited filelist, one filing path per line |
| `-out` | — (**required**) | votes TSV; gzipped iff the path ends in `.gz` |
| `-manifest` | — (**required**) | manifest TSV; gzipped iff the path ends in `.gz` |
| `-archive-root` | `/wrds/sec/archives` | prepended to **relative** filelist paths only; an absolute path is used as given |
| `-concurrency` | `runtime.NumCPU()*4` | worker goroutines |
| `-version` | `false` | print version and exit |

A missing required flag prints to stderr and exits **2**.

```bash
parse_npx_go \
  -files-from shard.txt \
  -archive-root /wrds/sec/archives \
  -out votes.tsv.gz \
  -manifest manifest.tsv.gz \
  -concurrency 32
```

### Shard mode

| flag | default | meaning |
|---|---|---|
| `-shard` | `""` | sized filelist (`path<TAB>bytes`) to split; a non-empty value selects shard mode |
| `-shard-out` | — (**required with `-shard`**) | directory the shard filelists are written into |
| `-shard-target-mb` | `200` | target input bytes per shard, in megabytes |

Shard mode takes over before any output file is opened, so `-files-from`, `-out`
and `-manifest` are not required alongside it.

```bash
parse_npx_go -shard sizes.tsv -shard-out filelists/shards -shard-target-mb 200
# shards=118 files=41207 bytes_min=198.4MB max=214.7MB mean=203.1MB imbalance=5.7%
```

It writes, into `-shard-out`:

| file | contents |
|---|---|
| `chunk_NNN.txt` | one filing path per line — this is what `-files-from` consumes |
| `chunks.txt` | one shard id per line; its **line number is the SGE array index** |
| `chunks_meta.tsv` | `chunk_id`, `n_filings`, `bytes` |

**Balance is by bytes, not by count.** N-PX filing size spans three orders of
magnitude: one 2025 XML filing is 200 MB while a legacy no-activity notice is
4 KB. An equal-count split therefore leaves one grid task running for hours while
the rest idle. The planner sorts largest-first and places each file into the
emptiest shard that still fits, opening a new shard only when the file fits
nowhere. That yields three guarantees the grid depends on: every input file lands
in **exactly one** shard, **no shard is empty**, and a shard overshoots the target
only by the single file that carried it past — unavoidable when one filing is
larger than the whole target.

## Output schemas

No header row is written in either file. Every field is scrubbed of tabs and
newlines before serialization, so no value can shift a column or split a row.

### `votes.tsv.gz` — one row per `voteRecord` (XML) or per proposal line (text)

```
filepath, accession, cik, period_of_report, filed_date, form_type,
registrant_name, series_id, class_ids, fund_name,
issuer_name, cusip, isin, figi, ticker,
meeting_date, meeting_type, record_date, item_seq,
vote_description, vote_categories, other_vote_description, vote_source,
shares_voted_total, shares_on_loan,
how_voted, shares_voted, management_recommendation,
other_managers, vote_other_info, parse_mode, layout
```

Dates are `YYYYMMDD`. Repeated child values (`vote_categories`, `class_ids`,
`other_managers`) are joined with `;`. In the XML era one `proxyTable` record
fans out to one row per nested `voteRecord`, with the record-level fields
repeated on each; `shares_voted_total` is the record's `sharesVoted` while
`shares_voted` is that individual `voteRecord`'s.

`series_id` and `class_ids` are stamped by the chassis only when the filing
covers exactly one series. A multi-series filing leaves them to the layout
parser, which is the only layer that knows which series a given vote belongs to.

### `manifest.tsv.gz` — one row per filing, **including the ones that parsed to nothing**

```
filepath, accession, cik, period_of_report, filed_date, form_type,
company_name, n_rows, parse_mode, layout, parse_status, error_msg
```

The manifest is the completeness ledger: `n_rows` summed over it must equal the
votes file's line count, and its row count must equal the input filelist's line
count. The grid runner enforces the second identity per shard.

### Vocabularies

`parse_mode`:

| value | meaning |
|---|---|
| `xml` | the modern structured era |
| `text` | the legacy free-text era |
| `none` | the filing was never classified — it could not be opened or read |

`parse_status`:

| value | meaning |
|---|---|
| `ok` | parsed. **`n_rows=0` is a legitimate `ok`**: a fund reporting no proxy voting activity is a real and common outcome, and this is the N-PX analogue of `parse_13f`'s `13F-NT` notice handling |
| `error` | the layout parser returned an error or panicked; `error_msg` carries the message |
| `skip` | no registered layout matched. `layout` still carries a **non-empty signature derived from the body**, so unparsed families are countable in the manifest rather than invisible |

The `ok`/`n_rows=0` row is what keeps "nothing to report" distinguishable from
"the parser failed". Never filter the manifest to `n_rows > 0` when measuring
coverage.

## The layout registry

The legacy era has no common grammar, so detection returns a **named layout**
from an ordered registry rather than a two-way switch. Coverage grows by adding
an entry; nothing is ever silently dropped.

`text_parser.go`:

```go
type layoutEntry struct {
	Name  string
	Match func(head string) bool
	Parse func(text string, meta FilingMeta) ([]VoteRow, error)
}

// layoutRegistry is matched in order; the first hit wins.
var layoutRegistry = []layoutEntry{
	{Name: "issnpx", Match: matchISSNPX, Parse: parseISSNPX},
	{Name: "vanguard", Match: matchVanguard, Parse: parseVanguard},
}
```

`parseText` normalizes the body first — charset decode, then tag stripping that
preserves line structure, because both legacy layouts are line-oriented grammars
— and only then matches signatures against the head of the normalized text. A
layout parser therefore never sees raw markup.

Registered layouts:

| name | family | signature |
|---|---|---|
| `issnpx` | ISS-generated, consistent across hundreds of filers | a `FORM N-Px REPORT` banner |
| `vanguard` | Vanguard's `ISSUER:` / `PROPOSAL #n.m:` block grammar | a `FUND:` line followed by `ISSUER:` lines |

### Adding a layout

1. Find the family. Query the manifest of a completed run for `parse_status=skip`
   grouped by `layout` — the signature column exists so that this is a `GROUP BY`
   and not a hunt.
2. Write `layout_<name>.go` with a `match<Name>(head string) bool` and a
   `parse<Name>(text string, meta FilingMeta) ([]VoteRow, error)`. `Match` must
   be **cheap** and read only the head; it runs against every legacy filing.
3. Append the entry to `layoutRegistry`. Order matters — the first hit wins, so
   put a narrow signature ahead of a broad one.
4. Add a fixture test. Every existing layout is covered by one
   (`layout_issnpx_test.go`, `layout_vanguard_test.go`), with fixtures inline as
   raw strings per the `parse_13f` precedent.
5. Re-run `bash check.sh`.

A parser that errors or panics is contained into `parse_status=error` with the
message. One malformed filing must not take a worker, or the run, down.

## The grid chain

Everything runs on the WRDS compute nodes. `/wrds/sec/archives` is mounted there
directly, so there is no rclone staging stage and there should not be one —
copying first would only add a pass over the whole corpus.

```
  wrdssec_all.wrds_forms   (SQL: metadata only, never filing text)
            │  form IN ('N-PX','N-PX/A'), wrdsfname → archive-relative path (fname is edgar/data/... and does NOT exist under the archive root)
            ▼
      filelist.txt         one path per line
            │  stat each file for its size
            ▼
      sizes.tsv            path <TAB> bytes
            │  parse_npx_go -shard
            ▼
  filelists/shards/        chunk_NNN.txt + chunks.txt + chunks_meta.tsv
            │  qsub -t 1-N sge/submit_shards.sh
            ▼
      sge/scan_shard.sh    one shard per array task, GOMAXPROCS=$NSLOTS
            ▼
      out/NNN.votes.tsv.gz + out/NNN.manifest.tsv.gz
```

Concretely, on a WRDS node:

```bash
ROOT=/scratch/nyu/$USER/parse_npx
cd "$ROOT"

# 1. Size the filelist (paths are archive-relative).
while read -r p; do
  printf '%s\t%s\n' "$p" "$(stat -c %s "/wrds/sec/archives/$p")"
done < filelist.txt > sizes.tsv

# 2. Plan byte-balanced shards.
bin/parse_npx_go -shard sizes.tsv -shard-out filelists/shards -shard-target-mb 200

# 3. Smoke-test eight tasks BEFORE submitting the array.
qsub -t 1-8 sge/submit_shards.sh

# 4. Submit the rest.
qsub -t 1-$(grep -c '' filelists/shards/chunks.txt) sge/submit_shards.sh
```

### `sge/`

| file | role |
|---|---|
| `submit_shards.sh` | SGE array wrapper. `#$ -pe onenode 1`, `m_mem_free=2G`. Exports the `PARSE_NPX_ROOT` / `SHARD_LIST` / `SHARD_DIR` / `OUT_DIR` / `BIN` / `ARCHIVE_ROOT` contract and `exec`s the runner |
| `scan_shard.sh` | one array task = one shard. Sets `GOMAXPROCS=$NSLOTS`, invokes the binary on `chunk_${SHARD_ID}.txt`, and **fails the task when the manifest row count does not equal the input file count** |

Nothing in either script names a user or an institution; both honour
`WRDS_SCRATCH`-style overrides and default through `WRDS_INST` (default `nyu`).
The one exception is the `#$ -o` directive block: SGE parses `#$` lines before
the shell runs, so a variable there is a literal. Redirect logs with `qsub -o`.

**Why the runner checks the manifest count.** The manifest carries a row for
every input filing, including the zero-row and failed ones, so a short manifest
means filings went missing rather than that they had nothing to report. Without
the check a truncated shard is indistinguishable from a complete one, and a
silently short shard becomes a silently short panel that nothing downstream can
detect. The task exits 5 instead.

`GOMAXPROCS` and `-concurrency` are different knobs. `GOMAXPROCS` is pinned to
`$NSLOTS` so the Go runtime sizes its thread pool from the slot grant rather than
the host's core count, and does not take cores the scheduler promised other jobs.
`-concurrency` (default `NSLOTS*8`, floor 8) is the throughput lever, set above
the slot grant because `/wrds/sec/archives` is NFS and workers wait on open
latency, not CPU.

## Verification

```bash
bash check.sh
```

One exit code is the whole mechanical verdict: `gofmt -l`, `go vet`, `go build`,
a guard that no panicking `stub_*.go` placeholder survives, and `go test ./...`.

## Layout

```
parse_npx/
├── README.md
├── check.sh                  the single mechanical entry point
├── parse_npx_go/
│   ├── go.mod                module parse_npx_go, stdlib only
│   ├── types.go              VoteRow, FilingMeta, ParseResult, the column orders
│   ├── main.go               CLI, worker pool, gzip TSV writers, sanitize
│   ├── header.go             SGML header: dates, form type, CIK, every series/class triple
│   ├── charset.go            declared-encoding detection and cp1252/latin-1 transcoding
│   ├── html.go               tag stripping and entity decoding that preserves line structure
│   ├── xml_parser.go         streaming xml.Decoder over proxyVoteTable
│   ├── text_parser.go        layout registry, detection, dispatch, sentinels
│   ├── layout_issnpx.go      the FORM N-Px REPORT grammar
│   ├── layout_vanguard.go    the ISSUER:/PROPOSAL #n.m: block grammar
│   ├── shard.go              byte-balanced shard planner and -shard mode
│   └── *_test.go             fixture tests, inline raw-string fixtures
└── sge/
    ├── submit_shards.sh
    └── scan_shard.sh
```

## Out of scope here

Linking and reconciliation are a separate run on this chassis, because both need
WRDS credentials and a 30-plus minute grid job. They earn `seriesid → fundid`
from the header triples against the ISS fund dimension, earn `itemonagendaid` by
matching `(cusip, meetingdate, item)` against `risk.vavoteresults`, and then
report per-year agreement against `risk.voteanalysis_npx`. One note for that run:
`risk.vavoteresults` is **not unique** on `itemonagendaid` (230 versioning pairs
over 848,506 items), so join by semi-join or hash, never an inner join.
