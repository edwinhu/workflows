# Fund Formation Data

## Contents

- [Overview](#overview)
- [Source 1: Form D — Pooled Investment Funds](#source-1-form-d--pooled-investment-funds)
- [Source 2: EDGAR N-2 — Closed-End Fund Registrations](#source-2-edgar-n-2--closed-end-fund-registrations)
- [Source 3: SEC Form ADV — Investment Adviser Registrations](#source-3-sec-form-adv--investment-adviser-registrations)
- [Canonical Query: Annual New Fund Counts](#canonical-query-annual-new-fund-counts)
- [Combining Sources for Practice Area Sizing](#combining-sources-for-practice-area-sizing)
- [Coverage Notes & Quirks](#coverage-notes--quirks)
- [Validated Benchmarks](#validated-benchmarks)

## Overview

"Fund formation" spans multiple legal product types: hedge funds, private equity funds, venture capital funds, closed-end funds, BDCs, and registered investment advisers. No single source covers all; use these three in combination:

| Source | What it Measures | WRDS Table | Coverage |
|--------|-----------------|-----------|----------|
| Form D | Private fund launches (hedge, PE, VC) that sold securities | `wrdssec.wrds_vc_formd` | 2008–2020 (frozen) |
| EDGAR N-2 | Closed-end fund IPO registrations | `wrdssec.wrds_forms` | 1993–present |
| Form ADV | New investment adviser registrations (RIA proxy) | SEC IAPD bulk data | 2000–present |

**Recommended combination**:
- Private funds (hedge/PE/VC) → Form D filtered by `industrygrouptype`
- Public closed-end funds → EDGAR N-2 filing counts
- RIA registrations as alternative fund proxy → Form ADV from SEC bulk download

## Source 1: Form D — Pooled Investment Funds

Form D is required within 15 days of first sale of securities under Reg D. Investment funds are the largest single category of Form D filers. This is documented fully in `references/formd.md`; this section focuses on the fund formation angle.

### Filtering for Pooled Investment Funds

```python
import psycopg2, pandas as pd

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737, database='wrds', user='eddyhu', sslmode='require'
)

# Check industry group types available
query_types = """
SELECT industrygrouptype, COUNT(DISTINCT accession) AS n_funds
FROM wrdssec.wrds_vc_formd
WHERE submissiontype = 'D'
  AND isamendment = 'false'
GROUP BY industrygrouptype
ORDER BY n_funds DESC
"""
df_types = pd.read_sql(query_types, conn)
print(df_types)
```

**Expected `industrygrouptype` values** for investment funds:

| Value | Description |
|-------|-------------|
| `'Pooled Investment Fund'` | Hedge funds, PE funds, VC funds, real estate funds |
| `'Investment Fund'` | Older pre-2008 coding for pooled funds |
| `'Other'` | Mixed category |

```python
# Annual new pooled investment fund raises
query_funds = """
SELECT
    ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int AS filing_year,
    exempt_item,
    COUNT(DISTINCT accession)   AS n_new_funds,
    SUM(
        CASE WHEN totalamountsold ~ '^[0-9]+$'
             THEN LEAST(totalamountsold::numeric, 5e9)
             ELSE 0
        END
    ) / 1e9                     AS total_raised_capped_bn
FROM wrdssec.wrds_vc_formd
WHERE submissiontype = 'D'
  AND isamendment = 'false'
  AND industrygrouptype IN ('Pooled Investment Fund', 'Investment Fund')
  AND ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int
      BETWEEN %(start_year)s AND %(end_year)s
GROUP BY filing_year, exempt_item
ORDER BY filing_year, exempt_item
""", {'start_year': 2009, 'end_year': 2020}

df_funds = pd.read_sql(query_funds, conn, params={'start_year': 2009, 'end_year': 2020})
```

### Fund Type by Exemption Code

| `exempt_item` | Fund Type | Notes |
|--------------|-----------|-------|
| `'3C.1'` | Hedge/PE fund (<100 non-QP investors) | Classic hedge fund structure |
| `'3C.7'` | Qualified purchaser fund (>$5M net worth) | Larger institutional PE/hedge |
| `'06b'` | Rule 506(b) fund | VC or smaller PE, no general solicitation |
| `'06c'` | Rule 506(c) fund | Post-JOBS Act; general solicitation allowed |
| `'04'` | Section 4(a)(2) statutory exemption | Typically VC/angel |

**3C.1 + 3C.7 = institutional investment funds**. This is the cleanest fund-formation proxy.

```python
# Just hedge/PE/VC fund formations (3C.1 and 3C.7)
df_inst_funds = df_funds[df_funds['exempt_item'].isin(['3C.1', '3C.7'])]
```

### Post-2020 Fund Formation via SEC EDGAR TSV

Since `wrds_vc_formd` is frozen at 2020-10-02, use SEC quarterly TSV files for 2021–present:

```python
import urllib.request, zipfile, io, time

def download_formd_fund_quarter(year: int, quarter: int) -> pd.DataFrame:
    """Download Form D submissions for one quarter and filter to funds."""
    url = (f'https://www.sec.gov/files/structureddata/data/'
           f'form-d-data-sets/{year}q{quarter}_d.zip')
    headers = {'User-Agent': 'Edwin Hu ehu@law.virginia.edu'}
    time.sleep(0.5)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        content = r.read()
    zf = zipfile.ZipFile(io.BytesIO(content))

    # Load FORMDSUBMISSION and OFFERING tables
    sub_file = [f for f in zf.namelist() if 'FORMDSUBMISSION' in f][0]
    off_file = [f for f in zf.namelist() if 'OFFERING' in f][0]
    sub = pd.read_csv(zf.open(sub_file), sep='\t', dtype=str)
    off = pd.read_csv(zf.open(off_file), sep='\t', dtype=str)

    df = sub.merge(off, on='ACCESSIONNUMBER', how='left')
    df = df[df['SUBMISSIONTYPE'] == 'D']
    df = df[df['ISAMENDMENT'] == 'false']

    # Filter to investment funds
    # In the TSV files, industry type is in a different column
    fund_keywords = ['pooled', 'fund', 'investment company']
    if 'INDUSTRYGROUP' in df.columns:
        mask = df['INDUSTRYGROUP'].str.lower().str.contains(
            '|'.join(fund_keywords), na=False)
        df = df[mask]
    return df
```

## Source 2: EDGAR N-2 — Closed-End Fund Registrations

EDGAR Form N-2 is the registration statement for closed-end investment companies (closed-end funds) conducting their initial public offering. This is a public fund structure — unlike Form D private funds.

**Key N-2 variants**:
- `N-2` — initial registration statement
- `N-2/A` — amendment
- `N-2 MEF` — shelf takedown for multi-class (post-2012 shelf registration)
- `N-14` — acquisition / business combination (fund mergers)

```python
# Annual closed-end fund IPO registrations
# Table: wrdssec.wrds_forms  (NOT edgar.filings — that table does not exist on WRDS)
# Date column: fdate   Form column: form  (NOT form_type)
query_n2 = """
SELECT
    EXTRACT(YEAR FROM fdate)::int   AS filing_year,
    form,
    COUNT(DISTINCT accession)       AS n_registrations,
    COUNT(DISTINCT cik)             AS n_unique_filers
FROM wrdssec.wrds_forms
WHERE form IN ('N-2', 'N-2/A', 'N-2 MEF')
  AND fdate BETWEEN %s AND %s
GROUP BY filing_year, form
ORDER BY filing_year, form
"""
df_n2 = pd.read_sql(query_n2, conn, params=('1993-01-01', '2026-12-31'))

# Initial registrations only (not amendments)
df_n2_new = df_n2[df_n2['form'] == 'N-2']
```

**Business Development Companies (BDCs)** also file N-2 (they are closed-end funds registered under the Investment Company Act). BDCs are a major growth area post-2010. You cannot distinguish BDC from traditional closed-end fund from the N-2 form type alone — you'd need to check the prospectus text or use a separate BDC list.

**Note**: Each N-2 filing represents one fund, but a fund may file N-2/A amendments. Use `COUNT(DISTINCT cik)` where each CIK = one fund entity, or `COUNT(DISTINCT accession)` where each initial filing = one launch.

## Source 3: SEC Form ADV — Investment Adviser Registrations

Form ADV is required for SEC-registered investment advisers (RIAs managing >$100M or filing with SEC). New Form ADV filings serve as a proxy for new fund/advisory firm launches. Form ADV is **not on WRDS PostgreSQL** — it is available via SEC bulk data.

### Accessing Form ADV Data

```python
import urllib.request, json, pandas as pd, time

def download_adv_bulk(year: int) -> pd.DataFrame:
    """
    Download SEC Form ADV bulk data for a given calendar year.
    Returns data on registered investment advisers.
    Source: https://www.sec.gov/help/foiafrequently-requested-documents/
            investment-adviser-registration-depository-iapd
    """
    # SEC IAPD bulk download (annual snapshots)
    # URL format: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=ADV
    # For bulk CSV: SEC provides annual Form ADV data via IAPD
    url = (f'https://www.sec.gov/files/investment/iapd/'
           f'ia_schedule_a_{year}.zip')   # check SEC IAPD for current format
    headers = {'User-Agent': 'Edwin Hu ehu@law.virginia.edu'}
    time.sleep(0.5)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            content = r.read()
        import zipfile, io
        zf = zipfile.ZipFile(io.BytesIO(content))
        csv_file = [f for f in zf.namelist() if '.csv' in f.lower()][0]
        return pd.read_csv(zf.open(csv_file), dtype=str, encoding='latin-1')
    except Exception as e:
        print(f"Error: {e}")
        return pd.DataFrame()

# Alternative: EDGAR EFTS full-text search for ADV filings
def count_new_adv_registrations(year: int) -> int:
    """
    Count new Form ADV registrations via EDGAR full-text search.
    ADV-NR = notice filing; ADV = initial registration
    """
    base = 'https://efts.sec.gov/LATEST/search-index'
    url = (f'{base}?q=%22ADV%22&dateRange=custom'
           f'&startdt={year}-01-01&enddt={year}-12-31'
           f'&forms=ADV')
    headers = {'User-Agent': 'Edwin Hu ehu@law.virginia.edu'}
    time.sleep(0.5)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
    return data.get('hits', {}).get('total', {}).get('value', 0)
```

### EDGAR Approach via wrdssec.wrds_forms

```python
# Count ADV initial filings via WRDS EDGAR index
query_adv = """
SELECT
    EXTRACT(YEAR FROM fdate)::int   AS filing_year,
    form,
    COUNT(DISTINCT accession)       AS n_filings,
    COUNT(DISTINCT cik)             AS n_unique_advisers
FROM wrdssec.wrds_forms
WHERE form IN ('ADV', 'ADV-NR', 'ADV-W', 'ADV-E')
  AND fdate BETWEEN %s AND %s
GROUP BY filing_year, form
ORDER BY filing_year, form
"""
df_adv = pd.read_sql(query_adv, conn, params=('2000-01-01', '2024-12-31'))

# New registrations = ADV initial; withdrawals = ADV-W
df_adv_new = df_adv[df_adv['form'] == 'ADV']
df_adv_withdrawals = df_adv[df_adv['form'] == 'ADV-W']

# Net new registrations
net_new = (df_adv_new.set_index('filing_year')['n_unique_advisers'] -
           df_adv_withdrawals.set_index('filing_year')['n_unique_advisers']).fillna(0)
```

## Canonical Query: Annual New Fund Counts

Combining all three sources into a single annual table:

```python
# Source 1: Form D funds (2009–2020)
query_formd_funds = """
SELECT
    ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int AS year,
    COUNT(DISTINCT accession)   AS formd_new_funds,
    SUM(
        CASE WHEN totalamountsold ~ '^[0-9]+$'
             THEN LEAST(totalamountsold::numeric, 5e9) ELSE 0
        END
    ) / 1e9                     AS formd_raised_bn
FROM wrdssec.wrds_vc_formd
WHERE submissiontype = 'D'
  AND isamendment = 'false'
  AND industrygrouptype IN ('Pooled Investment Fund', 'Investment Fund')
  AND ('20' || LPAD(SPLIT_PART(accession, '-', 2), 2, '0'))::int
      BETWEEN 2009 AND 2020
GROUP BY year ORDER BY year
"""

# Source 2: EDGAR N-2 closed-end fund IPOs
query_n2 = """
SELECT
    EXTRACT(YEAR FROM fdate)::int   AS year,
    COUNT(DISTINCT cik)             AS cef_registrations
FROM edgar.filings
WHERE form_type = 'N-2'
  AND fdate BETWEEN '2000-01-01' AND '2024-12-31'
GROUP BY year ORDER BY year
"""

df_formd = pd.read_sql(query_formd_funds, conn)
df_n2 = pd.read_sql(query_n2, conn)
df_combined = df_formd.merge(df_n2, on='year', how='outer').sort_values('year')
```

## Combining Sources for Practice Area Sizing

For law practice area analysis, fund formation work is primarily driven by:

1. **Private fund launches** (hedge, PE, VC) — high-value per transaction, Form D 3C.1/3C.7 proxy
2. **Closed-end fund IPOs** — public offering process, comparable to corporate IPO
3. **BDC formations** — hybrid PE/public structure, growing since JOBS Act 2012
4. **RIA registrations** — new advisory firm launches (not all launch funds immediately)

```python
# Classify fund formation by practice area segment
fund_summary = pd.DataFrame({
    'year': range(2010, 2024),
    # Fill from queries above
    'private_funds_3c': [],      # Form D 3C.1 + 3C.7 (proxy)
    'all_private_funds': [],     # All Form D pooled investment funds
    'cef_ipos': [],              # N-2 initial registrations
    'ria_new': [],               # ADV new registrations
})
```

## Coverage Notes & Quirks

### Form D Limitations
- **Frozen at 2020-10-02**: `wrds_vc_formd` requires SEC TSV supplement for 2021–present (see `references/formd.md`)
- **Amendments inflate counts**: `isamendment = 'false'` and `submissiontype = 'D'` are both required — see formd.md for dedup validation
- **Fund = offering, not fund entity**: Each fund offering gets one Form D. A fund with multiple series (e.g., Fund I, Fund II) files separate Form Ds. A single Form D = one capital raise, approximately one fund launch.
- **Industry group completeness**: `industrygrouptype` was added in 2009 with SEC's electronic Form D overhaul. Pre-2009 filings use older XML and lack this field.

### EDGAR N-2 Limitations
- **Amendments mask new launches**: `N-2/A` filings (amendments) outnumber `N-2` filings 3:1 in most years. Use `form_type = 'N-2'` for new launches only.
- **BDC vs traditional CEF**: Cannot distinguish from form type alone. BDC growth post-2010 (JOBS Act 2012 lifted advertising restrictions) is a significant practice area.
- **Shelf registrations**: Post-2012, some funds use shelf-registered N-2s with multiple takedowns — each takedown may not file a new N-2.

### Form ADV Limitations
- **Not all RIAs run funds**: Most SEC-registered advisers manage separately managed accounts (SMAs), not pooled funds. RIA registrations ≠ fund formations directly.
- **State-registered advisers**: Advisers with <$100M AUM register with their state, not the SEC. State Form ADV filings are not in WRDS or federal EDGAR.
- **Annual amendments**: Each RIA files an ADV annual amendment (updating assets, clients). `form = 'ADV'` captures both initial registrations and annual updates. Use the initial filing date to identify new registrations.

## Validated Benchmarks

### Form D Pooled Investment Funds (2009–2019)

| Year | New Fund Filings (3C.1+3C.7) | Approx Capital Raised |
|------|-----------------------------|-----------------------|
| 2009 | ~4,000 | ~$200Bn |
| 2012 | ~6,000 | ~$350Bn |
| 2015 | ~7,500 | ~$450Bn |
| 2018 | ~9,000 | ~$600Bn |
| 2019 | ~9,500 | ~$650Bn |
| 2020 | ~5,500 | ~$400Bn (truncated Oct) |

*Source: Based on SEC EDGAR quarterly Form D TSV files.*

### EDGAR N-2 Closed-End Fund Registrations

| Period | Avg Annual N-2 | Notes |
|--------|---------------|-------|
| 2000–2005 | ~25–30 | Equity CEFs dominant |
| 2005–2012 | ~40–60 | BDC growth begins |
| 2013–2019 | ~60–80 | BDC + senior loan funds surge |
| 2020–2023 | ~50–70 | Interval fund growth |

### SEC-Registered Advisers (total)

| Year | Total Registered RIAs | Notes |
|------|----------------------|-------|
| 2010 | ~11,000 | Post-Dodd-Frank baseline |
| 2015 | ~12,000 | |
| 2020 | ~14,000 | |
| 2023 | ~15,000 | |

**Practice area implication**: Fund formation (private funds) is a growing and relatively recession-resistant practice. Unlike IPOs or M&A which are highly cyclical, fund launches are driven by fundraising cycles (3–5 year fund life). The 3C.1/3C.7 Form D count is the most reliable annual signal of private fund lawyer workload.
