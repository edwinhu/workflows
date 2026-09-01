# SEC EDGAR Access via WRDS

## Contents

- [Key Tables](#key-tables) - `edgar.filings`, `edgar.company_info`
- [Grain & Keys (verified 2026-06-09)](#grain--keys-verified-2026-06-09) - **`edgar` schema does NOT exist on WRDS pg — use `wrdssec_all`**
- [Common Form Types](#common-form-types) - 10-K, 10-Q, 8-K, DEF 14A, Form 4
- [Query Patterns](#query-patterns) - Find filings, filter by type/date
- [Accessing Filing Documents](#accessing-filing-documents) - URL construction, Form 4 URLs
- [CRITICAL: DCN vs Accession Number](#critical-dcn-vs-accession-number) - WRDS gotcha
- [Linking CIK to Other Identifiers](#linking-cik-to-other-identifiers) - CIK↔GVKEY
- [Working with Filing Content](#working-with-filing-content) - Download, parse sections
- [Rate Limiting](#rate-limiting-for-sec-access) - SEC API limits

## Overview

WRDS provides SEC EDGAR filing data through the `edgar` schema. This includes filing metadata, company information, and filing content access.

## Key Tables

### edgar.filings
Master filing table with all SEC submissions.

| Field | Type | Description |
|-------|------|-------------|
| `cik` | varchar(10) | Central Index Key (10-digit padded) |
| `accession_number` | varchar(25) | Unique filing identifier |
| `form_type` | varchar(20) | Filing type (10-K, 10-Q, 8-K, etc.) |
| `file_date` | date | Date filed with SEC |
| `accepted` | timestamp | SEC acceptance timestamp |
| `company_name` | varchar(150) | Filer company name |
| `fiscal_year_end` | varchar(4) | Fiscal year end (MMDD format) |
| `sic` | varchar(4) | Standard Industrial Classification |
| `state` | varchar(2) | State of incorporation |
| `file_num` | varchar(20) | SEC file number |
| `fiscal_year` | int | Fiscal year of filing |

### edgar.company_info
Company registration information.

| Field | Type | Description |
|-------|------|-------------|
| `cik` | varchar(10) | Central Index Key |
| `company_name` | varchar(150) | Company name |
| `sic` | varchar(4) | SIC code |
| `state` | varchar(2) | State |
| `fiscal_year_end` | varchar(4) | Fiscal year end |

## Grain & Keys (verified 2026-06-09)

> **WARNING — `edgar.filings` and `edgar.company_info` DO NOT EXIST on wrds-pgdata.** Verified 2026-06-09:
> no `edgar` schema in `pg_namespace` at all (not a permissions issue). The query patterns above are kept
> for historical context but will fail. The working SEC filing-index tables for this account are
> `wrdssec_all.forms` and `wrdssec_all.wrds_forms` (WRDS SEC Analytics Suite — manuals:
> https://wrds-www.wharton.upenn.edu/pages/support/manuals-and-overviews/wrds-sec-analytics-suite/).
> See `wrds-forms-tables.md` for column details.

- **Row PK `wrdssec_all.wrds_forms`** (~26.9M rows): `fname` — VERIFIED SAMPLED 2023 fdate slice: 0 dupes
  over 1,159,918 rows. `(accession, cik)` — also 0 dupes (SAMPLED 2023). `accession` ALONE IS NOT UNIQUE:
  347,721 dupes in the 2023 slice — one row per filer CIK on multi-filer submissions (`regcount` co-registrants).
  Count filings with `COUNT(DISTINCT accession)`; count filer-filings with `(accession, cik)`.
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
  **`N-Q` (2003-10-27 .. 2021-04-29, 95,003 filings, 4,206 CIKs) has NO series identifier** —
  zero matches for `S0000…` in a sampled filing; it is unstructured HTML with the schedule as a
  table, so pre-2019 holdings join at REGISTRANT level only and need parsing. Since `N-PX`,
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
  supersede by `(cik, form-family, period)` taking the latest `fdate`, as in `blockholders.md`.
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

## Query Patterns

### Find Company Filings

```python
def get_company_filings(pool, cik: str, form_types: list = None,
                        start_date: str = None) -> list:
    """Get SEC filings for a company.

    Args:
        pool: WRDS connection pool
        cik: CIK number (will be normalized)
        form_types: List of form types to filter (optional)
        start_date: Start date for filings (optional)

    Returns:
        List of filing records
    """
    # Normalize CIK to 10 digits
    cik_normalized = str(cik).zfill(10)

    query = """
        SELECT cik, accession_number, form_type, file_date,
               company_name, sic
        FROM edgar.filings
        WHERE cik = %s
    """
    params = [cik_normalized]

    if form_types:
        query += " AND form_type = ANY(%s)"
        params.append(form_types)

    if start_date:
        query += " AND file_date >= %s"
        params.append(start_date)

    query += " ORDER BY file_date DESC"

    with pool.cursor() as cursor:
        cursor.execute(query, tuple(params))
        return cursor.fetchall()
```

### Get 10-K and 10-Q Filings

```python
def get_periodic_filings(pool, cik: str, years: int = 5) -> list:
    """Get annual and quarterly filings for analysis."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                cik,
                accession_number,
                form_type,
                file_date,
                fiscal_year,
                company_name
            FROM edgar.filings
            WHERE cik = %s
              AND form_type IN ('10-K', '10-Q', '10-K/A', '10-Q/A')
              AND file_date >= CURRENT_DATE - INTERVAL '%s years'
            ORDER BY file_date DESC
        """, (cik_normalized, years))

        return cursor.fetchall()
```

### Find 8-K Filings by Topic

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

```python
def get_8k_filings(pool, cik: str, start_date: str) -> list:
    """Get 8-K filings for a company."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                cik,
                accession_number,
                form_type,
                file_date,
                accepted,
                company_name
            FROM edgar.filings
            WHERE cik = %s
              AND form_type IN ('8-K', '8-K/A')
              AND file_date >= %s
            ORDER BY file_date DESC
        """, (cik_normalized, start_date))

        return cursor.fetchall()
```

### Industry-Wide Filing Search

```python
def get_industry_filings(pool, sic: str, form_type: str,
                         start_date: str, end_date: str) -> list:
    """Get filings for an entire industry."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                cik,
                company_name,
                accession_number,
                form_type,
                file_date
            FROM edgar.filings
            WHERE sic = %s
              AND form_type = %s
              AND file_date BETWEEN %s AND %s
            ORDER BY file_date DESC
        """, (sic, form_type, start_date, end_date))

        return cursor.fetchall()
```

## Accessing Filing Documents

### Constructing SEC URLs

EDGAR documents are available at SEC.gov using accession numbers:

```python
def get_filing_url(cik: str, accession_number: str) -> str:
    """Construct SEC EDGAR URL for a filing.

    Args:
        cik: CIK number (will be normalized)
        accession_number: Filing accession number

    Returns:
        URL to filing index page
    """
    # Normalize CIK (remove leading zeros for URL)
    cik_clean = str(int(cik))

    # Remove dashes from accession number for path
    accession_clean = accession_number.replace('-', '')

    return (f"https://www.sec.gov/Archives/edgar/data/"
            f"{cik_clean}/{accession_clean}/")

def get_filing_document_url(cik: str, accession_number: str,
                            document_name: str) -> str:
    """Construct URL for specific document within filing."""
    base_url = get_filing_url(cik, accession_number)
    return f"{base_url}{document_name}"
```

### Form 4 URLs

Form 4 filings have a special XML viewer format:

```python
def get_form4_viewer_url(cik: str, accession_number: str) -> str:
    """Construct SEC Form 4 viewer URL.

    The xslF345X03 stylesheet renders Form 4 in a readable format.
    """
    cik_clean = str(int(cik))
    accession_clean = accession_number.replace('-', '')

    return (f"https://www.sec.gov/Archives/edgar/data/"
            f"{cik_clean}/{accession_clean}/xslF345X03/primarydocument.xml")

def get_form4_index_url(cik: str, accession_number: str) -> str:
    """Construct Form 4 filing index URL."""
    cik_clean = str(int(cik))
    accession_clean = accession_number.replace('-', '')

    return (f"https://www.sec.gov/Archives/edgar/data/"
            f"{cik_clean}/{accession_clean}/{accession_number}-index.htm")
```

### CRITICAL: DCN vs Accession Number

**WRDS `tr_insiders` uses DCN (Document Control Number), NOT SEC accession numbers.**

The DCN in `tr_insiders.header` is an internal Thomson Reuters identifier that
does NOT work for constructing SEC EDGAR URLs. To get the actual SEC accession
number, query the SEC filings tables:

```python
def get_accession_from_dcn(pool, cik: str, filing_date: str) -> str | None:
    """Get SEC accession number for a Form 4 filing.

    WRDS tr_insiders uses DCN, not accession numbers. Use this to find
    the actual SEC accession number for URL construction.
    """
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT accession_number
            FROM edgar.filings
            WHERE cik = %s
              AND form_type = '4'
              AND file_date = %s
            ORDER BY accepted DESC
            LIMIT 1
        """, (cik_normalized, filing_date))

        row = cursor.fetchone()
        return row[0] if row else None
```

Alternative: Query SEC EDGAR API directly:

```python
import requests

def get_filings_from_sec_api(cik: str) -> dict:
    """Get all filings for a company from SEC EDGAR API.

    Returns JSON with filings.recent.accessionNumber for all filings.
    """
    cik_padded = str(cik).zfill(10)
    url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"

    response = requests.get(
        url,
        headers={'User-Agent': 'Academic Research your@email.edu'},
        timeout=30
    )
    response.raise_for_status()
    return response.json()
```

### Download Filing Text via WRDS rclone (Preferred for Bulk Access)

<EXTREMELY-IMPORTANT>
**IRON LAW: For bulk filing text, use rclone from the WRDS filesystem. NEVER pull text blobs through SQL. NEVER make per-filing SEC.gov HTTP requests.**

The correct pattern is always:
1. **Query metadata** from WRDS SQL (accession numbers, fnames, dates) — fast, small result
2. **rclone the raw files** from `/wrds/sec/archives/` — parallelizable, cacheable to disk
3. **Process locally** — regex, NLP, whatever — no database round-trips
</EXTREMELY-IMPORTANT>

#### WRDS Filing Filesystem Layout

WRDS provides two copies of every filing:

| Directory | Content | Use case |
|-----------|---------|----------|
| `/wrds/sec/archives/` | Raw filings (HTML, images, full SGML) | When you need exact original formatting |
| `/wrds/sec/wrds_clean_filings/` | **Cleaned plain text** (HTML stripped, images removed) | **Default choice** — text extraction, NLP, regex |

**Use `wrds_clean_filings` by default.** It's dramatically smaller (clean text compresses ~5-10x vs HTML's ~0.8x), faster to transfer, and easier to parse. Only use `archives` if you specifically need the original HTML/SGML structure.

Both directories share the same path layout: `{CIK_prefix}/{CIK_int}/{accession}.txt`

The `fname` field from `wrdssec_all.wrds_forms` gives the path as `edgar/data/{CIK_int}/{accession}.txt`. Convert to filesystem path:

```python
def fname_to_rclone_path(fname: str) -> str:
    """Convert WRDS fname to rclone path.

    fname: 'edgar/data/1034196/0001104659-20-000437.txt'
    -> wrds:/wrds/sec/archives/000103/1034196/0001104659-20-000437.txt

    Path mapping:
    - CIK as integer: 1034196
    - Zero-pad to 10 digits: 0001034196
    - Parent directory: first 6 chars = 000103
    - Child directory: CIK as integer = 1034196
    """
    parts = fname.split("/")
    cik_int = parts[2]       # '1034196'
    filename = parts[3]      # '0001104659-20-000437.txt'
    cik_padded = cik_int.zfill(10)
    parent = cik_padded[:6]  # '000103'
    # Use wrds_clean_filings for text extraction (default):
    return f"/wrds/sec/wrds_clean_filings/{parent}/{cik_int}/{filename}"
    # Use archives only if you need original HTML/SGML:
    # return f"/wrds/sec/archives/{parent}/{cik_int}/{filename}"
```

#### Step 1: Query Metadata (Fast)

```python
import wrds

db = wrds.Connection(wrds_username="eddyhu")

# Get filing paths for all CIKs at once — one query per form type
meta = db.raw_sql(f"""
    SELECT cik, accession, form, fdate AS filing_date, fname
    FROM wrdssec_all.wrds_forms
    WHERE cik IN ('{cik_list}')
    AND form IN ('SC 13D', 'SC 13D/A')
    AND fdate >= '2000-01-01'
""")
# Result: ~60K rows of metadata, no text — fast
db.close()
```

#### Step 2: Bulk Download via rclone (bash script)

Python generates the file list, bash does the download. Clean separation — the rclone part is deterministic and rerunnable.

**Step 2a: Python generates the files-from list**

```python
# Convert WRDS fnames to rclone-relative paths
with open("data/raw/edgar_filings/files_to_download.txt", "w") as f:
    for fname in meta["fname"]:
        # fname: 'edgar/data/1034196/0001104659-20-000437.txt'
        # rclone path: 000103/1034196/0001104659-20-000437.txt
        parts = fname.split("/")
        cik_int = parts[2]
        filename = parts[3]
        parent = cik_int.zfill(10)[:6]
        f.write(f"{parent}/{cik_int}/{filename}\n")
```

**Step 2b: Bash downloads the files**

For small batches (<10K files), `rclone copy --files-from` is fine:

```bash
rclone copy wrds:/wrds/sec/wrds_clean_filings/ "$OUTPUT_DIR" \
    --files-from "$FILES_FROM" --transfers 16 --no-traverse --stats 30s --stats-one-line
```

For large batches (>10K files), use the tar approach below instead — it's significantly faster.

**For large batches (>10K files): tar server-side, download one archive (PREFERRED)**

This is the fastest approach: (1) one large sequential transfer beats thousands of SFTP round-trips, (2) `rclone copy` handles resume if the connection drops. Use `scp` for the small file list upload (rclone SFTP can be flaky after heavy use), `rclone` for the large archive download.

```bash
#!/usr/bin/env bash
# download_filings_tar.sh — tar on WRDS server, download single archive
set -euo pipefail

FILES_FROM="${1:?Usage: $0 <files-from.txt> <output-dir>}"
OUTPUT_DIR="${2:?Usage: $0 <files-from.txt> <output-dir>}"

# Use /scratch/<institution>/<user>/ for large files — NOT /tmp (only 44 GB)
WRDS_USER="$(ssh wrds whoami)"
WRDS_SCRATCH="/scratch/nyu/${WRDS_USER}"  # Change 'nyu' to your institution
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
rclone copy "wrds:$REMOTE_TMP" "$OUTPUT_DIR" --stats 30s --stats-one-line

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
# Python generates the file list (step 2a above), then:
bash download_filings_tar.sh data/raw/edgar_filings/files_to_download.txt data/raw/edgar_filings/raw/
```

**IMPORTANT: WRDS `/tmp` is only ~44 GB — do NOT tar there.** Use `/scratch/nyu/<username>/` instead (13 TB free, NFS-mounted).

Key paths on WRDS:
- `/tmp/` — 44 GB, shared, fills up fast. Only for small temp files (<1 GB).
- `/scratch/nyu/<username>/` — 13 TB, institution-scoped. Use for large archives.
- `/home/<username>/` — quota-limited. Don't use for bulk data.

Size estimates for 110K filings:
- **`wrds_clean_filings`** (plain text): ~5-10 GB tar.gz. Clean text compresses well (~5-10x).
- **`archives`** (raw HTML): ~40-70 GB tar.gz. HTML compresses poorly (~0.8x).

**Step 2c: Python reads the downloaded files**

```python
# Read local files — no network, no DB
texts = {}
for fname in meta["fname"]:
    parts = fname.split("/")
    cik_int, filename = parts[2], parts[3]
    parent = cik_int.zfill(10)[:6]
    local_path = Path(f"data/raw/edgar_filings/raw/{parent}/{cik_int}/{filename}")
    if local_path.exists():
        texts[fname] = local_path.read_text(errors="replace")
```

**Anti-patterns to avoid:**

| Approach | Problem |
|----------|---------|
| `rclone cat` per file in Python | Spawns N subprocesses — for 60K files, orders of magnitude slower |
| `rclone copy` per CIK directory in a Python loop | Sequential; 3K dirs = 3K rclone invocations |
| `subprocess.run(["rclone", ...])` from Python | Mixing download logic into Python; not rerunnable independently |
| `--transfers 32` over SFTP | Overwhelms SSH multiplexing, causes `mux_client_request_session` errors |
| `--progress` flag in scripts | Generates too much terminal output — use `--stats 30s --stats-one-line` instead |
| Pulling text via SQL (`SELECT filing_text`) | 9GB+ in memory for 60K filings. OOM risk. |
| Per-filing SEC.gov HTTP requests | Rate-limited to 10 req/sec. 60K files = 100+ min. |

#### Step 3: Process Locally

```python
# Extract whatever you need from the raw text — no DB needed
for fname, text in texts.items():
    result = your_extractor(text[:80000])  # Limit to first 80K chars
```

#### Ticker-to-CIK Mapping

Use `secsamp._names_` for bulk ticker-to-CIK mapping:

```python
ticker_map = db.raw_sql(f"""
    SELECT DISTINCT tickerh AS ticker, cik
    FROM secsamp._names_
    WHERE tickerh IN ('{ticker_list}')
""")
```

#### Why Not SQL Text Blobs or SEC.gov URLs?

| Approach | Problem |
|----------|---------|
| `SELECT filing_text FROM wrds_sec_search.filing_*` | Text columns are huge — 9GB+ for 60K filings. OOM risk. |
| Per-filing `SELECT` in a loop | N round-trips to WRDS PostgreSQL. 60K queries = hours. |
| SEC.gov HTTP requests | Rate-limited to 10 req/sec. 60K files = 100+ minutes. |
| **rclone from WRDS filesystem** | Parallel file reads, disk cache, no rate limit, no OOM. |

## Linking CIK to Other Identifiers

### CIK to Compustat GVKEY

```python
def cik_to_gvkey(pool, cik: str) -> str | None:
    """Convert SEC CIK to Compustat GVKEY."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT gvkey
            FROM comp.company
            WHERE cik = %s
            LIMIT 1
        """, (cik_normalized,))

        row = cursor.fetchone()
        return row[0] if row else None
```

### Fuzzy Company Matching

When CIK is not available, use fuzzy matching:

```python
from difflib import SequenceMatcher

def find_company_by_name(pool, company_name: str,
                         threshold: float = 0.7) -> list:
    """Find companies by name with fuzzy matching.

    Returns list of (cik, company_name, similarity_score) tuples.
    """
    # Get candidate companies (limit search space)
    name_upper = company_name.upper()
    first_word = name_upper.split()[0]

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT cik, company_name
            FROM edgar.filings
            WHERE UPPER(company_name) LIKE %s
            LIMIT 100
        """, (f'{first_word}%',))

        candidates = cursor.fetchall()

    # Score each candidate
    matches = []
    for cik, db_name in candidates:
        score = SequenceMatcher(None, name_upper, db_name.upper()).ratio()
        if score >= threshold:
            matches.append((cik, db_name, score))

    # Sort by score descending
    matches.sort(key=lambda x: x[2], reverse=True)

    return matches
```

## Filing Counts and Statistics

```python
def get_filing_statistics(pool, cik: str) -> dict:
    """Get filing statistics for a company."""
    cik_normalized = str(cik).zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                form_type,
                COUNT(*) as count,
                MIN(file_date) as earliest,
                MAX(file_date) as latest
            FROM edgar.filings
            WHERE cik = %s
            GROUP BY form_type
            ORDER BY count DESC
        """, (cik_normalized,))

        results = cursor.fetchall()

        return {
            row[0]: {
                'count': row[1],
                'earliest': row[2],
                'latest': row[3]
            }
            for row in results
        }
```

## Working with Filing Content

For actual filing content, **always prefer rclone from the WRDS filesystem** (see [Download Filing Text via WRDS rclone](#download-filing-text-via-wrds-rclone-preferred-for-bulk-access) above). This is faster, has no rate limits, and caches to disk.

For small one-off downloads (<10 filings), SEC.gov URLs are acceptable:

### Parsing 10-K Sections

```python
import re
import requests

def download_10k_text(cik: str, accession_number: str) -> str | None:
    """Download 10-K full text from SEC."""
    # Get filing index to find the main document
    base_url = get_filing_url(cik, accession_number)

    # Try common document names
    doc_names = [
        f'{accession_number}.txt',
        'complete-submission.txt',
    ]

    for doc_name in doc_names:
        url = f'{base_url}{doc_name}'
        response = requests.get(url, timeout=30)
        if response.status_code == 200:
            return response.text

    return None

def extract_10k_section(text: str, section: str) -> str | None:
    """Extract specific section from 10-K text.

    Common sections:
    - Item 1: Business
    - Item 1A: Risk Factors
    - Item 7: MD&A
    - Item 7A: Market Risk
    - Item 8: Financial Statements
    """
    # Section patterns (simplified)
    patterns = {
        'Item 1': r'Item\s+1\.?\s+Business(.*?)Item\s+1A',
        'Item 1A': r'Item\s+1A\.?\s+Risk\s+Factors(.*?)Item\s+1B',
        'Item 7': r'Item\s+7\.?\s+Management.*?Discussion(.*?)Item\s+7A',
        'Item 8': r'Item\s+8\.?\s+Financial\s+Statements(.*?)Item\s+9',
    }

    if section not in patterns:
        return None

    match = re.search(patterns[section], text, re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else None
```

## Best Practices

1. **Always normalize CIK** to 10 digits with leading zeros
2. **Use form_type arrays** with `ANY(%s)` for multiple types
3. **Include date filters** to limit result sets
4. **Cache filing metadata** locally for repeated analysis
5. **Respect SEC rate limits** when downloading documents (10 requests/second)
6. **Use WRDS file access** for bulk downloads when available

## Self-built SEC index via SGE (fallback for WRDS lag / secondary CIKs)

**When to use:**

1. You need **secondary CIKs** that `wrdssec_all.wrds_forms` drops (it only stores the filer CIK).
   Examples: Form 4 issuer + reporting owner, SC 13D subject + filer, Form 144 issuer.
2. WRDS `wrds_forms` is stale or missing recent filings and you want to (re)build the index yourself.
3. You need a field `wrds_forms` does not expose (e.g. every role block, IRS number, film number).

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
python scripts/sec_index/build_index.py --all
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

## Rate Limiting for SEC Access

```python
import time
from functools import wraps

def rate_limit(calls_per_second: int = 10):
    """Decorator to rate-limit SEC API calls."""
    min_interval = 1.0 / calls_per_second
    last_call = [0.0]

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            elapsed = time.time() - last_call[0]
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            last_call[0] = time.time()
            return func(*args, **kwargs)
        return wrapper
    return decorator

@rate_limit(calls_per_second=10)
def fetch_filing_from_sec(url: str) -> str:
    """Rate-limited fetch from SEC EDGAR."""
    response = requests.get(
        url,
        headers={'User-Agent': 'YourName your@email.com'},
        timeout=30
    )
    response.raise_for_status()
    return response.text
```

## Go-Based Filing Parsers

For large-scale extraction from SEC filings (100K+ documents), Go parsers running
on WRDS compute nodes via SGE are dramatically faster than Python. Pattern:

1. **Build filing index** (Python or SAS, on the grid): query `wrdssec_all.wrds_forms`
   for filing paths, and write them one per line into a filelist
2. **Go parser** (compiled binary): takes the filelist with `-files-from` — every
   binary here is filelist-driven and none of them reads stdin — opens each filing on
   WRDS NFS, extracts its fields, and writes gzipped TSV with **no header row**
3. **SGE array job**: shards the filelist by *bytes* across N workers for parallelism
4. **Convert to parquet** (Python, local): `scripts/edgar_parquet/` types the columns,
   partitions Hive-style by year and writes ZSTD parquet. See
   [The record-table output contract](#the-record-table-output-contract) below.
5. **Build panel** (Python, local): read the parquet dataset with polars and aggregate

### Path Convention for `wrds_clean_filings`

```
/wrds/sec/wrds_clean_filings/{cik_zfill10[:6]}/{cik_int}/{accession}.txt
```

Example: CIK 34088, accession 0001193125-25-073986 ->
`/wrds/sec/wrds_clean_filings/000034/34088/0001193125-25-073986.txt`

Python helper:
```python
def fname_to_clean_path(fname: str) -> str:
    """Convert WRDS fname to wrds_clean_filings path.
    fname: 'edgar/data/34088/0001193125-25-073986.txt'
    """
    parts = fname.split("/")
    cik_int = parts[2]
    filename = parts[3]
    parent = cik_int.zfill(10)[:6]
    return f"{parent}/{cik_int}/{filename}"
```

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

| Parser | Source | Extracts | Input | Accuracy |
|--------|--------|----------|-------|----------|
| `quorum` (profile) | `scan_covers/profiles_quorum.go` + `profiles/quorum/` | Bylaw quorum threshold from DEF 14A | DEF 14A, DEFM14A | 96.6% explicit parse |
| `state_incorp` (profile) | `scan_covers/profiles_state_incorp.go` | State of incorp + HQ state from 10-K SGML header | 10-K filings | 98.4% vs Barzuza et al. |
| `blockholders_13dg` (profile) | `scan_covers/profiles_blockholders_13dg.go` | Item 12 + max ownership % | SC 13D/G | — |
| `proxy_advisors` (profile) | `scan_covers/profiles_proxy_advisors.go` | ISS/GL/EJ mentions | 485BPOS/APOS | — |
| `tender_sc_to` (profile) | `scan_covers/profiles_tender_sc_to.go` | Tender offer cover fields | SC TO-* | — |
| `parse_13f` (**standalone, sanctioned**) | `scripts/parse_13f/parse_13f_go/` | One row per holding from the 13F `infoTable`, plus a manifest row per filing | 13F-HR, 13F-HR/A | 89,072,489 rows over 248,500 filings |
| `parse_npx` (**standalone, sanctioned**) | `scripts/parse_npx/parse_npx_go/` | One row per `voteRecord` (XML era) or proposal line (legacy text era), plus a manifest row per filing | N-PX, N-PX/A | — |

**Every cover-page extraction is a profile; exactly two record-table parsers are
not.** Two rows here previously pointed into `~/projects/mirror` —
`bylaw_quorum/parse_quorum_go/` and `state_incorp_go/` — and the second was already
dead (that directory does not exist). The quorum parser has been ported to
`-profile quorum`, verified identical to the standalone on fixtures covering every
confidence tier; see `profiles/quorum/README.md`.

Reaching for a standalone binary is still the documented Red Flag: `scan_covers`
handles SGE sharding, path construction and concurrency generically, so a new
extraction is a `profiles_*.go` file plus a `profiles/<name>/` directory for staging
and panel building.

**The exception, and why it is mechanical rather than a matter of taste.**
`scan_covers` `FullBody` mode reads the entire file into one buffer per worker, and
its `Field` model is a regex reduced to **one value per column** for the filing. A
*record table* is neither of those things: the 13F `infoTable` fans a single filing
out into thousands of holding rows, and one 23.8 MB N-PX filing carries 28,067
nested `voteRecord`s (`scripts/parse_npx/README.md`). Buffering that file and
collapsing it to one value per column loses the table. `parse_13f` and `parse_npx`
therefore stream instead — `parse_13f` with a hand-rolled information-table scanner,
`parse_npx` with `xml.Decoder` at constant memory — and they are the only two
sanctioned exceptions. Anything cover-page or SGML-header shaped is still a profile,
with no exception.

### The record-table output contract

Both record-table binaries emit headerless gzipped TSV, which is a transport format,
not a storage format. The converter that turns it into parquet lives at
[`scripts/edgar_parquet/`](../scripts/edgar_parquet/) and serves both parsers from
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
