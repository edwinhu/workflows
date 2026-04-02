# SDC New Issues — Equity & Debt Issuances

## Contents

- [Overview](#overview)
- [Discovering the Schema](#discovering-the-schema)
- [Tables](#tables)
- [Equity Issuances: Key Columns](#equity-issuances-key-columns)
- [Debt Issuances: Key Columns](#debt-issuances-key-columns)
- [CRITICAL: IPO vs SEO Identification](#critical-ipo-vs-seo-identification)
- [Rule 144A Equity Offerings](#rule-144a-equity-offerings)
- [Standard Cleaning Filters](#standard-cleaning-filters)
- [Canonical Query Patterns](#canonical-query-patterns)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Coverage Notes & Quirks](#coverage-notes--quirks)
- [Validated Benchmarks](#validated-benchmarks)

## Overview

WRDS hosts the core SDC (Securities Data Company / LSEG Deals) components, including **Global New Issues** data covering equity and debt offerings worldwide. The desktop SDC Platinum application was retired December 2023; data is now accessed exclusively via WRDS PostgreSQL.

| Component | Coverage | Content |
|-----------|----------|---------|
| Global New Issues — Equity | ~1970–present | IPOs, SEOs, Rule 144A equity, convertibles, preferred stock |
| Global New Issues — Debt | ~1970–present | Corporate bonds, MTNs, 144A bonds, convertible debt |
| Global New Issues — Equity Pipeline | Registration period | S-1/S-11 filings not yet priced |

**Primary use case for practice area analysis**: Annual counts of completed US equity offerings (IPOs, SEOs) and debt offerings (investment-grade, high-yield, 144A) to quantify capital markets workload by security type.

## Discovering the Schema

WRDS PostgreSQL schema and table names for SDC may vary by subscription vintage. **Always run this discovery query first:**

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

# Find new issues tables within discovered schemas
cur.execute("""
    SELECT table_schema, table_name, pg_size_pretty(pg_total_relation_size(
        quote_ident(table_schema)||'.'||quote_ident(table_name))) AS size
    FROM information_schema.tables
    WHERE table_schema ILIKE '%sdc%' OR table_schema ILIKE '%tdc%'
    ORDER BY table_schema, table_name
""")
for row in cur.fetchall():
    print(row)
```

**Expected schema names** (confirm via above): `tdc1` (legacy) or `sdc` (post-2023 migration). Tables likely named `sdc_ni` (new issues) and `sdc_ma` (M&A).

```python
# Once schema is found, inspect new issues columns
SCHEMA = 'tdc1'  # replace with actual schema
cur.execute("""
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = %s AND table_name ILIKE '%ni%'
    ORDER BY ordinal_position
""", (SCHEMA,))
for col in cur.fetchall():
    print(col)
```

## Tables

| Table | Description | Rows (approx) |
|-------|-------------|---------------|
| `{schema}.sdc_ni` | All new issues: equity + debt | ~1M+ |
| `{schema}.sdc_ma` | Mergers & acquisitions | See `sdc-ma.md` |

For debt offerings specifically, the SDC New Issues database includes both equity and debt in a single table, differentiated by `security_type` or `deal_type`.

## Equity Issuances: Key Columns

Column names use SDC short codes; PostgreSQL column names are lowercase equivalents.

| SDC Code | PostgreSQL Col | Type | Description |
|----------|---------------|------|-------------|
| `DEAL_NO` | `deal_no` | varchar | Unique deal identifier |
| `FILED` | `filing_date` | date | S-1/S-11 filing date |
| `D` | `issue_date` | date | Pricing / issuance date |
| `I` | `issuer` | varchar | Issuer company name |
| `ST` | `state` | varchar | US state of incorporation |
| `NAT` | `nation` | varchar | Country (use `'United States'`) |
| `IPO` | `ipo` | varchar | IPO flag: `'Yes'` = IPO, `'No'` = SEO |
| `ORIG_IPO` | `orig_ipo` | varchar | Original IPO flag (more conservative) |
| `P` | `offer_price` | numeric | Offer price per share ($) |
| `SECUR` | `security_type` | varchar | Security type (see below) |
| `DESCR` | `description` | varchar | Full description |
| `REIT_TYPE` | `reit` | varchar | REIT type code (blank = not a REIT) |
| `UIT` | `unit` | varchar | Unit investment trust flag |
| `DEPOSITARY` | `adr` | varchar | ADR/depositary receipt flag |
| `CU` | `cusip` | varchar | 6-digit CUSIP |
| `CUSIP9` | `cusip9` | varchar | 9-digit CUSIP |
| `PROCDS` | `proceeds` | numeric | Gross proceeds ($M) |
| `VE` | `vc` | varchar | VC-backed flag (`'Yes'`/`'No'`) |
| `GPCT` | `gross_spread` | numeric | Gross underwriting spread (%) |
| `ALLMGRROLECODE` | `mgr_codes` | varchar | Underwriter/manager codes |
| `HITECHP` | `tech_ind` | varchar | Technology company indicator |
| `LFILE` | `low_price` | numeric | Low end of filing price range |
| `HFILE` | `high_price` | numeric | High end of filing price range |
| `AH_LFILE` | `low_price_history` | varchar | Amendment history low prices |
| `AH_HFILE` | `high_price_history` | varchar | Amendment history high prices |
| — | `closed_end_fund` | varchar | Closed-end fund flag (CEF) |
| — | `exchange` | varchar | Listing exchange |
| — | `sic` | varchar | SIC code |

### Security Type Values (common)

| `security_type` | Description |
|----------------|-------------|
| `'Common Shares'` | Ordinary common stock |
| `'Ord/Common Shs.'` | Ordinary common shares |
| `'Class A Shares'` | Class A shares (treated as common) |
| `'Ordinary Shares'` | Foreign ordinary shares |
| `'Units'` | **EXCLUDE** — combined unit packages |
| `'Ltd Prtnr Int'` | **EXCLUDE** — limited partnership interests |
| `'MLP-Common Shs'` | **EXCLUDE** — MLP units |
| `'Shs Benficl Int'` | **EXCLUDE** — beneficial interest shares |
| `'Preferred Stock'` | Preferred (exclude from equity issuance counts) |
| `'Convertible'` | Convertible securities |

## Debt Issuances: Key Columns

SDC tracks debt offerings separately in the New Issues database. Key additional fields for debt:

| SDC Code | PostgreSQL Col | Type | Description |
|----------|---------------|------|-------------|
| `DEAL_NO` | `deal_no` | varchar | Unique deal identifier |
| `D` | `issue_date` | date | Pricing / issuance date |
| `I` | `issuer` | varchar | Issuer company name |
| `NAT` | `nation` | varchar | Country |
| `PROCDS` | `proceeds` | numeric | Gross proceeds ($M) |
| — | `maturity_date` | date | Bond maturity date |
| — | `coupon` | numeric | Coupon rate (%) |
| — | `bond_type` | varchar | Bond type: straight, MTN, convertible, etc. |
| — | `is_144a` | varchar | Rule 144A flag (`'Yes'`/`'No'`) |
| — | `is_reg_s` | varchar | Regulation S (offshore) flag |
| — | `sp_rating` | varchar | S&P rating at issuance |
| — | `moodys_rating` | varchar | Moody's rating at issuance |
| — | `fitch_rating` | varchar | Fitch rating at issuance |
| — | `seniority` | varchar | Senior/Subordinated/Junior |
| — | `collateral` | varchar | Secured/Unsecured |

### Rating → IG/HY Classification

```python
IG_MOODYS = {'Aaa','Aa1','Aa2','Aa3','A1','A2','A3','Baa1','Baa2','Baa3'}
HY_MOODYS = {'Ba1','Ba2','Ba3','B1','B2','B3','Caa1','Caa2','Caa3','Ca','C'}

IG_SP = {'AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-'}
HY_SP = {'BB+','BB','BB-','B+','B','B-','CCC+','CCC','CCC-','CC','C','D'}

def classify_rating(moodys, sp):
    if moodys in IG_MOODYS or sp in IG_SP:
        return 'Investment Grade'
    if moodys in HY_MOODYS or sp in HY_SP:
        return 'High Yield'
    return 'Not Rated / NR'
```

## CRITICAL: IPO vs SEO Identification

**Two flag variables with different coverage:**

| Flag | Meaning | Notes |
|------|---------|-------|
| `ipo = 'Yes'` | SDC marked as IPO | Broader; includes some re-IPOs, spin-offs |
| `orig_ipo = 'Yes'` | SDC's more conservative IPO flag | Blank for many non-US or early-period deals |
| Neither flag | Follow-on / secondary offering (SEO) | No explicit SEO flag — infer by exclusion |

**Standard academic practice (Lowry, Michaely, Volkova 2017):**
```python
# Step 1: Require either IPO flag is 'Yes' (exclude non-IPO rows)
df_ipo = df[(df['ipo_flag'] != 'No') & (df['orig_ipo_flag'] != 'No')]

# Step 2: Keep common shares only (exclude units, LPs, MLPs)
EXCLUDE_TYPES = {'Units', 'Ltd Prtnr Int', 'MLP-Common Shs',
                 'Shs Benficl Int', 'Ltd Liab Int', 'Stock Unit',
                 'Trust Units', 'Beneficial Ints'}
df_ipo = df_ipo[~df_ipo['security_type'].isin(EXCLUDE_TYPES)]

# Step 3: Exclude REITs (reit is not blank)
df_ipo = df_ipo[df_ipo['reit'].isna() | (df_ipo['reit'] == '')]

# Step 4: Exclude ADRs
df_ipo = df_ipo[df_ipo['adr'] == 'No']

# Step 5: Exclude closed-end funds
df_ipo = df_ipo[df_ipo['closed_end_fund'] == 'No']

# Step 6: Exclude unit investment trusts
df_ipo = df_ipo[(df_ipo['unit'] == 'No') | (df_ipo['unit'] == '')]

# Step 7: Exclude penny stocks
df_ipo = df_ipo[df_ipo['offer_price'] >= 5.0]
```

**SEOs (seasoned equity offerings):**
```python
# SEOs = not flagged as IPO, common stock, US market
df_seo = df[
    (df['ipo_flag'] == 'No') &                    # not an IPO
    (~df['security_type'].isin(EXCLUDE_TYPES)) &  # common stock
    (df['adr'] == 'No') &                         # not ADR
    (df['nation'] == 'United States') &
    (df['offer_price'] >= 1.0)                    # exclude near-zero
]
```

## Rule 144A Equity Offerings

Rule 144A allows large institutional investors to trade unregistered securities. SDC tracks 144A equity separately:

- In Figure A.5 of the Lowry et al. appendix, "US Rule 144A Common Stock" = 239 observations (1973–2016)
- Filter: `security_type ILIKE '%144A%'` or `is_144a = 'Yes'`
- 144A equity is less common than 144A debt; primary use case is PIPE-like institutional placements

**Note for practice area analysis**: 144A equity is a distinct capital markets product but small in count compared to 144A debt. Include separately in tables but not in clean IPO/SEO counts.

## Standard Cleaning Filters

### US Equity Issuances (IPO + SEO combined)

```python
query = """
SELECT
    deal_no,
    issue_date,
    EXTRACT(YEAR FROM issue_date)::int AS issue_year,
    issuer,
    nation,
    ipo         AS ipo_flag,
    orig_ipo    AS orig_ipo_flag,
    offer_price,
    proceeds,
    security_type,
    vc          AS vc_backed,
    gross_spread,
    reit,
    adr,
    closed_end_fund,
    unit,
    cusip9
FROM {schema}.sdc_ni
WHERE nation = 'United States'
  AND issue_date BETWEEN %s AND %s
  AND proceeds IS NOT NULL
  AND proceeds > 0
ORDER BY issue_date
"""
```

Then apply Python-side filters (security type exclusions, price floors) as above.

### US Debt Issuances

```python
query = """
SELECT
    deal_no,
    issue_date,
    EXTRACT(YEAR FROM issue_date)::int AS issue_year,
    issuer,
    proceeds,
    bond_type,
    is_144a,
    is_reg_s,
    coupon,
    maturity_date,
    sp_rating,
    moodys_rating,
    seniority,
    nation
FROM {schema}.sdc_ni
WHERE nation = 'United States'
  AND security_type ILIKE '%bond%'     -- adjust to actual bond type codes
  AND issue_date BETWEEN %s AND %s
  AND proceeds IS NOT NULL
  AND proceeds > 0
ORDER BY issue_date
"""
```

## Linking to Other Datasets

### SDC NI → CRSP (IPO matching)

```python
# Match on CUSIP (first 6 digits) to get PERMNO
# CRSP stocknames: ncusip is 8-char (6+2 check digits)
# SDC cusip9 is 9-digit; take first 8 chars = ncusip

df['ncusip'] = df['cusip9'].str[:8]

# Then join on crsp.stocknames
link_query = """
    SELECT s.permno, s.ncusip, s.namedt, s.nameenddt
    FROM crsp.stocknames s
    WHERE s.ncusip = ANY(%s)
"""
```

### SDC NI → Compustat (via CUSIP)

```python
# comp.security has cusip (8-char) and gvkey
link_query = """
    SELECT s.gvkey, s.cusip, s.tic
    FROM comp.security s
    WHERE s.cusip = ANY(%s)
"""
# SDC cusip9[:8] matches comp.security.cusip
```

### SDC NI → EDGAR

```python
# Match issuer name + date range to EDGAR CIK
# Use wrdssec.wciklink_cusip if CUSIP is available
link_query = """
    SELECT l.cik, l.cusip
    FROM wrdssec.wciklink_cusip l
    WHERE l.cusip = ANY(%s)
"""
```

## Coverage Notes & Quirks

- **US coverage**: Most complete for 1985–present. Pre-1985 data has coverage gaps, especially for smaller offerings.
- **Nation filter gotcha**: SDC records primary exchange nation three ways: specific country name, `'Unknown'`, or blank. To get all US IPOs: filter on `nation IN ('United States', 'Unknown')` but then validate. The Lowry et al. appendix shows selecting all countries then de-selecting USA/Americas to capture blank-nation US listings.
- **Offer price commas**: Pre-2000 data sometimes uses commas as thousand separators — strip before numeric conversion.
- **Proceeds units**: Proceeds are in **$M** (millions USD). Verify: large IPOs (Alibaba = $21.8B) show as ~21,800.
- **Duplicate deal_no**: Amendments and co-issuers can create multiple rows per deal. Use `COUNT(DISTINCT deal_no)` for offer counts.
- **SDC vs EDGAR count discrepancy**: SDC undercounts very small offerings (<$5M) and some shelf takedowns. For clean academic IPO counts, standard benchmark is Jay Ritter's IPO data at https://site.warrington.ufl.edu/ritter/ipo-data/ (~8,000 IPOs 1975–recent).
- **Post-2023 migration**: After LSEG retired the desktop app (Dec 2023), SDC data migrated to WRDS. Schema name and exact column spellings may differ from pre-migration. Always run discovery queries.

## Validated Benchmarks

Approximate annual US common stock IPO counts (clean academic sample):

| Period | Avg IPOs/Year | Notes |
|--------|--------------|-------|
| 1980–1989 | ~260 | Pre-internet era |
| 1990–1999 | ~450 | Dot-com buildup |
| 1999–2000 | ~550 peak | Dot-com peak |
| 2001–2008 | ~160 | Post-dot-com trough |
| 2009–2019 | ~175 | Post-GFC |
| 2020–2021 | ~430 | SPAC/tech surge |
| 2022–2023 | ~90 | Rate hike freeze |

Source: Jay Ritter IPO data; compare against SDC counts after cleaning.

**SEOs are ~3–5× more frequent than IPOs** in any given year. In 2021: ~900 traditional SEOs vs ~450 IPOs.

**Practice area implication**: In a typical year, capital markets lawyers do far more SEO work than IPO work. 144A debt dwarfs both in dollar volume. IPOs get the press; SEOs and 144A are the volume business.
