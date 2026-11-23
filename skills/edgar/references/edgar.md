# SEC EDGAR filings on WRDS

Filing metadata, keys and bulk text on WRDS. For sec.gov itself (rules releases, data.sec.gov APIs, EDGAR full-text search, filings newer than WRDS) see `sec-gov.md`; for the route in general see `../SKILL.md`.

## Contents

- [Grain & Keys (verified 2026-06-09)](#grain--keys-verified-2026-06-09) - **there is no `edgar` schema on WRDS; use `wrdssec_all`**
- [Common Form Types](#common-form-types) - 10-K, 10-Q, 8-K items, DEF 14A, Form 4
- [Query Patterns](#query-patterns) - filings for a set of CIKs, counts by form, CIK to GVKEY
- [CRITICAL: DCN vs Accession Number](#critical-dcn-vs-accession-number) - `tr_insiders` gotcha
- [Download Filing Text via WRDS rclone](#download-filing-text-via-wrds-rclone) - layout, `--files-from`, the tar route, anti-patterns
- [Start with the pre-parsed header table](#start-with-the-pre-parsed-header-table-wrdssec_allwrds_forms_reg) - `wrdssec_all.wrds_forms_reg`
- [Self-built SEC index via SGE](#self-built-sec-index-via-sge-fallback-for-wrds-lag--unparsed-header-fields) - unparsed header fields, Go header scanner
- [Go-Based Filing Parsers](#go-based-filing-parsers) - SGE submission pattern, `scan_covers` profiles, the two sanctioned exceptions, the parquet contract

## Grain & Keys (verified 2026-06-09)

**The `edgar` schema does not exist on wrds-pgdata** (no `edgar` row in `pg_namespace`, not a permissions issue), so `edgar.filings`, `edgar.company_info` and `edgar.filing_docs` fail. The SEC filing-index tables are `wrdssec_all.forms` and `wrdssec_all.wrds_forms` (WRDS SEC Analytics Suite; manuals: https://wrds-www.wharton.upenn.edu/pages/support/manuals-and-overviews/wrds-sec-analytics-suite/). Column details: `wrds-forms-tables.md`.

- **Row PK `wrdssec_all.wrds_forms`** (~26.9M rows): `fname` — VERIFIED SAMPLED 2023 fdate slice: 0 dupes
  over 1,159,918 rows. `(accession, cik)` — also 0 dupes (SAMPLED 2023). `accession` ALONE IS NOT UNIQUE:
  347,721 dupes in the 2023 slice — one row per header CIK (filer, subject company, issuer, reporting owner; `regcount` = header blocks).
  Count filings with `COUNT(DISTINCT accession)`; count CIK-filings with `(accession, cik)`.
- **Row PK `wrdssec_all.forms`** (~26.9M rows): `fname` — VERIFIED SAMPLED 2023 fdate slice: 0 dupes over
  1,160,114 rows. **`forms` has NO `accession` column** (cols: gvkey, cik, fdate, findexdate, lindexdate,
  form, coname, fname, iname, source) — derive the accession from `fname` if needed.
- **`fname` is the EDGAR path; `wrdsfname` is the on-disk path. Bulk pulls need `wrdsfname`.**
  `fname` = `edgar/data/745467/0001145549-18-005124.txt`, `wrdsfname` =
  `000074/745467/0001145549-18-005124.txt` (CIK zero-padded to 6, sharded). Under
  `/wrds/sec/archives` only the second resolves; the first fails per-file with
  `tar: ...: Cannot stat: No such file or directory` and still exits 0 with a valid empty
  archive, so the pull looks like it worked. Feed `wrdsfname` to `tar -T -`.
- **Fund-level HOLDINGS are `N-PORT` / `N-Q`, and only one of them is joinable.** `NPORT-P`
  (2019-10-22 on, 344,217 filings, 2,455 CIKs) is structured XML carrying `<seriesId>` — the
  same series identifier the N-PX vote panel holds — with each position giving `cusip`, `lei`,
  `title`, `balance` (SHARES), `valUSD`, `pctVal`. `NPORT-EX` covers 2019-04..2019-10.
  **`N-Q` (2003-10-27 .. 2021-04-29, 95,003 filings, 4,206 CIKs) carries series IDs in its SGML
  HEADER, not its body.** The `<SEC-HEADER>` block holds
  `<SERIES-AND-CLASSES-CONTRACTS-DATA>` → `<SERIES>` → `<SERIES-ID>S000007420` +
  `<SERIES-NAME>` + per-class `<CLASS-CONTRACT-ID>`/`<CLASS-CONTRACT-TICKER-SYMBOL>`. Measured
  over N-Q filings from N-PX-filing registrants: **27 of 40 sampled carry the block, 8 of 20
  sampled pre-2010** — absent for single-portfolio registrants, which have no series, and
  thinner before series/class tagging phased in around 2006. The header gives the trust's
  series ROSTER, not a per-holding attribution: the portfolio schedules are HTML tables in the
  body and must still be parsed and mapped to a series, but that is a within-filing match of a
  schedule heading against a short `<SERIES-NAME>` list, NOT a global fuzzy join. Do not
  conclude "no series identifier" from one filing — a size-picked sample lands on a tiny
  single-series filer. Since `N-PX`,
  `N-Q` and `N-PORT` are all '40 Act filings from one registrant, the registrant CIK is the
  join key and **no name matching is needed**: 1,374 of 1,377 panel registrant CIKs (99.8%)
  file one of them. A 13F position is the MANAGER's book and an `N-PORT` position is the
  FUND's — different quantities, never blend them.
- **`N-CEN` is the fund-registrant → investment-adviser bridge, and it exists only as filings.**
  No WRDS SQL table carries it (`information_schema` has no `%ncen%`); it is in `wrds_forms` as
  `form LIKE 'N-CEN%'` — 26,358 `N-CEN` + 2,278 `N-CEN/A` over 3,443 CIKs, 2018-09 onward, ~3.2 GB,
  median 20 KB. Pull the `.txt` and parse Item C.7: `<investmentAdviserName>`, `...FileNo` (801-),
  `...CrdNo`, and `<subAdviserName>` separately. **Advisers are declared per SERIES, inside
  `<managementInvestmentQuestion>` keyed by `<mgmtInvSeriesId>`** — take the union across a filing
  and a 34-series trust hands you 34 advisers. This is what links a fund complex to its 13F manager
  when the fund's brand name matches nothing on EDGAR.
- **Business/event key:** one EDGAR submission = `accession` (equivalently the accession embedded in
  `fname`). Amendments (`10-K/A`, `SC 13D/A`, ...) are separate submissions with their own accessions —
  supersede by `(cik, form-family, period)` taking the latest `fdate`, as in `../../wrds/references/blockholders.md`.
- **Linking identifiers:** `cik`; `gvkey` (pre-joined on `wrdssec_all.forms`, or via
  `wrdssec.wciklink_gvkey` — filter `flag` 2-3, see
  [WRDS CIK Linking Tables](https://wrds-www.wharton.upenn.edu/documents/750/WRDS_CIK_Linking_Tables.pdf));
  `cusip` via `wrdssec.wciklink_cusip` (filter `validated` 2-3); names via `wrdssec.wciklink_names`.

## Common Form Types

| Form Type | Description | Frequency |
|-----------|-------------|-----------|
| `10-K` | Annual report | Yearly |
| `10-K/A` | Amended annual report | As needed |
| `10-Q` | Quarterly report | Quarterly |
| `8-K` | Current report (material events) | As needed |
| `DEF 14A` | Proxy statement | Yearly |
| `4` | Insider trading report | As needed |
| `S-1` | IPO registration | One-time |
| `13F-HR` | Institutional holdings | Quarterly |
| `SC 13D` | Beneficial ownership >5% | As needed |
| `SC 13G` | Passive beneficial ownership | As needed |

8-K item numbers give the topic (the `items` field in EDGAR full-text search, `sec-gov.md`):

8-K filings include item numbers indicating the topic:

| Item | Description |
|------|-------------|
| 1.01 | Entry into material agreement |
| 1.02 | Termination of material agreement |
| 2.01 | Acquisition or disposition of assets |
| 2.02 | Results of operations (earnings) |
| 2.03 | Creation of direct financial obligation |
| 4.01 | Changes in registrant's certifying accountant |
| 4.02 | Non-reliance on previously issued financials |
| 5.02 | Departure/election of directors or officers |
| 5.03 | Amendments to articles/bylaws |
| 7.01 | Regulation FD disclosure |
| 8.01 | Other events |

## Query Patterns

Columns below are the ones verified in Grain & Keys: `cik` is a 10-digit string, `fdate` the filing date, `form` the form type.

```python
# Filings for a set of CIKs: one query, never one per CIK
cursor.execute("""
    SELECT cik, accession, form, fdate, fname, wrdsfname
    FROM wrdssec_all.wrds_forms
    WHERE cik = ANY(%s)
      AND form = ANY(%s)
      AND fdate BETWEEN %s AND %s
    ORDER BY cik, fdate
""", ([str(c).zfill(10) for c in ciks], ['10-K', '10-K/A'], '2019-01-01', '2024-12-31'))
```

```sql
-- Filing counts by form for one CIK (count submissions, not filer rows)
SELECT form, COUNT(DISTINCT accession) AS n, MIN(fdate) AS earliest, MAX(fdate) AS latest
FROM wrdssec_all.wrds_forms
WHERE cik = %s
GROUP BY form
ORDER BY n DESC;
```

- `wrds_forms` has a row for every header CIK, so `cik = X` also finds filings naming X as subject company, issuer or reporting owner; the role is in `wrds_forms_reg` (`wrds-forms-tables.md`, measured 2026-11-22).
- Filter on `fdate` ranges, never `year(fdate)`; cache the metadata locally for repeated analysis.
- CIK to GVKEY: `comp.company.cik` (10-digit) or `wrdssec.wciklink_gvkey` (Linking identifiers, above). Names: `wrdssec.wciklink_names`; fuzzy name matching is the `fuzzy-name-matching` skill.

### Ticker-to-CIK Mapping

```python
cursor.execute("""
    SELECT cik, coname, ticker, n_records, ftdate, ltdate
    FROM wrdssec.wciklink_ticker
    WHERE ticker = ANY(%s)
    ORDER BY ticker, ftdate
""", (ticker_list,))
```

`wciklink_ticker` holds one row per `(cik, ticker)` with the first and last date the pair was seen (`ftdate`, `ltdate`, 2002-02-02 to the present) and `n_records`. 3,270 of its 31,420 tickers map to more than one CIK (2026-11-22): `GM` is `0000040730` through 2009-06-05 and `0001467858` from 2010-11-24; `F` also returns stray one-off rows (`n_records` 1 and 6) beside Ford's 2,738. Keep the row whose `[ftdate, ltdate]` covers your event date and prefer the largest `n_records`. AAPL, MSFT and EXCO each return one row (`0000320193`, `0000789019`, `0001690820`).

## CRITICAL: DCN vs Accession Number

**WRDS `tr_insiders` uses DCN (Document Control Number), NOT SEC accession numbers.**

The DCN in `tr_insiders.header` is an internal Thomson Reuters identifier that
is not an SEC accession number and resolves no filing path. To get the accession,
look the Form 4 up in `wrdssec_all.wrds_forms`, which carries every CIK on the header
(reporting owner and issuer), by CIK and filing date:

```sql
SELECT DISTINCT accession, cik, form, fdate, wrdsfname
FROM wrdssec_all.wrds_forms
WHERE cik = %s AND form IN ('4', '4/A') AND fdate = %s;
```

A TR `fdate` can differ from the SEC `fdate` by 1-3 days for after-hours filings (`../../wrds/references/insider-form4.md`), so widen the date window before concluding a filing is missing.

## Download Filing Text via WRDS rclone

<EXTREMELY-IMPORTANT>
**IRON LAW: For bulk filing text, use rclone from the WRDS filesystem. NEVER pull text blobs through SQL. NEVER make per-filing SEC.gov HTTP requests.**

1. **Query metadata** from WRDS SQL (accessions, `wrdsfname`, dates): fast, small result
2. **Copy the files** in one `rclone copy --files-from` (or the tar route over 10K files)
3. **Process locally**: regex, NLP, whatever, with no database round-trips

**Bulk in rounds, never one request per document:** targets discovered while parsing form the next file list and the next single copy (`../SKILL.md`). sec.gov is only for what WRDS lacks: `sec-gov.md`.
</EXTREMELY-IMPORTANT>

### WRDS Filing Filesystem Layout

WRDS provides two copies of every filing:

| Directory | Content | Use case |
|-----------|---------|----------|
| `/wrds/sec/archives/` | Raw submission: full SGML, HTML, every exhibit | Discovery (hrefs to referenced filings), GRAPHIC/XBRL/XML/EXCEL/ZIP bodies, original formatting |
| `/wrds/sec/wrds_clean_filings/` | Cleaned plain text: markup stripped, those binary bodies emptied | Text extraction, NLP, regex |

Clean text is much smaller (it compresses ~5-10x vs raw HTML's ~0.8x) and faster to transfer, so use it for text; discovery needs raw, because clean drops the hrefs. Both keep the `<DOCUMENT>`, `<TYPE>` and `<FILENAME>` tags and share one path layout: `{cik_zfill10[:6]}/{cik_int}/{accession}.txt`.

`fname` in `wrdssec_all.wrds_forms` is the EDGAR path (`edgar/data/{cik_int}/{accession}.txt`); `wrdsfname` is the on-disk path under both roots. Do not convert one into the other by hand: `../scripts/edgar_filing.py` does it (`path` for one filing offline, `resolve` for a list via `wrdsfname`, `fetch` for one round's copy), and `resolve` finds a filing filed under another CIK than the one citing it.

```bash
E=skills/edgar/scripts/edgar_filing.py
python3 "$E" resolve pairs.tsv > files_from.txt      # "cik accession" lines in, wrdsfname lines out
python3 "$E" fetch pairs.tsv out/ --clean            # resolve + ONE rclone copy; local paths out, one per line
```

### Up to 10K files: one `rclone copy --files-from`

```bash
rclone copy wrds:/wrds/sec/wrds_clean_filings/ "$OUTPUT_DIR" \
    --files-from "$FILES_FROM" --transfers 8 --no-traverse --ignore-checksum --stats 30s --stats-one-line
```

`--ignore-checksum` is required: the `wrds` remote sets `md5sum_command`, so without it rclone opens one ssh session per file to md5sum it and exhausts the login node; size is still checked. rclone exits 0 on a listed file that does not exist, so presence on disk, not the exit code, decides what is missing. `fetch` does all of this.

### Over 10K files: tar server-side, download one archive

This is the fastest approach: (1) one large sequential transfer beats thousands of SFTP round-trips, (2) `rclone copy` handles resume if the connection drops. Use `scp` for the small file list upload (rclone SFTP can be flaky after heavy use), `rclone` for the large archive download.

```bash
#!/usr/bin/env bash
# download_filings_tar.sh — tar on WRDS server, download single archive
set -euo pipefail

FILES_FROM="${1:?Usage: $0 <files-from.txt> <output-dir>}"
OUTPUT_DIR="${2:?Usage: $0 <files-from.txt> <output-dir>}"

# Use /scratch/<institution>/<user>/ for large files — NOT /tmp (only 44 GB)
WRDS_USER="$(ssh wrds whoami)"
WRDS_SCRATCH="${WRDS_SCRATCH:-/scratch/${WRDS_INST:-nyu}/${WRDS_USER}}"
REMOTE_TMP="${WRDS_SCRATCH}/filings_$(date +%s).tar.gz"
REMOTE_LIST="/tmp/$(basename "$FILES_FROM")"  # file list is small, /tmp is fine

mkdir -p "$OUTPUT_DIR"

# 1. Upload file list via scp (small file, reliable)
scp "$FILES_FROM" "wrds:$REMOTE_LIST"

# 2. Create tar.gz server-side on /scratch (use nohup — can take 30+ min)
echo "Creating archive on WRDS server..."
ssh wrds "mkdir -p $WRDS_SCRATCH"
ssh wrds "nohup bash -c 'cd /wrds/sec/wrds_clean_filings && tar czf $REMOTE_TMP -T $REMOTE_LIST' > ${WRDS_SCRATCH}/tar.log 2>&1 &
echo PID: \$!"

# Wait for tar to finish (poll every 60s)
echo "Waiting for tar to complete..."
while ssh wrds "pgrep -f 'tar czf.*filings_' > /dev/null 2>&1"; do
    size=$(ssh wrds "ls -lh $REMOTE_TMP 2>/dev/null | awk '{print \$5}'" 2>/dev/null)
    echo "  Archive size: ${size:-starting...}"
    sleep 60
done
ssh wrds "ls -lh $REMOTE_TMP"

# 3. Download single archive via rclone (handles resume on large files)
echo "Downloading archive..."
rclone copy "wrds:$REMOTE_TMP" "$OUTPUT_DIR" --ignore-checksum --stats 30s --stats-one-line

# 4. Extract locally
echo "Extracting..."
tar xzf "$OUTPUT_DIR/$(basename "$REMOTE_TMP")" -C "$OUTPUT_DIR"
rm "$OUTPUT_DIR/$(basename "$REMOTE_TMP")"

# 5. Cleanup remote
ssh wrds "rm -f $REMOTE_TMP $REMOTE_LIST"

echo "Done. $(find "$OUTPUT_DIR" -name '*.txt' | wc -l) files extracted."
```

Usage:
```bash
# edgar_filing.py resolve writes the wrdsfname list, then:
bash download_filings_tar.sh data/raw/edgar_filings/files_to_download.txt data/raw/edgar_filings/raw/
```

**IMPORTANT: WRDS `/tmp` is only ~44 GB — do NOT tar there.** Use `/scratch/<institution>/<username>/` instead (13 TB free, NFS-mounted).

Key paths on WRDS:
- `/tmp/` — 44 GB, shared, fills up fast. Only for small temp files (<1 GB).
- `/scratch/<institution>/<username>/` — 13 TB, institution-scoped. Use for large archives.
- `/home/<username>/` — quota-limited. Don't use for bulk data.

Size estimates for 110K filings:
- **`wrds_clean_filings`** (plain text): ~5-10 GB tar.gz. Clean text compresses well (~5-10x).
- **`archives`** (raw HTML): ~40-70 GB tar.gz. HTML compresses poorly (~0.8x).

The list fed to `tar -T` must be `wrdsfname` paths: an `fname` path fails per file with `tar: ...: Cannot stat` and still exits 0 with a valid empty archive. **This recipe runs `tar` under `nohup` on the login node**, which the wrds login-node Iron Law forbids for bulk reads (`../../wrds/SKILL.md`); over a large list, put the same `tar czf` in a submit script and `qsub` it.

### Process locally

`fetch` prints one local path per input pair (nothing for a missing filing); read those, and pull single documents out with `edgar_filing.py extract` rather than a fresh regex (older submissions double a leading "." on each body line).

### Anti-patterns

| Approach | Problem |
|----------|---------|
| `rclone cat` per file in Python | Spawns N subprocesses — for 60K files, orders of magnitude slower |
| `rclone copy` per CIK directory in a Python loop | Sequential; 3K dirs = 3K rclone invocations |
| `subprocess.run(["rclone", ...])` from Python | Mixing download logic into Python; not rerunnable independently |
| `--transfers 32` over SFTP | Overwhelms SSH multiplexing, causes `mux_client_request_session` errors |
| `--progress` flag in scripts | Generates too much terminal output — use `--stats 30s --stats-one-line` instead |
| Pulling text via SQL (`SELECT filing_text`) | 9GB+ in memory for 60K filings. OOM risk. |
| Per-filing SEC.gov HTTP requests | Rate-limited to 10 req/sec (60K files = 100+ min) and risks an IP block; what sec.gov is for: `sec-gov.md` |
| `rclone copy` without `--ignore-checksum` | One ssh session per file for md5sum; exhausts the login node |

#### Why Not SQL Text Blobs or SEC.gov URLs?

| Approach | Problem |
|----------|---------|
| `SELECT filing_text FROM wrds_sec_search.filing_*` | Text columns are huge — 9GB+ for 60K filings. OOM risk. |
| Per-filing `SELECT` in a loop | N round-trips to WRDS PostgreSQL. 60K queries = hours. |
| SEC.gov HTTP requests | Rate-limited to 10 req/sec. 60K files = 100+ minutes. |
| **rclone from WRDS filesystem** | Parallel file reads, disk cache, no rate limit, no OOM. |

## Start with the pre-parsed header table: `wrdssec_all.wrds_forms_reg`

WRDS already parses every filing's SGML header, all forms, into `wrdssec_all.wrds_forms_reg` (also a view in `wrdssec`; about 27.9M rows; current to within about one business day). Query it before writing or running any header scanner. One row per accession × header registrant block, with `regrole` (FILER, SUBJECT COMPANY, FILED BY, …), `regcik`, `regconame`, `regsic`, `regfye`, `regstate_inc` (state of incorporation), `regstreet_hdq`/`regcity_hdq`/`regstate_hdq`/`regzip_hdq` (business address), `regfconame`/`regfchangedate` (former name and change date), `regirs`, `fdate`.

- No `form` column: join `wrdssec_all.wrds_forms` on `accession` and `cik = regcik`.
- Alias duplicates within `(accession, regcik, regrole)`: dedupe on `regseq`.
- Normalize states with `upper(btrim(...))`.
- It reads the same header field the `scan_covers` `state_incorp*` profiles read, so the values agree. It shares their limits: the header state lags a legal reincorporation (307–481 days in the cases checked) and is blank where the filer omitted it — re-parsing fixes neither; date moves from the filing text.

Reach for `scan_headers` / `scan_covers` only for what this table does not carry: fields WRDS does not parse (series/class blocks, period of report, cover-page or body text), or filings newer than its vintage.

## Self-built SEC index via SGE (fallback for WRDS lag / unparsed header fields)

**When to use:**

1. WRDS `wrds_forms` is stale or missing recent filings and you want to (re)build the index yourself.
2. You need a header field neither `wrds_forms` nor `wrds_forms_reg` exposes. Secondary CIKs and their roles are already there (`wrds-forms-tables.md`).

**What it does:** SGE array, one task per top-level 6-char shard under `/wrds/sec/archives/`
(there are ~164 shards). Each task reads only the first 4 KB (or up to `</SEC-HEADER>`) of every
`*.txt` filing and emits one TSV row per role block:

```
filepath  form_type  filed_date  accession  role  cik
```

Role values: `FILER`, `REPORTING-OWNER`, `ISSUER`, `SUBJECT COMPANY`, `FILED BY`, `FILED FOR`,
`SECURITIZER`, `DEPOSITOR`, `SERIAL COMPANY`. (Old 2000-era Form 4s may leak the role `COMPANY DATA`
— filter post-hoc.)

### Use the Go scanner (the default)

> **`rga` is not used here and never was**, despite the directory once being named
> `sec_index_rga`. ripgrep-all exists to search *inside* PDF/DOCX/zip/SQLite by shelling
> out to extractors; EDGAR filings are plain text, so it would add per-file adapter cost
> for nothing. Directory renamed to `sec_index`.
>
> **`rg` alone is not sufficient either, and that is structural, not a tuning problem.**
> The parser must stop at `</SEC-HEADER>` or 4 KB and never touch the filing body. `awk`
> gets that from `nextfile`; **`rg` has no per-file byte limit**, so it scans to EOF and
> multi-role filings leak header-shaped lines out of the body. The +12.9% row count in
> the table below is 46,759 junk rows, not extra coverage. `rg` being only 8% faster than
> `awk` (539 s vs 583 s) is itself the tell: swapping in a much faster regex engine bought
> almost nothing, because matching was never the bottleneck. That variant is kept as the
> evidence for choosing Go; the correct-but-slow fallback is `scan_shard.sh`.
>
> **`submit_array.sh` now defaults to `scan_shard_go.sh`.** It previously exec'd the awk
> baseline while this section said "recommended" — so the documented recommendation and
> the thing that actually ran disagreed by 26×, and every full 164-shard run took the slow
> path unless someone set `SCAN_BIN` by hand.

**26× faster than awk-per-file** (~22 s/shard vs ~583 s), exact parity, identical output
contract. NFS open latency — not CPU — is the bottleneck; a goroutine pool of 16 workers
hides the latency that serial `awk FILENAME` cannot.

Scripts live at `skills/wrds/scripts/sec_index/`:

| File | Role |
|------|------|
| `scan_shard_go/main.go` + `go.mod` | Cross-compiled Go helper; walks shard, reads first 4 KB of each `.txt` with N workers, emits TSV rows to stdout |
| `scan_shard_go.sh` | SGE wrapper: gzips stdout of Go binary, same env contract (`SGE_TASK_ID`, `SHARD_LIST`, `OUT_DIR`) as the awk baseline |
| `submit_array.sh` | `#$ -t 1-N -l m_mem_free=2G` wrapper; `exec`s the scanner |
| `build_index.py` | Local driver: refresh shard list, qsub, poll qstat, rclone TSVs back, concat to parquet |
| `scan_shard.sh` | Legacy awk-per-file baseline (kept as fallback) |
| `scan_shard_rg_awk.sh` | Variant A (`rg \| awk`) — the parity FAILURE in the table below. Kept because it is the evidence for choosing Go, not a usable scanner |
| `benchmark.sh` | Runs all three variants on one shard and diffs `(path, role, cik)` fingerprints. This is what produced the numbers below; re-run it before changing any concurrency default |

**Paths:** nothing in these scripts names a user or an institution. All honour
`WRDS_SCRATCH` (default `/scratch/${WRDS_INST:-nyu}/$(whoami)`), plus the narrower
`SHARD_LIST` / `OUT_DIR` / `GO_BIN` / `SCAN_BIN` / `ARCHIVE_ROOT` overrides. The one
exception is `#$ -o logs/` in `submit_array.sh`: SGE parses `#$` directives before the
shell runs, so a variable there is a literal — override with `qsub -o <dir>` instead.

**Build & deploy:**

```bash
# Local cross-compile (macOS/Linux dev → Linux amd64 WRDS node)
cd skills/wrds/scripts/sec_index/scan_shard_go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o scan_shard_go

# Upload once (3.0 MB, statically linked)
scp scan_shard_go wrds:/scratch/nyu/$USER/bin/
```

**Run full index:**

```bash
# On WRDS:
cd /scratch/nyu/$USER/sec_index
ls -d /wrds/sec/archives/*/ | sed 's|/wrds/sec/archives/||;s|/$||' | sort > shards.txt
qsub -t 1-$(wc -l < shards.txt) submit_array.sh     # 164 tasks, ~5 min wall

# Locally:
python skills/wrds/scripts/sec_index/build_index.py --all
```

### Benchmarks (shard `000000`, 219,196 files, WRDS login node)

| Variant | Wall | Rows | Parity |
|---------|-----:|-----:|--------|
| awk-per-file baseline (cold) | 675 s | 362,370 | reference |
| awk-per-file baseline (warm) | 583 s | 362,370 | reference |
| `rg \| awk` (warm) | 539 s | 409,129 (+12.9%) | **FAIL** — rg scans to EOF; multi-role filings leak header-like blocks past 4 KB |
| **Go helper (warm)** | **22 s** | **362,370** | **PASS — 0 differing rows** |

Row/file ratio: 1.65× — confirms secondary CIKs captured (single-CIK Form 4 would give 2×).
Output: 3.0 MB gzipped per shard. Full 164-shard run: ~500 MB / ~60M rows.

**Why the Go helper wins:** 28 s CPU is comparable to awk's 68 s CPU. The wall-time win is
entirely from concurrent NFS opens — `io.ReadFull` across 16 goroutines overlaps the
per-file open latency that serial awk pays sequentially. Variant A (rg | awk) is faster
at opens but loses parity because `rg` has no per-file byte limit equivalent to awk's
`nextfile` after 4 KB.

**Concurrency:** the wrapper defaults to `$NSLOTS × 8` with a floor of 16. Bump via
`GO_CONCURRENCY=32` if you request more slots. NFS open is I/O-bound so over-subscribing
past CPU count helps.

`GOMAXPROCS` and `GO_CONCURRENCY` are different knobs and only the second is the throughput
lever. `GOMAXPROCS` is pinned to `$NSLOTS` purely so Go does not size its thread pool from
the *host's* core count and take cores the scheduler promised other jobs. `scan_shard_go.sh`
carried a comment asserting the reverse — that the work is CPU-bound and "goroutine count
barely matters" — which contradicted the measurements three paragraphs above it in this very
file. Corrected; if you change either default, re-run `benchmark.sh` and update the table
rather than the prose.

### Correctness traps (hard-earned)

- The header has **multiple** `CENTRAL INDEX KEY:` lines, one per role block. Never use
  `-m 1` or naive first-match — you'll silently drop secondary CIKs.
- `rg -U --multiline` can over-match across file boundaries if input isn't `-H`-prefixed.
  The awk-per-file and Go-per-file approaches sidestep this entirely.
- Scan only until `</SEC-HEADER>` or 4 KB. Never touch the filing body.
- **4 KB buffer fill without `</SEC-HEADER>`:** drop the last (possibly truncated) line
  before parsing, or you'll emit partial CIKs. Go helper does this (`main.go` lines 60-67);
  first run without it leaked 29 bad rows / 362k.
- **Skew**: `/wrds/sec/archives/000130/` and similar large prefixes are slow tasks.
  Do not rebalance — SGE task parallelism absorbs it.
- Very old (2000-era) Form 4 filings use `<REPORTING-OWNER>` XML tags with `COMPANY DATA:`
  at column 0 inside. The parser emits a `COMPANY DATA` role for these (~0.5% of rows).
  Filter to a whitelist post-parse.

## Rate limits for sec.gov

User-Agent, the 10 requests/second limit and what sec.gov is for: `sec-gov.md`.

## Go-Based Filing Parsers

For large-scale extraction from SEC filings (100K+ documents), Go parsers running
on WRDS compute nodes via SGE are dramatically faster than Python. Pattern:

1. **Build filing index** (Python or SAS, on the grid): query `wrdssec_all.wrds_forms`
   for filing paths, and write them one per line into a filelist
2. **Go parser** (compiled binary): takes the filelist with `-files-from` — every
   binary here is filelist-driven and none of them reads stdin — opens each filing on
   WRDS NFS, extracts its fields, and writes gzipped TSV with **no header row**
3. **SGE array job**: shards the filelist by *bytes* across N workers for parallelism
4. **Convert to parquet** (Python, local): `skills/wrds/scripts/edgar_parquet/` types the columns,
   partitions Hive-style by year and writes ZSTD parquet. See
   [The record-table output contract](#the-record-table-output-contract) below.
5. **Build panel** (Python, local): read the parquet dataset with polars and aggregate


### Path Convention for `wrds_clean_filings`

```
/wrds/sec/wrds_clean_filings/{cik_zfill10[:6]}/{cik_int}/{accession}.txt
```

Example: CIK 34088, accession 0001193125-25-073986 ->
`/wrds/sec/wrds_clean_filings/000034/34088/0001193125-25-073986.txt`. Build it with
`../scripts/edgar_filing.py path <cik> <accession> --clean` (or `rclone_path()` in Python), not by hand.

### SGE Submission Pattern

```bash
# Upload binary and filing list
scp parse_my_thing_linux wrds:/scratch/nyu/$USER/bin/parse_my_thing
scp filings.tsv wrds:~/my_project/filings.tsv

# Submit array job (20 shards)
qsub -t 1-20 \
  -v FILES_FROM=$HOME/my_project/filings.tsv,OUT_DIR=$HOME/my_project/out,NSHARDS=20,ARCHIVE=/wrds/sec/wrds_clean_filings \
  submit.sh
```

### Existing Parsers

Sources are under `skills/wrds/scripts/`.

| Parser | Source | Extracts | Input | Accuracy |
|--------|--------|----------|-------|----------|
| `quorum` (profile) | `scan_covers/profiles_quorum.go` + `scan_covers/profiles/quorum/` | Bylaw quorum threshold from DEF 14A | DEF 14A, DEFM14A | 96.6% explicit parse |
| `state_incorp` (profile) | `scan_covers/profiles_state_incorp.go` | State of incorp + HQ state from 10-K SGML header — for header state and HQ, start with the pre-parsed `wrdssec_all.wrds_forms_reg` (all forms) instead | 10-K filings | 98.4% vs Barzuza et al. |
| `blockholders_13dg` (profile) | `scan_covers/profiles_blockholders_13dg.go` | Item 12 + max ownership % | SC 13D/G | — |
| `proxy_advisors` (profile) | `scan_covers/profiles_proxy_advisors.go` | ISS/GL/EJ mentions | 485BPOS/APOS | — |
| `tender_sc_to` (profile) | `scan_covers/profiles_tender_sc_to.go` | Tender offer cover fields | SC TO-* | — |
| `parse_13f` (**standalone, sanctioned**) | `parse_13f/parse_13f_go/` | One row per holding from the 13F `infoTable`, plus a manifest row per filing | 13F-HR, 13F-HR/A | 89,072,489 rows over 248,500 filings |
| `parse_npx` (**standalone, sanctioned**) | `parse_npx/parse_npx_go/` | One row per `voteRecord` (XML era) or proposal line (legacy text era), plus a manifest row per filing | N-PX, N-PX/A | — |

**Every cover-page extraction is a profile; exactly two record-table parsers are
not.** The quorum parser runs as `-profile quorum`, verified identical to its former
standalone binary on fixtures covering every confidence tier; see
`skills/wrds/scripts/scan_covers/profiles/quorum/README.md`.

A standalone binary is the red flag in `../SKILL.md`: `scan_covers` handles SGE
sharding, NFS concurrency, path construction, form-type filtering and error handling
generically, so a new extraction is a `profiles_*.go` file plus a `profiles/<name>/`
directory for staging and panel building. The `Profile` struct takes pattern-based
fields and custom extractors (the `Custom` field type); set `FullBody: true` for a
body-text search, as `profiles_proxy_advisors.go` does over 485BPOS/485APOS
prospectuses. "This parser is different enough to need its own binary" has not yet
been true once: a 300-line standalone Go binary, run on the login node with the path
convention wrong, took 5 iterations to fix where a 60-line profile would have worked
first time.

**The exception, and why it is mechanical rather than a matter of taste.**
`scan_covers` `FullBody` mode reads the entire file into one buffer per worker, and
its `Field` model is a regex reduced to **one value per column** for the filing. A
*record table* is neither of those things: the 13F `infoTable` fans a single filing
out into thousands of holding rows, and one 23.8 MB N-PX filing's `proxyTable` carries
28,067 nested `voteRecord`s (`skills/wrds/scripts/parse_npx/README.md`). Buffering that file and
collapsing it to one value per column loses the table. `parse_13f` and `parse_npx`
therefore stream instead — `parse_13f` with a hand-rolled information-table scanner,
`parse_npx` with `xml.Decoder` at constant memory — and they are the only two
sanctioned exceptions. Anything cover-page or SGML-header shaped is still a profile,
with no exception.

### The record-table output contract

Both record-table binaries emit headerless gzipped TSV, which is a transport format,
not a storage format. The converter that turns it into parquet lives at
[`skills/wrds/scripts/edgar_parquet/`](../../wrds/scripts/edgar_parquet/) and serves both parsers from
one typing table (`parsers.py`).

**Layout, as verified on rjds:**

```
~/projects/mirror/data/processed/
  holdings_13f/year=YYYY/QN.parquet     Hive-partitioned, 38 partitions, 3.3 GB, ZSTD
  parse_13f_manifest_full.parquet       the manifest, converted to its own parquet
  holdings_clean.tsv.gz                 4,110 MB, the concatenated Go output
```

The partition key is the year of `period_of_report`. 13F sub-splits by quarter into
`QN.parquet`; N-PX is an annual report, so there is no quarter to sub-split on and
its parts are numbered instead. A `period_of_report` that does not yield a plausible
year is quarantined and counted, never partitioned — the existing `holdings_13f/` on
rjds carries a `year=3006` directory because nothing validated the key.

**Schema is a 1:1 passthrough of the Go column order** — same names, same order, no
renaming — and the typing is deliberately minimal:

| parser | typed | everything else |
|---|---|---|
| 13F | `value`, `shares`, `voting_sole`, `voting_shared`, `voting_none` → int64; `cusip_valid`, `is_amendment` → bool | string |
| N-PX | `shares_voted_total`, `shares_on_loan`, `shares_voted` → float64 | string |

N-PX share counts are float64 rather than int64 because real filings carry
`66301.000000` and `eis_NPX_PROXY_VOTING_RECORD.xsd` declares them decimal; int64
would reject the whole column. **Dates stay strings** (`YYYYMMDD`), matching the
existing dataset. The manifest is converted separately into its own parquet rather
than being folded in, because it is one row per *filing* and the dataset is one row
per *record*. Read side is polars.

**The measured sizes, which are not the reason to do this.** 13F: 4,110 MB of
`tsv.gz` becomes 3.3 GB of parquet, **1.25×**. N-PX: 3,119 KB becomes 1,807 KB,
**1.7×**, on 112,771 rows. Storage is roughly a wash. The case for parquet is typed
columns, predicate pushdown on the `year=` partition, and not re-parsing 100M strings
on every panel build.

**Why this is a script and not a recipe in this file.** The producer of
`holdings_13f/` was never in version control — only its readers survived — so a
load-bearing dataset had three consumers and no tracked writer. And because the
binaries write no header row, every consumer re-declares the schema by hand:
`~/projects/mirror/scripts/build_blockholders_panel.py:27` hard-codes a `GO_COLUMNS`
list. That is two representations of one fact, and a prose recipe is what produced
both failures. `edgar_parquet` reads the column order out of the Go source at run
time instead, so there is nothing to drift.

**Known stale:** `build_blockholders_panel.py:27` `GO_COLUMNS` is a hand-copied
`scan_covers` blockholders column list in a different repo, not edited by this
skill — migrate it to a call into `edgar_parquet`'s Go-source column reader rather
than re-copying the list when that panel is next touched.

**Invocation** (the flags are pinned by `test_edgar_parquet.py::test_cli_contract`,
which is the authority on their spelling):

```bash
skills/wrds/scripts/edgar_parquet/cli.py \
  --parser 13f \
  --in 'out/*.tsv.gz' \
  --out data/processed/holdings_13f \
  --manifest-in 'out/*.manifest.tsv.gz' \
  --manifest-out data/processed/parse_13f_manifest_full.parquet \
  --quarantine data/processed/quarantine
```

`--parser` takes `13f` or `npx`; an unknown value exits non-zero. `cli.py` carries a
`uv run` shebang and declares pyarrow as a PEP 723 inline dependency, because pyarrow
is not in system Python locally or on rjds. Verify the converter with
`bash skills/wrds/scripts/edgar_parquet/check.sh`.
