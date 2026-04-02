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
    WHERE schema_name ILIKE '%tr_sdc%'
    ORDER BY schema_name
""")
print("SDC schemas:", cur.fetchall())

# Find M&A tables within confirmed schema
SCHEMA = 'tr_sdc_ma'
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
    WHERE table_schema = %s AND table_name = 'wrds_ma_details'
    ORDER BY ordinal_position
""", (SCHEMA,))
for col in cur.fetchall(): print(col)
```

**Confirmed schema**: `tr_sdc_ma` (Thomson Reuters SDC M&A). Main table: `wrds_ma_details`.

## Tables

| Table | Description |
|-------|-------------|
| `tr_sdc_ma.wrds_ma_details` | M&A transactions: all announcements (main table) |
| `tr_sdc_ma.wrds_ma_advisors` | Financial advisor data per deal |
| `tr_sdc_ma.wrds_ma_competition` | Competing bids |
| `tr_sdc_ma.wrds_ma_events` | Deal timeline events |
| `tr_sdc_ma.wrds_ma_purpose` | Deal purpose codes (e.g., LBO strategy, expansion) |
| `tr_sdc_ma.wrds_ma_related` | Related deal cross-references |
| `tr_sdc_ni.wrds_ni_details` | New issues (see `sdc-issuances.md`) |

## Key Columns

Actual PostgreSQL column names in `tr_sdc_ma.wrds_ma_details`:

| PostgreSQL Col | Type | Description |
|---------------|------|-------------|
| `master_deal_no` | varchar | Unique deal identifier (primary key) |
| `dateann` | date | Public announcement date |
| `dateeff` | date | Deal completion / effective date |
| `datewith` | date | Withdrawal date (if deal fell through) |
| `status` | varchar | Deal status code (see below) |
| `amanames` | varchar | Acquiror company name |
| `tmanames` | varchar | Target company name |
| `anation` | varchar | Acquiror country |
| `tnation` | varchar | Target country |
| `tsicp` | varchar | Target SIC code |
| `apublic` | varchar | Acquiror public/private flag |
| `tpublic` | varchar | Target public/private flag |
| `deal_value` | numeric | Transaction value ($M) |
| `form` | varchar | Deal structure / form of transaction |
| `consid` | varchar | Consideration paid (cash, stock, mixed) |
| `pctacq` | numeric | Percent of target acquired |
| `pctown` | numeric | Percent owned after transaction |
| `albofirm` | varchar | LBO flag: `'Yes'` if leveraged buyout, `'No'` otherwise |
| `sftype` | varchar | Source of financing (e.g., `'Borrowings'`, `'Corporate Funds'`) |
| `attitude` | varchar | `'Friendly'`/`'Hostile'`/`'Unsolicited'` |
| `pm4wk` | numeric | 4-week premium over market price (%) |
| `acusip` | varchar | Acquiror CUSIP |
| `master_cusip` | varchar | Target CUSIP |
| `entval` | numeric | Enterprise value ($M) |
| `eqval` | numeric | Equity value ($M) |
| `mv` | numeric | Market value of target ($M) |
| `pct_cash` | numeric | Percent of consideration in cash |
| `pct_stk` | numeric | Percent of consideration in stock |
| `compete` | varchar | Competing bid indicator |
| `tender` | varchar | Tender offer indicator |
| `rd` | varchar | Reverse deal indicator |

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
    (df['tnation'] == 'United States')
].copy()
df_completed['announce_year'] = pd.to_datetime(
    df_completed['dateann']).dt.year
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
# albofirm = 'Yes' means an LBO firm is the acquiror (confirmed WRDS column name)
df_lbo = df[df['albofirm'] == 'Yes']
```

### 2. Source of Financing (supplemental)

```python
# sftype shows how deal was financed — useful for LBO confirmation
# PE-suggestive values: 'Borrowings', 'Line of Credit', 'Bridge Loan', 'Debt Issue'
# Strategic values: 'Corporate Funds', 'Common Stock Issue'
print(df['sftype'].value_counts().head(20))

# Leveraged financing: any deal using significant debt
df_leveraged = df[
    df['sftype'].str.contains('Borrowings|Bridge Loan|Line of Credit|Debt Issue',
                              na=False, regex=True)
]
```

### 3. Acquiror Name Pattern Match (backup)

```python
# Known PE firm name patterns — no acquiror_type column in wrds_ma_details;
# name matching provides supplemental PE identification
PE_NAME_PATTERNS = (
    r'private equity|buyout|capital partners|equity partners|'
    r'apollo|blackstone|carlyle|kkr|tpg|warburg pincus|bain capital|'
    r'advent|vista equity|thoma bravo|francisco partners|silver lake|'
    r'cerberus|ares management|oaktree|bc partners|apax|'
    r'general atlantic|insight partners|summit partners'
)
df['pe_name_match'] = df['amanames'].str.lower().str.contains(
    PE_NAME_PATTERNS, na=False, regex=True
)
```

### Combined PE Identification

```python
df['is_pe_buyer'] = (
    (df['albofirm'] == 'Yes') |    # LBO firm flag
    df['pe_name_match']             # name pattern fallback
)

# Strategic = not PE
df['is_strategic_buyer'] = ~df['is_pe_buyer']

# Annual PE vs Strategic split
pe_share = (df.groupby(['announce_year', 'is_pe_buyer'])
              .agg(n_deals=('master_deal_no', 'count'),
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
    (df['tpublic'] == 'P') &
    (df['tnation'] == 'United States') &
    (df['status'] == 'C')
]

# Private target deals (more frequent, lower dollar value)
df_private_target = df[
    (df['tpublic'] == 'V') &
    (df['tnation'] == 'United States') &
    (df['status'] == 'C')
]
```

## Standard Cleaning Filters

### Clean US M&A Deal Sample

```python
query = """
SELECT
    master_deal_no,
    dateann             AS date_announced,
    dateeff             AS date_effective,
    datewith            AS date_withdrawn,
    status,
    amanames            AS acquiror_name,
    tmanames            AS target_name,
    anation             AS acquiror_nation,
    tnation             AS target_nation,
    tsicp               AS target_sic,
    apublic,
    tpublic,
    deal_value,
    form                AS form_of_transaction,
    consid              AS consideration_paid,
    pctacq              AS pct_acquired,
    pctown              AS pct_owned_after,
    albofirm            AS lbo_flag,
    sftype              AS source_of_financing,
    attitude,
    pm4wk               AS premium_4wk,
    pct_cash,
    pct_stk,
    master_cusip        AS target_cusip,
    acusip              AS acquiror_cusip
FROM tr_sdc_ma.wrds_ma_details
WHERE tnation = 'United States'
  AND dateann BETWEEN %s AND %s
  AND status IN ('C', 'W')   -- completed and withdrawn
ORDER BY dateann
"""
df = pd.read_sql(query, conn, params=('1985-01-01', '2024-12-31'))
```

### Minimal Sample (high-quality deal counts)

```python
# For clean annual counts comparable across years:
FULL_CONTROL_FORMS = {
    'Merger', 'Acq. of Majority Interest',
    'Acq. of Remaining Interest', 'Asset Acquisition',
}
df_clean = df[
    (df['status'] == 'C') &
    (df['tnation'] == 'United States') &
    (df['form_of_transaction'].isin(FULL_CONTROL_FORMS)) &
    (pd.to_numeric(df['pct_acquired'], errors='coerce').fillna(100) >= 50) &
    (df['deal_value'] >= 1)   # at least $1M disclosed value
].copy()

df_clean['year'] = pd.to_datetime(df_clean['date_announced']).dt.year
```

## Canonical Query Patterns

### Annual Deal Counts: PE vs Strategic, Public vs Private

```python
query = """
SELECT
    EXTRACT(YEAR FROM dateann)::int AS announce_year,
    status,
    tpublic             AS target_public,
    albofirm            AS lbo_flag,
    COUNT(*)            AS n_deals,
    SUM(deal_value)     AS total_value_mm,
    AVG(deal_value)     AS avg_value_mm,
    AVG(pm4wk)          AS avg_premium_pct
FROM tr_sdc_ma.wrds_ma_details
WHERE tnation = 'United States'
  AND dateann BETWEEN %s AND %s
  AND deal_value > 0
GROUP BY announce_year, status, tpublic, albofirm
ORDER BY announce_year, status, tpublic
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
# Note: SDC master_cusip may be 6- or 8-digit; strip trailing digits
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
