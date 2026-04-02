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
       OR schema_name ILIKE '%tr_sdc%'
    ORDER BY schema_name
""")
print("SDC schemas:", cur.fetchall())

# Find new issues tables within discovered schemas
cur.execute("""
    SELECT table_schema, table_name, pg_size_pretty(pg_total_relation_size(
        quote_ident(table_schema)||'.'||quote_ident(table_name))) AS size
    FROM information_schema.tables
    WHERE table_schema = 'tr_sdc_ni'
    ORDER BY table_schema, table_name
""")
for row in cur.fetchall():
    print(row)
```

**Confirmed schema**: `tr_sdc_ni` (Thomson Reuters SDC New Issues). Main table: `wrds_ni_details`. Note: `tfn.s12` (mutual fund holdings) is a separate product within the Thomson Financial schema.

```python
# Inspect new issues columns
SCHEMA = 'tr_sdc_ni'
cur.execute("""
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = %s AND table_name = 'wrds_ni_details'
    ORDER BY ordinal_position
""", (SCHEMA,))
for col in cur.fetchall():
    print(col)
```

## Tables

| Table | Description |
|-------|-------------|
| `tr_sdc_ni.wrds_ni_details` | All new issues: equity + debt (main table) |
| `tr_sdc_ni.wrds_ni_events` | Deal events / amendments timeline |
| `tr_sdc_ni.wrds_ni_managers` | Underwriter/manager details |
| `tr_sdc_ni.wrds_ni_related` | Related M&A deal cross-references |
| `tr_sdc_ni.wrds_ni_sharehlds` | Shareholder selling data |

For debt offerings specifically, the SDC New Issues database includes both equity and debt in `wrds_ni_details`, differentiated by `security` (security type field).

## Equity Issuances: Key Columns

Column names are the actual PostgreSQL column names in `tr_sdc_ni.wrds_ni_details`.

| PostgreSQL Col | Type | Description |
|---------------|------|-------------|
| `master_deal_no` | varchar | Unique deal identifier (primary key) |
| `filingdate` | date | S-1/S-11 filing date |
| `master_deal_date` | date | Pricing / issuance date |
| `ninames` | varchar | Issuer company name |
| `state` | varchar | US state of incorporation |
| `nation` | varchar | Country (use `'United States'`) |
| `ipo` | varchar | IPO flag: `'Yes'` = IPO, `'No'` = SEO |
| `listipo` | varchar | Listed on IPO exchange flag |
| `offerpric` | varchar | Offer price per share ($) — string, cast to numeric |
| `security` | varchar | Security type (see below) |
| `description` | varchar | Full description |
| `cusip` | varchar | 6-digit CUSIP |
| `cusip9` | varchar | 9-digit CUSIP |
| `totdolamt` | numeric | Total dollar amount of offering ($M) |
| `totgrossmil` | numeric | Total gross proceeds ($M) |
| `grosspercent` | varchar | Gross underwriting spread (%) |
| `hightech` | varchar | Technology company indicator |
| `lowfileprice` | numeric | Low end of filing price range ($) |
| `highfileprice` | numeric | High end of filing price range ($) |
| `exchange` | varchar | Listing exchange |
| `sicp` | varchar | SIC code |
| `ticker` | varchar | Stock ticker |
| `moody` | varchar | Moody's rating (debt offerings) |
| `sp` | varchar | S&P rating (debt offerings) |
| `coupon` | varchar | Coupon rate (debt offerings) |
| `maturity` | date | Maturity date (debt offerings) |
| `year` | varchar | Year of issuance |

**Note on missing legacy fields**: The WRDS `wrds_ni_details` table does not contain separate VC-backed (`vc`), REIT (`reit`), ADR (`adr`), closed-end fund, or unit trust flags as documented in older SDC Platinum literature. Use `security` type and `description` fields to identify these deal types post-query.

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

SDC New Issues tracks both equity and debt in `wrds_ni_details`. Additional debt-specific columns:

| PostgreSQL Col | Type | Description |
|---------------|------|-------------|
| `master_deal_no` | varchar | Unique deal identifier |
| `master_deal_date` | date | Pricing / issuance date |
| `ninames` | varchar | Issuer company name |
| `nation` | varchar | Country |
| `totdolamt` | numeric | Offering amount ($M) |
| `maturity` | date | Bond maturity date |
| `coupon` | varchar | Coupon rate (%) — string, cast to numeric |
| `moody` | varchar | Moody's rating at issuance |
| `sp` | varchar | S&P rating at issuance |
| `description` | varchar | Bond description (check for "144A", "Senior") |
| `security` | varchar | Security type code |
| `registration_status` | varchar | Registration status |
| `registration_status_long` | varchar | Full registration description |
| `regrights` | varchar | Registration rights indicator |

**Note**: For comprehensive debt issuance analysis with explicit 144A flags and IG/HY ratings at issuance, prefer **FISD/Mergent** (`fisd_fisd.fisd_mergedissue`) over SDC New Issues. FISD has explicit `rule_144a` and `bond_type` fields and broader debt coverage.

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

**Standard approach (adapted for WRDS `wrds_ni_details` column names):**
```python
# Step 1: Require IPO flag = 'Yes' (exclude SEOs)
df_ipo = df[df['ipo'] == 'Yes'].copy()

# Step 2: Keep common shares only (exclude units, LPs, MLPs, preferred)
EXCLUDE_TYPES = {'Units', 'Ltd Prtnr Int', 'MLP-Common Shs',
                 'Shs Benficl Int', 'Ltd Liab Int', 'Stock Unit',
                 'Trust Units', 'Beneficial Ints', 'Preferred Stock'}
df_ipo = df_ipo[~df_ipo['security'].isin(EXCLUDE_TYPES)]

# Step 3: Exclude REITs, ADRs, CEFs via description/security text
EXCLUDE_DESCR = ['reit', 'real estate investment', 'depositary',
                 'closed-end fund', 'unit trust']
excl_mask = df_ipo['description'].str.lower().str.contains(
    '|'.join(EXCLUDE_DESCR), na=False)
df_ipo = df_ipo[~excl_mask]

# Step 4: Exclude penny stocks (cast offerpric to float)
df_ipo['offer_price_num'] = pd.to_numeric(df_ipo['offerpric'], errors='coerce')
df_ipo = df_ipo[df_ipo['offer_price_num'] >= 5.0]
```

**SEOs (seasoned equity offerings):**
```python
# SEOs = ipo flag 'No', common stock, US market
df_seo = df[
    (df['ipo'] == 'No') &                         # not an IPO
    (~df['security'].isin(EXCLUDE_TYPES)) &       # common stock
    (df['nation'] == 'United States')
].copy()
df_seo['offer_price_num'] = pd.to_numeric(df_seo['offerpric'], errors='coerce')
df_seo = df_seo[df_seo['offer_price_num'] >= 1.0]
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
    master_deal_no,
    master_deal_date,
    EXTRACT(YEAR FROM master_deal_date)::int AS issue_year,
    ninames             AS issuer,
    nation,
    ipo                 AS ipo_flag,
    offerpric           AS offer_price,
    totdolamt           AS proceeds_mm,
    security            AS security_type,
    grosspercent        AS gross_spread_pct,
    highfileprice,
    lowfileprice,
    hightech,
    description,
    cusip9,
    exchange,
    ticker
FROM tr_sdc_ni.wrds_ni_details
WHERE nation = 'United States'
  AND master_deal_date BETWEEN %s AND %s    -- use '1985-01-01' to '2026-12-31'
  AND totdolamt IS NOT NULL
  AND totdolamt > 0
ORDER BY master_deal_date
"""
```

Then apply Python-side filters (security type exclusions, price floors) as shown in CRITICAL section above.

### US Debt Issuances (SDC)

```python
# Use FISD/Mergent for comprehensive debt analysis — it has explicit 144A/IG/HY flags.
# SDC NI can supplement: filter by security type containing 'Bond', 'Note', 'MTN'
query = """
SELECT
    master_deal_no,
    master_deal_date,
    EXTRACT(YEAR FROM master_deal_date)::int AS issue_year,
    ninames             AS issuer,
    totdolamt           AS proceeds_mm,
    security            AS security_type,
    moody               AS moodys_rating,
    sp                  AS sp_rating,
    coupon,
    maturity,
    description,
    registration_status,
    registration_status_long,
    nation
FROM tr_sdc_ni.wrds_ni_details
WHERE nation = 'United States'
  AND security ILIKE '%bond%'      -- check actual security values first
  AND master_deal_date BETWEEN %s AND %s    -- use '1985-01-01' to '2026-12-31'
  AND totdolamt IS NOT NULL
  AND totdolamt > 0
ORDER BY master_deal_date
"""
```

## Linking to Other Datasets

### SDC NI → CRSP (IPO matching)

```python
# Match on CUSIP (first 6 digits) to get PERMNO
# CRSP stocknames: ncusip is 8-char (6+2 check digits)
# SDC cusip9 is 9-digit; take first 8 chars = ncusip

df['ncusip'] = df['cusip9'].str[:8]  # cusip9 column exists in wrds_ni_details

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
