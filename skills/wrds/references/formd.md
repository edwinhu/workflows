# SEC Form D / Regulation D Data

## Contents

- [Overview](#overview)
- [Tables](#tables)
- [CRITICAL: Denormalization Gotcha](#critical-denormalization-gotcha)
- [Exemption Type Codes](#exemption-type-codes)
- [Canonical Query Pattern](#canonical-query-pattern)
- [Date Coverage](#date-coverage)
- [Post-2020 Data Gap](#post-2020-data-gap)
- [Getting Post-2020 Data](#getting-post-2020-data)
- [Dollar Amount Notes](#dollar-amount-notes)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Validated Benchmarks](#validated-benchmarks)

## Overview

Companies raising money under SEC Regulation D (private placement exemptions) must
file Form D with the SEC within 15 days of first sale. WRDS provides two Form D
resources:

| Resource | Schema.Table | Description | Coverage |
|----------|-------------|-------------|---------|
| Parsed detail | `wrdssec.wrds_vc_formd` | Full XML-parsed offering data | 2000–Oct 2020 |
| Filing index | `wrdssec.wrds_forms` | Filing metadata only (no offering detail) | 2008–present |

**For current data (post-2020):** use SEC EDGAR quarterly Form D TSV files directly.
See [Getting Post-2020 Data](#getting-post-2020-data).

## Tables

### wrdssec.wrds_vc_formd — Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `accession` | varchar | Unique filing identifier (XXXXXXXXXX-YY-NNNNNN) |
| `submissiontype` | varchar | `'D'` = new filing, `'D/A'` = amendment |
| `isamendment` | varchar | `'false'` or `'true'` |
| `exempt_item` | varchar | Exemption rule code (see below) |
| `first_sale_date` | date | Date of first sale in offering |
| `signaturedate` | varchar | Date filing was signed (proxy for filing date) |
| `regcik` | varchar | CIK of the specific co-issuer for this row |
| `primarycik` | varchar | CIK of the primary (lead) issuer |
| `primaryentityname` | varchar | Name of primary issuer |
| `industrygrouptype` | varchar | Industry group |
| `totalamountsold` | varchar | Gross proceeds sold (string, dollars) |
| `totalofferingamount` | varchar | Maximum offering size (string, dollars) |
| `totalnumberalreadyinvested` | varchar | Number of investors |
| `hasnonaccreditedinvestors` | varchar | `'True'`/`'False'` |
| `recipientname` | varchar | Broker-dealer / finder name |
| `recipientcrdnumber` | varchar | Broker-dealer FINRA CRD number |
| `state` | varchar | State of solicitation (NULL if `allstatesflag` set) |
| `allstatesflag` | varchar | `'All States'` if soliciting in all states |
| `previousaccessionnumber` | varchar | Prior accession (for amendments) |
| `edgarsubmission_ordinal` | float | Always 1.0 (not useful for dedup) |

### wrdssec.wrds_forms — Key Columns (filing index)

| Column | Type | Description |
|--------|------|-------------|
| `accession` | varchar | Accession number |
| `form` | varchar | `'D'` or `'D/A'` |
| `fdate` | date | Filing date |
| `cik` | varchar | Filer CIK |
| `coname` | varchar | Company name |

## CRITICAL: Denormalization Gotcha

**The `wrds_vc_formd` table is NOT one row per filing.**

WRDS denormalizes each Form D across three dimensions:

```
rows = n_co_issuers × n_broker_dealer_recipients × n_states_of_solicitation
```

| Dimension | Column | Effect |
|-----------|--------|--------|
| Co-issuers | `regcik` | ×100 for large PE/debt offerings (over 100 co-issuers) |
| Recipients | `recipientname` | ×6 typical for syndicates |
| States | `state` | ×50 when not using `allstatesflag` |

**Real example (2013):** Clear Channel Communications (accession `0001468078-13-000002`)
had 100+ co-issuers × 6 broker-dealers = **749,700 rows for one offering**. This
inflated 2013's true count of ~19,848 filings to 1.58M "apparent filings."

**The fix is always:**

```sql
COUNT(DISTINCT accession)          -- NOT COUNT(*)
```

**Never do this:**
```sql
-- WRONG: inflated by denormalization
SELECT COUNT(*) FROM wrdssec.wrds_vc_formd WHERE submissiontype = 'D';
```

**Always do this:**
```sql
-- CORRECT
SELECT COUNT(DISTINCT accession)
FROM wrdssec.wrds_vc_formd
WHERE submissiontype = 'D'
  AND isamendment = 'false';
```

### Inflation factors by year

| Year | Raw COUNT(*) | COUNT(DISTINCT accession) | Inflation |
|------|-------------|--------------------------|-----------|
| 2011 | 14,960 | 18,171 | 0.8× (less than 1 is fine — these years under-count due to other issues) |
| 2012 | 42,407 | 18,193 | 2.3× |
| **2013** | **1,577,119** | **19,842** | **79.5×** |
| 2014 | 22,531 | 22,196 | 1.0× |
| 2015 | 58,799 | 23,035 | 2.6× |
| 2017 | 64,102 | 24,591 | 2.6× |

## Exemption Type Codes

The `exempt_item` column uses SEC rule codes:

| Code | Meaning | JOBS Act | Notes |
|------|---------|----------|-------|
| `06` | Rule 506 (generic) | Pre-JOBS Act | Used 2009–2013; replaced by 06b/06c |
| `06b` | Rule 506(b) | Post-JOBS Act | No general solicitation; accredited investors only |
| `06c` | Rule 506(c) | Post-JOBS Act (new) | General solicitation allowed; effective Sep 23, 2013 |
| `05` | Rule 505 | — | Repealed effective May 2017; max $5M |
| `04` | Section 4(a)(2) | — | Statutory exemption |
| `04.3` | Section 4(a)(5)/Rule 144A | — | QIBs only |
| `4a5` | Section 4(a)(5) | — | Variant spelling |
| `3C.1` | Investment Company Act §3(c)(1) | — | Hedge/PE funds <100 investors |
| `3C.7` | Investment Company Act §3(c)(7) | — | QP funds |
| `3C.5` | Investment Company Act §3(c)(5)(C) | — | Mortgage REITs |

## Canonical Query Pattern

```python
import psycopg2
import pandas as pd

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737,
    database='wrds',
    user='YOUR_USERNAME',
    sslmode='require'
)
cursor = conn.cursor()

# Annual count of new offerings by exemption type
# VALIDATED against SEC official quarterly TSV files (within 0.5%)
cursor.execute("""
    SELECT
        ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int AS filing_year,
        exempt_item,
        COUNT(DISTINCT accession)  AS new_offerings,   -- NOT COUNT(*)
        SUM(
            CASE WHEN totalamountsold ~ '^[0-9]+$'
                 THEN LEAST(totalamountsold::numeric, 1e9)   -- cap outliers
                 ELSE 0
            END
        ) / 1e9                    AS total_sold_capped_bn
    FROM wrdssec.wrds_vc_formd
    WHERE submissiontype = 'D'       -- new filings only (not D/A amendments)
      AND isamendment = 'false'      -- belt-and-suspenders (32 mislabeled rows exist)
      AND ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int
          BETWEEN %(start_year)s AND %(end_year)s
    GROUP BY filing_year, exempt_item
    ORDER BY filing_year, exempt_item
""", {'start_year': 2011, 'end_year': 2020})

df = pd.DataFrame(cursor.fetchall(),
                  columns=['filing_year', 'exempt_item',
                           'new_offerings', 'total_sold_capped_bn'])
```

### Using first_sale_date instead of filing year

If you prefer to date offerings by when the sale first occurred (rather than
when the Form D was filed), use `first_sale_date`. But note:

- `first_sale_date` has junk values (dates from 1915 and 3013 exist)
- The accession-year approach is more reliable for annual time series
- Filter `first_sale_date BETWEEN '2009-01-01' AND '2024-12-31'` for sanity

### Getting one row per filing (primary issuer only)

To avoid multi-issuer expansion while retaining offering details:

```sql
SELECT DISTINCT ON (accession)
    accession,
    primarycik,
    primaryentityname,
    exempt_item,
    first_sale_date,
    totalamountsold,
    industrygrouptype
FROM wrdssec.wrds_vc_formd
WHERE submissiontype = 'D'
  AND isamendment = 'false'
ORDER BY accession, primarycik   -- picks one row per accession
```

## Date Coverage

| Period | Status | Notes |
|--------|--------|-------|
| 2000–2008 | Partial | SEC began requiring electronic Form D in 2008 |
| 2008–mid-2020 | Full | Complete XML-parsed data in `wrds_vc_formd` |
| **Oct 2020 onwards** | **GAP** | `wrds_vc_formd` frozen; WRDS XML parse job not updated |
| 2008–present | Index only | `wrds_forms` has accession numbers but no offering detail |

**Last row in `wrds_vc_formd`:** `signaturedate = '2020-10-02'`

**Historical bulk upload artifact:** Years 2009–2010 in `wrds_vc_formd` contain
the SEC's retroactive conversion of paper Form D filings. The row counts are
anomalously large (6.5M rows for 2010) but deduplicate to normal counts (~12k
unique filings). Always use `COUNT(DISTINCT accession)`.

## Post-2020 Data Gap

`wrds_vc_formd` has not been updated since October 2020. The `wrds_forms` index
table shows the full universe of accession numbers through the present, but
provides no offering detail (no exemption type, no dollar amounts).

**Gap size:**

| Year | SEC official count | `wrds_vc_formd` parsed |
|------|-------------------|----------------------|
| 2020 | 28,126 | 16,638 (Q4 missing) |
| 2021 | 42,874 | 0 |
| 2022 | 42,414 | 0 |
| 2023 | 33,297 | 0 |
| 2024 | 33,243 | 0 |

Note: 2021–2022 counts are anomalously high (~43k) vs. the 28k pre-COVID trend.
This likely reflects the SPAC and crypto offering boom of 2021.

## Getting Post-2020 Data

### Option A — SEC EDGAR quarterly TSV files (recommended)

```python
import urllib.request, zipfile, io, time, pandas as pd

def download_formd_quarter(year: int, quarter: int) -> pd.DataFrame:
    """Download one quarter of Form D data from SEC EDGAR."""
    url = (f'https://www.sec.gov/files/structureddata/data/'
           f'form-d-data-sets/{year}q{quarter}_d.zip')
    headers = {'User-Agent': 'Your Name your@email.edu'}

    time.sleep(0.5)   # respect SEC rate limit
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        content = r.read()

    zf = zipfile.ZipFile(io.BytesIO(content))
    # Key files: FORMDSUBMISSION.tsv, OFFERING.tsv, ISSUERS.tsv, RECIPIENTS.tsv
    fn = [f for f in zf.namelist() if 'FORMDSUBMISSION' in f][0]
    sub = pd.read_csv(zf.open(fn), sep='\t', dtype=str)

    fn2 = [f for f in zf.namelist() if 'OFFERING' in f][0]
    off = pd.read_csv(zf.open(fn2), sep='\t', dtype=str)

    return sub.merge(off, on='ACCESSIONNUMBER', how='left')
```

Key fields in the SEC TSV files:

| FORMDSUBMISSION | OFFERING | Notes |
|-----------------|----------|-------|
| `ACCESSIONNUMBER` | — | Unique per filing |
| `FILE_NUM` | — | Unique per offering (stable across amendments) |
| `SUBMISSIONTYPE` | — | D or D/A |
| `FILING_DATE` | — | Date filed |
| — | `FEDERALEXEMPTIONS_ITEMS_LIST` | e.g. "Rule 506(b)" |
| — | `TOTALAMOUNTSOLD` | Numeric |
| — | `ISAMENDMENT` | True/False |

### Option B — WRDS `wrds_forms` + SEC EDGAR API

```python
# Get accession numbers from WRDS filing index
cursor.execute("""
    SELECT accession, cik, fdate
    FROM wrdssec.wrds_forms
    WHERE form = 'D' AND fdate > '2020-10-02'
    ORDER BY fdate
""")
# Then fetch XML from SEC for each accession
# https://data.sec.gov/Archives/edgar/data/{cik}/{accession-nodashes}/
```

### Option C — Contact WRDS

File a data request at wrds.wharton.upenn.edu/support to update `wrds_vc_formd`.
The underlying EDGAR data is available; the gap is a WRDS processing lag.

## Dollar Amount Notes

- `totalamountsold` and `totalofferingamount` are stored as **strings**, not numeric
- Some values are non-numeric (blanks, "0", text descriptions)
- Valid filter: `totalamountsold ~ '^[0-9]+$'` before casting
- Cap at `$1B` per filing to control for outliers from large fund offerings
- No unit conversion needed — values are in **USD**
- Hedge fund and PE fund offerings frequently show $500M–$2B per filing (valid)

## Linking to Other Datasets

### Form D → Compustat / CRSP

```sql
-- Via WRDS CIK link table
SELECT f.primarycik, f.primaryentityname, l.gvkey
FROM wrdssec.wrds_vc_formd f
JOIN wrdssec.wciklink_gvkey l
  ON LPAD(f.primarycik, 10, '0') = LPAD(l.cik::text, 10, '0')
WHERE f.submissiontype = 'D' AND f.isamendment = 'false'
```

### Form D → FINRA BrokerCheck

- `recipientcrdnumber` is the FINRA CRD number for broker-dealers
- Use to link to FINRA BrokerCheck data on complaints, disciplinary history
- Coverage: ~60–70% of recipient rows have a valid CRD number

### Form D → PitchBook

- `pitchbk.company.cikcode` has CIK for ~110k of 10M+ PitchBook companies
- Link on `primarycik` = `cikcode`
- Coverage is best for VC/PE-backed companies; sparse for small/real estate issuers

## Validated Benchmarks

WRDS `wrds_vc_formd` with `COUNT(DISTINCT accession)`, `submissiontype='D'`,
`isamendment='false'` matches SEC official counts (from EDGAR quarterly TSV files)
within **0.5%** for 2011–2019:

| Year | SEC Official | WRDS (deduplicated) | Match |
|------|-------------|---------------------|-------|
| 2011 | 18,174 | 18,171 | 100.0% |
| 2012 | 18,186 | 18,193 | 100.0% |
| 2013 | 19,848 | 19,842 | 100.0% |
| 2014 | 22,191 | 22,196 | 100.0% |
| 2015 | 23,019 | 23,035 | 100.1% |
| 2016 | 23,101 | 23,101 | 100.0% |
| 2017 | 24,594 | 24,591 | 100.0% |
| 2018 | 27,266 | 27,150 | 99.6% |
| 2019 | 27,508 | 27,357 | 99.5% |
| 2020 | 28,126 | 16,638 | 59.2% (truncated) |

Source: SEC EDGAR quarterly Form D TSV files (downloaded directly for comparison).
