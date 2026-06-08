# SEC Form D / Regulation D Data

Companies raising money under SEC Regulation D (private-placement exemptions) file
**Form D** within 15 days of first sale. There are **two data sources** for Form D, and you
pick based on the time period you need.

## Contents

- [Two Sources](#two-sources)
- [Tables & Key Fields](#tables--key-fields)
- [CIK Columns (CRITICAL)](#cik-columns-critical)
- [Grain & Keys](#grain--keys)
- [Denormalization Gotcha](#denormalization-gotcha)
- [Exemption Type Codes](#exemption-type-codes)
- [Industry Categories](#industry-categories)
- [Canonical Query Pattern](#canonical-query-pattern)
- [Date Coverage](#date-coverage)
- [Post-2020 Data Gap](#post-2020-data-gap)
- [Getting Post-2020 Data (SEC XML/TSV)](#getting-post-2020-data-sec-xmltsv)
- [Dollar Amount Notes](#dollar-amount-notes)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Validated Benchmarks](#validated-benchmarks)
- [Common Gotchas](#common-gotchas)

## Two Sources

| # | Source | Where | Coverage | Use when |
|---|--------|-------|----------|----------|
| 1 | **WRDS parsed detail** | `wrdssec.wrds_vc_formd` | full XML-parsed offering data, 2000 – **Oct 2020** | analysis on offering detail (exemptions, $ amounts, industry) through 2020 |
| 1 | **WRDS filing index** | `wrdssec.wrds_forms` | accession + filing date only (no offering detail), 2008 – present | enumerate the filing universe / get accession numbers, any year |
| 2 | **SEC EDGAR structured TSV / XML** | sec.gov quarterly `*_d.zip`; EDGAR per-filing XML | full offering detail, **2008 – present** | anything **post-Oct-2020** (the WRDS parse is frozen — see below), or to validate WRDS counts |

**Rule of thumb:** through Oct 2020 use WRDS `wrds_vc_formd`; after that, go to the SEC EDGAR
structured-data TSV files (source 2). The two are reconcilable — WRDS `wrds_vc_formd` matches the
SEC official counts within 0.5% for 2011–2019 (see [Validated Benchmarks](#validated-benchmarks)).

## Tables & Key Fields

### Source 1 — `wrdssec.wrds_vc_formd` (parsed offering detail)

**Issuer identity**
- `primarycik` — SEC CIK of the primary (lead) issuer; **USE THIS for EDGAR linking** (10-digit padded)
- `regcik` — CIK of the specific co-issuer for this row (usually matches `primarycik`)
- `primaryentityname` — primary issuer name
- `primaryentitytype` — Corporation, LLC, LP, Trust, etc.
- `primaryjurisdictionofinc` / `primaryissuer_stateorcountry` — incorporation / state-country
- `accession` — SEC accession number, format `XXXXXXXXXX-YY-NNNNNN` (the offering identifier — see [Grain & Keys](#grain--keys))

**Offering details**
- `industrygrouptype` — industry classification (35 categories — see [Industry Categories](#industry-categories); can be NULL)
- `exempt_item` — exemption code, e.g. `06`, `06b`, `06c`, `3C.7` (multiple rows per filing — one per exemption claimed)
- `first_sale_date` — date of first sale (the only DATE-typed field; has junk values, see gotchas)
- `signaturedate` — date filing was signed (varchar; proxy for filing date)
- `totalofferingamount` — maximum offering size (**varchar**, may be text like "Indefinite")
- `totalamountsold` — gross proceeds sold to date (**varchar**, dollars)
- `totalremaining`, `minimuminvestmentaccepted`

**Security-type flags** (varchar `'Y'`/`'N'`)
- `isequitytype`, `isdebttype`, `isoptiontoacquiretype`, `issecuritytobeacquiredtype`,
  `ispooledinvestmentfundtype`, `istenantincommontype`, `ismineralpropertytype`

**Fund-specific**
- `investmentfundtype`, `is40act` (subject to Investment Company Act), `revenuerange`, `aggregatenetassetvaluerange`

**Investor info**
- `hasnonaccreditedinvestors`, `numbernonaccreditedinvestors`, `totalnumberalreadyinvested`

**Recipients / solicitation** (these drive denormalization)
- `recipientname` — broker-dealer / finder; `recipientcrdnumber` — FINRA CRD of the broker-dealer
- `state` — state of solicitation (NULL if `allstatesflag` set); `allstatesflag` — `'All States'`

**Filing metadata / amendments**
- `submissiontype` — `'D'` = new filing, `'D/A'` = amendment
- `isamendment` — `'true'`/`'false'` (32 mislabeled rows exist — filter on `submissiontype` too)
- `previousaccessionnumber` — prior accession (links an amendment to the filing it amends)
- `edgarsubmission_ordinal` — always 1.0 (not useful for dedup)

### Source 1 — `wrdssec.wrds_forms` (filing index only)
| Column | Description |
|--------|-------------|
| `accession` | Accession number |
| `form` | `'D'` or `'D/A'` |
| `fdate` | Filing date (a real DATE — better than `wrds_vc_formd`'s `signaturedate`) |
| `cik` | Filer CIK |
| `coname` | Company name |

### Source 2 — SEC EDGAR structured-data TSV (post-2020)
Quarterly `*_d.zip` bundles split a filing across files; join on `ACCESSIONNUMBER`:

| File | Key columns | Notes |
|------|-------------|-------|
| `FORMDSUBMISSION.tsv` | `ACCESSIONNUMBER`, `FILE_NUM`, `SUBMISSIONTYPE`, `FILING_DATE` | `FILE_NUM` is stable **across amendments** (the offering id); `ACCESSIONNUMBER` is per-filing |
| `OFFERING.tsv` | `FEDERALEXEMPTIONS_ITEMS_LIST` (e.g. "Rule 506(b)"), `TOTALAMOUNTSOLD`, `ISAMENDMENT` | numeric amounts (unlike WRDS) |
| `ISSUERS.tsv`, `RECIPIENTS.tsv` | per-issuer / per-recipient rows | same denormalization as WRDS — dedup to `ACCESSIONNUMBER` |

## CIK Columns (CRITICAL)

`wrds_vc_formd` has three CIK-like columns serving different purposes:

| Column | What it is | Unique values | Use case |
|--------|-----------|---------------|----------|
| `primarycik` | **SEC CIK** | 186,303 | primary linking key to EDGAR |
| `regcik` | Registrant / co-issuer CIK | 186,630 | usually matches `primarycik` |
| `issuer_cik` | **FINRA CRD number** | 3,402 | NOT an SEC CIK — broker-dealer tracking |

**WARNING:** `issuer_cik` is a FINRA CRD number, **not** an SEC CIK. Do not use it for EDGAR
lookups — use `primarycik` (zero-pad to 10 digits when joining to EDGAR/CRSP/Compustat).

## Grain & Keys

Two levels of identity — declare both before counting, because the raw table is **not** one row
per filing.

| Level | Key | Meaning |
|-------|-----|---------|
| **Raw row grain** | `co-issuer × recipient × state` | denormalized; `rows = n_regcik × n_recipientname × n_state`. A single offering can be 100k+ rows |
| **Offering grain** | `accession` (WRDS/SEC) — or `FILE_NUM` (SEC TSV) to span amendments | the analytic unit; **always dedup to this with `COUNT(DISTINCT accession)` / `DISTINCT ON (accession)`** |

**Verify:** `COUNT(*) >> COUNT(DISTINCT accession)` is expected (denormalization), so `df.duplicated()`
will report huge counts that are NOT errors — the correct check is on the offering key:
`df.duplicated(subset=["accession"]).sum()` after a `DISTINCT ON (accession)` pull should be 0.

**Amendments:** a `D/A` re-files an offering. In WRDS, link via `previousaccessionnumber`; for a
point-in-time "new offerings" series filter `submissiontype='D' AND isamendment='false'`. To get
the latest state of an offering instead, supersede by keeping the most recent filing per offering
(`previousaccessionnumber` chain, or `FILE_NUM` in the SEC TSV which is stable across amendments).

## Denormalization Gotcha

**`wrds_vc_formd` is NOT one row per filing.** WRDS denormalizes each Form D across three dimensions:

```
rows = n_co_issuers (regcik) × n_broker_dealer_recipients (recipientname) × n_states (state)
```

| Dimension | Column | Effect |
|-----------|--------|--------|
| Co-issuers | `regcik` | ×100+ for large PE/debt offerings |
| Recipients | `recipientname` | ×6 typical for syndicates |
| States | `state` | ×50 when not using `allstatesflag` |

**Real example (2013):** Clear Channel Communications (accession `0001468078-13-000002`) had
100+ co-issuers × 6 broker-dealers = **749,700 rows for one offering**, inflating 2013's true
~19,848 filings to 1.58M "apparent filings."

```sql
-- WRONG: inflated by denormalization
SELECT COUNT(*)            FROM wrdssec.wrds_vc_formd WHERE submissiontype = 'D';
-- CORRECT
SELECT COUNT(DISTINCT accession) FROM wrdssec.wrds_vc_formd
  WHERE submissiontype = 'D' AND isamendment = 'false';
```

### Inflation factors by year
| Year | Raw `COUNT(*)` | `COUNT(DISTINCT accession)` | Inflation |
|------|------|------|------|
| 2011 | 14,960 | 18,171 | 0.8× (early years under-count for other reasons) |
| 2012 | 42,407 | 18,193 | 2.3× |
| **2013** | **1,577,119** | **19,842** | **79.5×** |
| 2014 | 22,531 | 22,196 | 1.0× |
| 2015 | 58,799 | 23,035 | 2.6× |
| 2017 | 64,102 | 24,591 | 2.6× |

## Exemption Type Codes

`exempt_item` (WRDS) / `FEDERALEXEMPTIONS_ITEMS_LIST` (SEC TSV). A single filing can claim
**multiple** exemptions (one row each in WRDS) — get them with
`SELECT DISTINCT exempt_item WHERE accession = X`.

| Code | Meaning | JOBS Act | Approx. row count* |
|------|---------|----------|--------------------|
| `06` | Rule 506 (generic) | Pre-JOBS; used 2009–2013, then split into 06b/06c | 8,180,557 |
| `06b` | Rule 506(b) — no general solicitation; accredited only | Post-JOBS | 1,077,496 |
| `06c` | Rule 506(c) — general solicitation allowed; effective Sep 23 2013 | Post-JOBS (new) | 59,919 |
| `05` | Rule 505 — repealed May 2017; max $5M | — | 2,026 |
| `04` | Rule 504 (see caveat) | — | 6,317 |
| `04.3` | Rule 504 subsection (see caveat) | — | 1,203 |
| `4a5` | Section 4(a)(5) | — | 2,745 |
| `46` | Section 4(a)(6) / Reg CF | — | 4,016 |
| `3C.1` | Investment Company Act §3(c)(1) — hedge/PE funds, <100 investors | — | 80,983 |
| `3C.5` | ICA §3(c)(5)(C) — mortgage REITs | — | 7,014 |
| `3C.6` | ICA §3(c)(6) | — | 2,433 |
| `3C.7` | ICA §3(c)(7) — qualified-purchaser funds | — | 260,803 |
| `3C.9` | ICA §3(c)(9) | — | 1,817 |
| `3C` | ICA §3(c) general | — | 1,746 |

\* Row counts are denormalized (per related-person/recipient/state), not offering counts — use
for relative prevalence only, not as filing counts.

> **Caveat on `04` / `04.3`:** sources disagree — these have also been documented as
> Section 4(a)(2) (`04`) and Section 4(a)(5)/Rule 144A (`04.3`). The numeric Rule-50x scheme
> (`04`=504, `05`=505, `06`=506) is shown above; if `04`/`04.3` matter to your analysis, verify
> against the SEC Form D "Federal Exemptions and Exclusions Claimed" item list for the filing year.

## Industry Categories

35 categories in `industrygrouptype` (row-level/denormalized counts — relative size only):

| Category | Count | Category | Count |
|----------|-------|----------|-------|
| Construction | 5,346,820 | Pharmaceuticals | 4,281 |
| Other | 1,695,939 | Business Services | 3,178 |
| Retailing | 1,570,435 | Computers | 3,098 |
| Pooled Investment Fund | 354,082 | Restaurants | 2,899 |
| Other Health Care | 188,901 | Commercial Banking | 2,579 |
| Manufacturing | 168,088 | Telecommunications | 2,236 |
| REITS and Finance | 98,081 | Agriculture | 2,017 |
| Other Real Estate | 71,412 | Lodging and Conventions | 1,212 |
| Other Technology | 48,528 | Hospitals and Physicians | 997 |
| Oil and Gas | 42,338 | Environmental Services | 638 |
| Commercial | 17,543 | Energy Conservation | 609 |
| Residential | 13,589 | Electric Utilities | 381 |
| Insurance | 13,043 | Other Travel | 349 |
| Biotechnology | 10,343 | Investment Banking | 331 |
| Other Energy | 8,905 | Tourism and Travel Services | 267 |
| Other Banking and Financial Services | 8,430 | Health Insurance | 175 |
| Investing | 7,729 | Coal Mining | 158 |
| | | Airlines and Airports | 118 |

## Canonical Query Pattern

```python
import psycopg2, pandas as pd
conn = psycopg2.connect(host='wrds-pgdata.wharton.upenn.edu', port=9737,
                        database='wrds', user='YOUR_USERNAME', sslmode='require')

# Annual count of new offerings by exemption type
# VALIDATED against SEC official quarterly TSV files (within 0.5%)
sql = """
    SELECT
        ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int AS filing_year,
        exempt_item,
        COUNT(DISTINCT accession)  AS new_offerings,          -- NOT COUNT(*)
        SUM(CASE WHEN totalamountsold ~ '^[0-9]+$'
                 THEN LEAST(totalamountsold::numeric, 1e9)    -- cap outliers
                 ELSE 0 END) / 1e9  AS total_sold_capped_bn
    FROM wrdssec.wrds_vc_formd
    WHERE submissiontype = 'D'        -- new filings only (not D/A)
      AND isamendment = 'false'       -- belt-and-suspenders (32 mislabeled rows)
      AND ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int
          BETWEEN %(start_year)s AND %(end_year)s
    GROUP BY filing_year, exempt_item
    ORDER BY filing_year, exempt_item
"""
df = pd.read_sql(sql, conn, params={'start_year': 2011, 'end_year': 2020})
```

### Getting one row per filing (primary issuer only)
```sql
SELECT DISTINCT ON (accession)
    accession, primarycik, primaryentityname, exempt_item,
    first_sale_date, totalamountsold, industrygrouptype
FROM wrdssec.wrds_vc_formd
WHERE submissiontype = 'D' AND isamendment = 'false'
ORDER BY accession, primarycik          -- picks one row per accession
```

### Using `first_sale_date` instead of filing year
- `first_sale_date` has junk values (dates from 1915 and 3013 exist); filter
  `BETWEEN '2009-01-01' AND '2024-12-31'`.
- The accession-year approach (above) is more reliable for annual time series.

## Date Coverage

| Period | Status | Notes |
|--------|--------|-------|
| 2000–2008 | Partial | SEC began requiring electronic Form D in 2008 |
| 2008–mid-2020 | Full | complete XML-parsed data in `wrds_vc_formd` |
| **Oct 2020 onward** | **GAP** | `wrds_vc_formd` frozen — use SEC EDGAR (source 2) |
| 2008–present | Index only | `wrds_forms` has accessions but no offering detail |

**Last row in `wrds_vc_formd`:** `signaturedate = '2020-10-02'`.

**Bulk-upload artifact:** 2009–2010 contain the SEC's retroactive conversion of paper filings —
row counts are anomalously large (6.5M rows for 2010) but deduplicate to ~12k unique filings.
Always use `COUNT(DISTINCT accession)`.

## Post-2020 Data Gap

`wrds_vc_formd` has not been updated since October 2020. `wrds_forms` shows the full accession
universe through present but provides **no offering detail** (no exemption type, no dollar amounts).

| Year | SEC official count | `wrds_vc_formd` parsed |
|------|-------------------|------------------------|
| 2020 | 28,126 | 16,638 (Q4 missing) |
| 2021 | 42,874 | 0 |
| 2022 | 42,414 | 0 |
| 2023 | 33,297 | 0 |
| 2024 | 33,243 | 0 |

(2021–2022 ~43k vs the ~28k pre-COVID trend likely reflects the SPAC/crypto boom.)

## Getting Post-2020 Data (SEC XML/TSV)

### Option A — SEC EDGAR quarterly structured-data TSV (recommended)
```python
import urllib.request, zipfile, io, time, pandas as pd

def download_formd_quarter(year: int, quarter: int) -> pd.DataFrame:
    """One quarter of Form D from SEC EDGAR structured data."""
    url = (f'https://www.sec.gov/files/structureddata/data/'
           f'form-d-data-sets/{year}q{quarter}_d.zip')
    req = urllib.request.Request(url, headers={'User-Agent': 'Your Name your@email.edu'})
    time.sleep(0.5)                                  # respect SEC rate limit
    with urllib.request.urlopen(req, timeout=30) as r:
        zf = zipfile.ZipFile(io.BytesIO(r.read()))
    sub = pd.read_csv(zf.open([f for f in zf.namelist() if 'FORMDSUBMISSION' in f][0]),
                      sep='\t', dtype=str)
    off = pd.read_csv(zf.open([f for f in zf.namelist() if 'OFFERING' in f][0]),
                      sep='\t', dtype=str)
    return sub.merge(off, on='ACCESSIONNUMBER', how='left')   # dedup to ACCESSIONNUMBER for offering grain
```

### Option B — WRDS `wrds_forms` index + SEC EDGAR per-filing XML
```python
# accession numbers from the WRDS index, then fetch XML from SEC
sql = """SELECT accession, cik, fdate FROM wrdssec.wrds_forms
         WHERE form = 'D' AND fdate > '2020-10-02' ORDER BY fdate"""
# https://data.sec.gov/Archives/edgar/data/{cik}/{accession-nodashes}/
```

### Option C — Contact WRDS
File a data request at wrds.wharton.upenn.edu/support to refresh `wrds_vc_formd`; the underlying
EDGAR data exists, the gap is a WRDS processing lag.

## Dollar Amount Notes
- `totalamountsold` / `totalofferingamount` are stored as **strings**, not numeric.
- Some values are non-numeric (blanks, "0", text). Filter `totalamountsold ~ '^[0-9]+$'` before casting.
- Cap at `$1B` per filing for outliers from large fund offerings; values are USD (no unit conversion).
- Hedge/PE fund offerings frequently show $500M–$2B per filing (valid).

## Linking to Other Datasets
```sql
-- Form D → Compustat/CRSP via WRDS CIK link
SELECT f.primarycik, f.primaryentityname, l.gvkey
FROM wrdssec.wrds_vc_formd f
JOIN wrdssec.wciklink_gvkey l ON LPAD(f.primarycik,10,'0') = LPAD(l.cik::text,10,'0')
WHERE f.submissiontype = 'D' AND f.isamendment = 'false'
```
- **FINRA BrokerCheck:** `recipientcrdnumber` = broker-dealer FINRA CRD (~60–70% of recipient rows populated).
- **PitchBook:** `pitchbk.company.cikcode` covers CIK for ~110k companies; join on `primarycik = cikcode` (best for VC/PE-backed).

## Validated Benchmarks

WRDS `wrds_vc_formd` with `COUNT(DISTINCT accession)`, `submissiontype='D'`, `isamendment='false'`
matches SEC official counts within **0.5%** for 2011–2019:

| Year | SEC Official | WRDS (deduped) | Match | Year | SEC Official | WRDS (deduped) | Match |
|------|------|------|------|------|------|------|------|
| 2011 | 18,174 | 18,171 | 100.0% | 2016 | 23,101 | 23,101 | 100.0% |
| 2012 | 18,186 | 18,193 | 100.0% | 2017 | 24,594 | 24,591 | 100.0% |
| 2013 | 19,848 | 19,842 | 100.0% | 2018 | 27,266 | 27,150 | 99.6% |
| 2014 | 22,191 | 22,196 | 100.0% | 2019 | 27,508 | 27,357 | 99.5% |
| 2015 | 23,019 | 23,035 | 100.1% | 2020 | 28,126 | 16,638 | 59.2% (truncated) |

Source: SEC EDGAR quarterly Form D TSV files (downloaded directly for comparison).

## Common Gotchas
1. **Two sources, one cutoff** — WRDS `wrds_vc_formd` ends Oct 2020; for later data use SEC EDGAR TSV (source 2).
2. **`issuer_cik` is NOT an SEC CIK** — it's a FINRA CRD number. Use `primarycik` for EDGAR linking.
3. **Row explosion** — denormalized across co-issuer × recipient × state. Always `COUNT(DISTINCT accession)` / `DISTINCT ON (accession)`; `df.duplicated()` on raw rows is meaningless here.
4. **`totalofferingamount`/`totalamountsold` are varchar** — may contain "Indefinite"/text. Cast carefully.
5. **No real filing-date field in `wrds_vc_formd`** — only `first_sale_date` (junk values) and `signaturedate` (varchar). For filing dates join `wrds_forms.fdate`.
6. **Amendments** — `submissiontype='D/A'` / `isamendment='true'`; link via `previousaccessionnumber` (WRDS) or `FILE_NUM` (SEC TSV). Filter to new filings for offering counts, or supersede to latest for current state.
7. **Multiple exemptions per filing** — one filing can claim several (e.g. 506(b) AND 3(c)(7)). Use `SELECT DISTINCT exempt_item WHERE accession = X`.
8. **`04`/`04.3` ambiguity** — verify against the SEC Form D federal-exemption item list (see Exemption Type Codes caveat).
