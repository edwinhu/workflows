# SDC Mergers & Acquisitions

## Contents

- [Overview](#overview)
- [Discovering the Schema](#discovering-the-schema)
- [Tables](#tables)
- [Key Columns](#key-columns)
- [Deal Status Codes](#deal-status-codes)
- [Form of Transaction Codes](#form-of-transaction-codes)
- [PE/LBO Identification](#pelbo-identification)
- [Acquiror & Target Public/Private Flags](#acquiror--target-publicprivate-flags)
- [Standard Cleaning Filters](#standard-cleaning-filters)
- [Canonical Query Patterns](#canonical-query-patterns)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Coverage Notes & Quirks](#coverage-notes--quirks)
- [Validated Benchmarks](#validated-benchmarks)

## Overview

WRDS hosts the SDC M&A database (LSEG Deals, formerly Refinitiv/Thomson SDC), covering **1.2M+ announced M&A transactions** globally from 1976 to present. The desktop SDC Platinum was retired December 2023; all access is now via WRDS PostgreSQL.

Key use cases:
- Annual deal count and dollar volume by year (completed US M&A)
- PE/LBO vs strategic buyer split over time
- Public vs private target analysis
- Cross-border deal trends

## Discovering the Schema

```python
import psycopg2, pandas as pd

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737, database='wrds', user='eddyhu', sslmode='require'
)
cur = conn.cursor()

# Find SDC-related schemas
cur.execute("""
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name ILIKE '%sdc%'
       OR schema_name ILIKE '%tdc%'
       OR schema_name ILIKE '%deals%'
    ORDER BY schema_name
""")
print("SDC schemas:", cur.fetchall())

# Find M&A table within discovered schema
SCHEMA = 'tdc1'  # replace with actual schema from above
cur.execute("""
    SELECT table_name,
           pg_size_pretty(pg_total_relation_size(
               quote_ident(%s)||'.'||quote_ident(table_name))) AS size
    FROM information_schema.tables
    WHERE table_schema = %s
    ORDER BY table_name
""", (SCHEMA, SCHEMA))
for row in cur.fetchall(): print(row)

# Inspect M&A table columns
cur.execute("""
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = %s AND table_name ILIKE '%ma%'
    ORDER BY ordinal_position
""", (SCHEMA,))
for col in cur.fetchall(): print(col)
```

**Expected schema**: `tdc1` or `sdc`. **Expected M&A table**: `sdc_ma` or `ma`.

## Tables

| Table | Description |
|-------|-------------|
| `{schema}.sdc_ma` | M&A transactions: all announcements |
| `{schema}.sdc_ni` | New issues (see `sdc-issuances.md`) |
| `{schema}.sdc_jv` | Joint ventures and alliances |

## Key Columns

SDC M&A columns (PostgreSQL column names are lowercase versions of SDC field codes):

| SDC Code | PostgreSQL Col | Type | Description |
|----------|---------------|------|-------------|
| `DEAL_NO` | `deal_no` | varchar | Unique deal identifier |
| `DA` | `date_announced` | date | Public announcement date |
| `DE` | `date_effective` | date | Deal completion / effective date |
| `DW` | `date_withdrawn` | date | Withdrawal date (if deal fell through) |
| `STAT` | `status` | varchar | Deal status code (see below) |
| `AN` | `acquiror_name` | varchar | Acquiror company name |
| `TN` | `target_name` | varchar | Target company name |
| `ANATION` | `acquiror_nation` | varchar | Acquiror country |
| `TNATION` | `target_nation` | varchar | Target country |
| `ASIC` | `acquiror_sic` | varchar | Acquiror SIC code |
| `TSIC` | `target_sic` | varchar | Target SIC code |
| `APUB` | `acquiror_public` | varchar | Acquiror public/private flag |
| `TPUB` | `target_public` | varchar | Target public/private flag |
| `TV` | `deal_value` | numeric | Transaction value ($M) |
| `FORM` | `form_of_transaction` | varchar | Deal structure (see below) |
| `CONS` | `consideration_paid` | varchar | Payment form (cash, stock, mixed) |
| `PCT_ACQRD` | `pct_acquired` | numeric | Percent of target acquired |
| `PCT_OWNED` | `pct_owned_after` | numeric | Percent owned after transaction |
| `LBO` | `lbo` | varchar | LBO flag: `'Yes'` if leveraged buyout |
| `ACQTYPE` | `acquiror_type` | varchar | Acquiror type codes (see PE section) |
| `FRIENDLY` | `attitude` | varchar | `'Friendly'`/`'Hostile'`/`'Unsolicited'` |
| `PREMIUM` | `premium_4wk` | numeric | 4-week premium over market price (%) |
| `NASDAQ` | `target_exchange` | varchar | Target stock exchange |
| `ACV` | `acqr_cusip` | varchar | Acquiror CUSIP |
| `TCV` | `target_cusip` | varchar | Target CUSIP |
| — | `acqr_sic` | varchar | Acquiror 4-digit SIC |
| — | `target_sic` | varchar | Target 4-digit SIC |
| — | `mgr_codes` | varchar | Advisor codes (financial advisor names) |

## Deal Status Codes

| Code | Meaning | Use in Analysis |
|------|---------|----------------|
| `'C'` | **Completed** | Primary filter for announced-and-closed deals |
| `'W'` | **Withdrawn** | Announced but terminated before closing |
| `'P'` | **Pending** | Announced, awaiting close (near real-time) |
| `'I'` | **Intended** | Informal announcement, no signed agreement |

**For deal count analysis**: filter `status = 'C'` for completed transactions. Use `date_effective` for year-of-completion, `date_announced` for year-of-announcement.

```python
# Completed deals, US targets, by announcement year
df_completed = df[
    (df['status'] == 'C') &
    (df['target_nation'] == 'United States')
].copy()
df_completed['announce_year'] = pd.to_datetime(
    df_completed['date_announced']).dt.year
```

## Form of Transaction Codes

| Code | Description |
|------|-------------|
| `'Merger'` | Full statutory merger |
| `'Acq. of Majority Interest'` | >50% acquisition |
| `'Acq. of Remaining Interest'` | Buying out remaining minority |
| `'Acq. of Partial Interest'` | Partial acquisition (<50%) |
| `'Asset Acquisition'` | Purchase of specific assets |
| `'Recapitalization'` | Change in capital structure |
| `'Buyback'` | Issuer repurchase |
| `'Spin-off'` | Subsidiary divestiture to shareholders |
| `'Exchange Offer'` | Acquiror offers stock for target stock |

**For clean M&A deal counts** (full-control acquisitions):
```python
FULL_CONTROL_FORMS = {
    'Merger',
    'Acq. of Majority Interest',
    'Acq. of Remaining Interest',
    'Asset Acquisition',
}
df_full = df[df['form_of_transaction'].isin(FULL_CONTROL_FORMS)]
```

## PE/LBO Identification

Three complementary flags to identify private equity / financial sponsor transactions:

### 1. LBO Flag (direct)

```python
# SDC LBO flag — most direct but may undercount
df_lbo = df[df['lbo'] == 'Yes']

# Also check lbo_type if available
# lbo_type values: 'MBO' (management), 'LBO', 'MLBO' (management LBO)
```

### 2. Acquiror Type Codes (richer classification)

```python
# SDC acquiror_type codes — look for financial sponsor indicators
# Common PE-related codes:
PE_ACQUIROR_TYPES = {
    'PE',    # Private equity firm
    'VC',    # Venture capital
    'I',     # Investment company / fund
    'SP',    # Special purpose / SPAC
}
df_pe = df[df['acquiror_type'].isin(PE_ACQUIROR_TYPES)]

# Show all acquiror type values to validate
print(df['acquiror_type'].value_counts().head(20))
```

### 3. Acquiror Name Pattern Match (backup)

```python
# Known PE firm name patterns — use when flags are incomplete
PE_NAME_PATTERNS = [
    'equity', 'capital', 'partners', 'fund', 'advisors',
    'apollo', 'blackstone', 'carlyle', 'kkr', 'tpg', 'warburg',
    'bain capital', 'advent', 'vista', 'thoma bravo',
    'francisco partners', 'silver lake', 'cerberus',
    'ares', 'oaktree', 'bc partners', 'apax',
]
import re
pattern = '|'.join(PE_NAME_PATTERNS)
df['pe_name_match'] = df['acquiror_name'].str.lower().str.contains(
    pattern, na=False, regex=True
)
```

### Combined PE Identification

```python
df['is_pe_buyer'] = (
    (df['lbo'] == 'Yes') |
    (df['acquiror_type'].isin(PE_ACQUIROR_TYPES)) |
    df['pe_name_match']
)

# Strategic = not PE
df['is_strategic_buyer'] = ~df['is_pe_buyer']

# Annual PE vs Strategic split
pe_share = (df.groupby(['announce_year', 'is_pe_buyer'])
              .agg(n_deals=('deal_no', 'count'),
                   total_value=('deal_value', 'sum'))
              .reset_index())
```

## Acquiror & Target Public/Private Flags

| Code | Meaning |
|------|---------|
| `'P'` | Public company (listed on exchange) |
| `'V'` | Private company (unlisted) |
| `'S'` | Subsidiary of public company |
| `'J'` | Joint venture |
| `'M'` | Mutual company |
| `'G'` | Government entity |

**Public target deals** are the highest-profile (require SEC proxy/tender offer filings, shareholder vote, extensive legal work). Filter `target_public = 'P'` for public company M&A.

```python
# Public-target deals (most relevant for securities law)
df_public_target = df[
    (df['target_public'] == 'P') &
    (df['target_nation'] == 'United States') &
    (df['status'] == 'C')
]

# Private target deals (more frequent, lower dollar value)
df_private_target = df[
    (df['target_public'] == 'V') &
    (df['target_nation'] == 'United States') &
    (df['status'] == 'C')
]
```

## Standard Cleaning Filters

### Clean US M&A Deal Sample

```python
query = """
SELECT
    deal_no,
    date_announced,
    date_effective,
    date_withdrawn,
    status,
    acquiror_name,
    target_name,
    acquiror_nation,
    target_nation,
    acquiror_sic,
    target_sic,
    acquiror_public   AS apub,
    target_public     AS tpub,
    deal_value        AS tv,
    form_of_transaction,
    consideration_paid,
    pct_acquired,
    lbo,
    acquiror_type,
    attitude,
    premium_4wk,
    target_cusip
FROM {schema}.sdc_ma
WHERE target_nation = 'United States'
  AND date_announced BETWEEN %s AND %s
  AND status IN ('C', 'W')   -- completed and withdrawn (add 'P' for pending)
  AND deal_value > 0         -- has a disclosed deal value
ORDER BY date_announced
"""
df = pd.read_sql(query.format(schema=SCHEMA), conn,
                 params=('1985-01-01', '2024-12-31'))
```

### Minimal Sample (high-quality deal counts)

```python
# For clean annual counts comparable across years:
df_clean = df[
    (df['status'] == 'C') &
    (df['target_nation'] == 'United States') &
    (df['form_of_transaction'].isin(FULL_CONTROL_FORMS)) &
    (df['pct_acquired'] >= 50) &  # majority acquisition
    (df['deal_value'] >= 1)        # at least $1M disclosed value
].copy()

df_clean['year'] = pd.to_datetime(df_clean['date_announced']).dt.year
```

## Canonical Query Patterns

### Annual Deal Counts: PE vs Strategic, Public vs Private

```python
query = """
SELECT
    EXTRACT(YEAR FROM date_announced)::int AS announce_year,
    status,
    target_public,
    lbo,
    COUNT(*)                AS n_deals,
    SUM(deal_value)         AS total_value_mm,
    AVG(deal_value)         AS avg_value_mm,
    AVG(premium_4wk)        AS avg_premium_pct
FROM {schema}.sdc_ma
WHERE target_nation = 'United States'
  AND date_announced BETWEEN %s AND %s
  AND deal_value > 0
GROUP BY announce_year, status, target_public, lbo
ORDER BY announce_year, status, target_public
"""
```

## Linking to Other Datasets

### SDC M&A → Compustat (target/acquiror financials)

```python
# Match on CUSIP (target_cusip is 6-digit typically)
link_query = """
    SELECT s.gvkey, s.cusip, c.conm, c.sich
    FROM comp.security s
    JOIN comp.company c USING (gvkey)
    WHERE s.cusip = ANY(%s)
"""
# Note: SDC CUSIP may be 6- or 8-digit; strip trailing digits
target_cusips = df['target_cusip'].dropna().str[:6].tolist()
```

### SDC M&A → CRSP (target stock price history)

```python
# Get PERMNO via stocknames for price data pre/post announcement
link_query = """
    SELECT s.permno, s.ncusip, s.namedt, s.nameenddt
    FROM crsp.stocknames s
    WHERE s.ncusip = ANY(%s)
"""
```

### SDC M&A → Capital IQ Transactions

Capital IQ Transaction module (`ciq` schema) may provide supplemental deal data:
```python
ciq_query = """
    SELECT t.transactionid, t.announceddate, t.closeddate,
           t.transactionstatus, t.transactiontype,
           a.companyname AS acquiror, tgt.companyname AS target
    FROM ciq.ciqtransaction t
    JOIN ciq.ciqcompany a ON t.acquirorcompanyid = a.companyid
    JOIN ciq.ciqcompany tgt ON t.targetcompanyid = tgt.companyid
    WHERE tgt.countryid = 213  -- USA
      AND t.announceddate BETWEEN %s AND %s
"""
```

## Coverage Notes & Quirks

- **Dollar value disclosure**: Only ~50–60% of completed deals have a disclosed transaction value. Small deals (<$50M) disproportionately lack disclosure. Deal *count* is more reliable than dollar *volume* for trend analysis.
- **Restructuring transactions**: Spin-offs, recapitalizations, and buybacks inflate deal counts. Filter `form_of_transaction` carefully.
- **Date fields**: `date_announced` is more consistently populated than `date_effective`. Use announcement date for trend analysis; effective date for measuring legal timeline.
- **PE flag reliability**: The `lbo` flag is self-reported and inconsistent before ~2000. Cross-validate with `acquiror_type` and name matching for historical PE analysis.
- **Cross-border**: Filter `target_nation = 'United States'` for US deal counts. Acquiror can be foreign (inbound M&A). Filter both `target_nation` and `acquiror_nation` for domestic-only.
- **Partial acquisitions**: `pct_acquired < 50` captures minority stakes — not "M&A" in the traditional sense. Filter `pct_acquired >= 50` or `form = 'Acq. of Majority Interest'/'Merger'` for control transactions.
- **Duplicate deals**: Amended deal terms create new rows in some vintage; use `COUNT(DISTINCT deal_no)`.
- **Post-2023 migration**: Schema/column names may differ from legacy SDC Platinum after the 2023 WRDS migration. Run column discovery (see above) before assuming exact names.

## Validated Benchmarks

Approximate annual completed US M&A deal counts (all deal sizes):

| Period | Deals/Year | Dollar Volume | Notes |
|--------|-----------|---------------|-------|
| 1985–1989 | ~2,000 | ~$200Bn | LBO wave |
| 1990–1994 | ~3,000 | ~$200Bn | Post-S&L recovery |
| 1995–1999 | ~6,000 | ~$800Bn | Telecom/internet boom |
| 2000–2002 | ~4,000 | ~$400Bn | Bust |
| 2003–2007 | ~8,000 | ~$1Tn | PE boom, covenant-lite |
| 2008–2009 | ~4,000 | ~$400Bn | GFC |
| 2010–2015 | ~7,000 | ~$1Tn | Recovery |
| 2016–2019 | ~9,000 | ~$1.5Tn | Tax reform tailwind |
| 2020 | ~7,000 | ~$1Tn | COVID dip |
| 2021 | ~12,000 | ~$2.5Tn | Record: SPAC + PE boom |
| 2022–2023 | ~7,000 | ~$1.2Tn | Rate-driven slowdown |

**PE share of US M&A** (deal count): typically 15–25% of all deals; ~30–40% of announced dollar volume in active years (2006–2007, 2021).

**Public target deals**: Only ~5–8% of deal count but ~40–60% of total dollar volume. These deals require full SEC filing programs (14D/proxy) and intensive legal work.

**Practice area implication**: M&A volumes are large and relatively stable (unlike IPO/bond markets which are more cyclical). Hostile/contested deals add litigation risk. PE buyouts of public targets (take-privates) are highest-fee transactions.
