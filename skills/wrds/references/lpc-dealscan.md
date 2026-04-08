# LPC / DealScan — Syndicated Loan Database

## Contents

- [Overview](#overview)
- [Tables](#tables)
- [dealscan.facility Key Columns](#dealscanfacility-key-columns)
- [dealscan.package Key Columns](#dealscanpackage-key-columns)
- [dealscan.company Key Columns](#dealscancompany-key-columns)
- [dealscan.lendershares Key Columns](#dealscanlendershares-key-columns)
- [dealscan.dealscan (Flat Table) Key Columns](#dealscandealscan-flat-table-key-columns)
- [Loan Type Codes](#loan-type-codes)
- [Primary Purpose Codes](#primary-purpose-codes)
- [Market Segment Indicators](#market-segment-indicators)
- [Distribution Methods](#distribution-methods)
- [Leveraged vs Investment Grade Filter](#leveraged-vs-investment-grade-filter)
- [144A / Institutional Tranche Filter](#144a--institutional-tranche-filter)
- [Canonical Query Patterns](#canonical-query-patterns)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Coverage Notes & Quirks](#coverage-notes--quirks)
- [Validated Benchmarks](#validated-benchmarks)

## Overview

LPC DealScan (now **LSEG Loan Connector**) is the standard academic database for **syndicated loans**. It covers the global syndicated loan market from 1981 to present, with comprehensive US coverage starting ~1990. On WRDS, it is the primary source for:

- Annual syndicated loan origination counts and dollar volume
- Loan-level characteristics (type, purpose, spread, maturity, covenants)
- Leveraged vs investment-grade loan identification
- Lender/arranger league table analysis
- Linking loans to borrower financials (Compustat) for credit risk studies

### LSEG Schema Migration (August 2021)

DealScan was restructured on WRDS in August 2021 when it moved from Thomson Reuters/Refinitiv to LSEG. Access via **LSEG > WRDS-LSEG DealScan** (not the old Thomson Reuters path).

**Three schemas exist on WRDS:**

| Schema | Status | Description |
|--------|--------|-------------|
| `tr_dealscan` | **Active** | Current LSEG schema — use this |
| `dealscan` | Legacy alias | Points to same data as `tr_dealscan` |
| `tr_dealscan_old` | Archived | Pre-migration snapshot (no access) |

**Critical coverage gap:** The **normalized tables** (`facility`, `package`, `lendershares`, `marketsegment`, etc.) **stop being populated after ~2020**. Only the **flat table** (`tr_dealscan.dealscan`, 3.1M rows) is actively updated quarterly and has data through 2025.

**For current data (2021+), you must use the flat table.** See [Using the Flat Table for Recent Data](#using-the-flat-table-for-recent-data-2021) for query patterns.

**Chava-Roberts linking table** (`wrdsapps_link_dealscan_wscope.dswslink`) is stale post-2020 and needs manual extension for recent data.

| Resource | Schema.Table | Rows | Coverage | Description |
|----------|-------------|------|----------|-------------|
| **Flat table** | `tr_dealscan.dealscan` | 3,103,109 | **Through 2025** | Denormalized: 1 row per lender-tranche pair |
| Facility (tranche) | `tr_dealscan.facility` | 396,004 | Through ~2020 | 1 row per loan tranche |
| Package (deal) | `tr_dealscan.package` | 268,991 | Through ~2020 | 1 row per deal |
| Company | `tr_dealscan.company` | 148,318 | Through ~2020 | Borrower and lender records |
| Lender shares | `tr_dealscan.lendershares` | 2,150,142 | Through ~2020 | 1 row per lender-facility pair |
| Market segment tags | `tr_dealscan.marketsegment` | 712,495 | Through ~2020 | Multi-valued: leveraged, IG, etc. |
| Current pricing | `tr_dealscan.currfacpricing` | 669,322 | Through ~2020 | Base rate + spread at origination |
| Facility security | `tr_dealscan.facilitysecurity` | 111,287 | Through ~2020 | Collateral/security type |
| Financial covenants | `tr_dealscan.wrds_financial_covenants` | 687,804 | Through ~2020 | WRDS-processed covenant data |
| Linking IDs | `tr_dealscan.wrds_loanconnector_ids` | 363,311 | Through ~2020 | Maps LoanConnector IDs to WRDS IDs |
| Performance pricing | `tr_dealscan.performancepricing` | 143,452 | Through ~2020 | Pricing grids tied to financial ratios |
| Facility sponsors | `tr_dealscan.facilitysponsor` | 73,621 | Through ~2020 | PE/sponsor information |
| Financial covenants (raw) | `tr_dealscan.financialcovenant` | 68,763 | Through ~2020 | Raw covenant terms |
| Organization type | `tr_dealscan.organizationtype` | 46,482 | Through ~2020 | Borrower org type |
| Facility dates | `tr_dealscan.facilitydates` | 227,683 | Through ~2020 | Amendment/closing/launch dates |
| Sublimits | `tr_dealscan.sublimits` | 334,539 | Through ~2020 | Sub-facility limits (LC, swingline, etc.) |

## tr_dealscan.facility Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `facilityid` | numeric | Unique facility (tranche) identifier — **primary key** |
| `packageid` | numeric | Links to `package.packageid` (deal level) |
| `borrowercompanyid` | numeric | Links to `company.companyid` |
| `company` | varchar | Borrower name (denormalized) |
| `facilitystartdate` | date | Facility origination/active date |
| `facilityenddate` | date | Maturity date |
| `loantype` | varchar | Loan type code (see Loan Type Codes) |
| `primarypurpose` | varchar | Primary loan purpose (see Purpose Codes) |
| `secondarypurpose` | varchar | Secondary purpose |
| `facilityamt` | numeric | Facility amount in **raw currency units** (e.g., USD = dollars) |
| `currency` | varchar | Currency name (e.g., `'United States Dollars'`) |
| `exchangerate` | numeric | Exchange rate to USD |
| `maturity` | int | Maturity in **months** from facility start |
| `secured` | varchar | `'Yes'`, `'No'`, or `'None'` (None = unknown) |
| `seniority` | varchar | `'Senior'`, `'Subordinated'`, `'Mezzanine'`, etc. |
| `distributionmethod` | varchar | How loan was placed (see Distribution Methods) |
| `countryofsyndication` | varchar | Country where deal was syndicated (e.g., `'USA'`) |
| `averagelife` | numeric | Weighted average life in years |
| `ticker` | varchar | Borrower stock ticker |
| `lclimit` | numeric | Letter of credit sublimit |
| `renewal` | varchar | Whether facility is a renewal |
| `conversiondate` | date | Date of term loan conversion (if applicable) |

## tr_dealscan.package Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `packageid` | numeric | Unique deal identifier — **primary key** |
| `borrowercompanyid` | numeric | Links to `company.companyid` |
| `dealactivedate` | date | Deal origination date |
| `dealamount` | numeric | Total deal amount (sum of all facilities) in raw currency |
| `currency` | varchar | Deal currency |
| `dealpurpose` | varchar | Deal-level purpose |
| `dealstatus` | varchar | Status of the deal |
| `salesatclose` | numeric | Borrower sales at close ($MM) |
| `refinancingindicator` | varchar | Whether deal refinances prior debt |
| `active` | varchar | Whether deal is currently active |
| `hybrid` | varchar | Whether deal has hybrid features |

## tr_dealscan.company Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `companyid` | numeric | Unique company identifier — **primary key** |
| `company` | varchar | Company name |
| `parentid` | numeric | Parent company ID |
| `ultimateparentid` | numeric | Ultimate parent company ID |
| `sales` | numeric | Company sales |
| `ticker` | varchar | Stock ticker |
| `publicprivate` | varchar | Public or private indicator |
| `city`, `state`, `country` | varchar | Location fields |
| `primarysiccode` | int | Primary SIC code |
| `institutiontype` | varchar | Institution type for lenders |

## tr_dealscan.lendershares Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `facilityid` | numeric | Links to `facility.facilityid` |
| `companyid` | numeric | Lender company ID (links to `company.companyid`) |
| `lender` | varchar | Lender name (denormalized) |
| `lenderrole` | varchar | Role in syndicate (see below) |
| `bankallocation` | numeric | Lender's share amount |
| `agentcredit` | varchar | `'Yes'`/`'No'` — agent credit flag |
| `leadarrangercredit` | varchar | `'Yes'`/`'No'` — lead arranger credit flag |

**Top lender roles** (by frequency):
- `Participant` (708K) — syndicate participant
- `Mandated Lead arranger` (280K) — primary arranger
- `Arranger` (212K) — arranger
- `Admin agent` (148K) — administrative agent
- `Bookrunner` (53K) — bookrunner
- `Lead arranger` (58K) — lead arranger

## tr_dealscan.dealscan (Flat Table) Key Columns

The flat table is a denormalized view with **one row per lender-tranche pair**. It has the most complete recent coverage (through 2025) but requires deduplication for tranche-level analysis.

| Column | Type | Description |
|--------|------|-------------|
| `lpc_deal_id` | varchar(14) | Deal ID |
| `lpc_tranche_id` | varchar(24) | Tranche ID |
| `deal_permid` | varchar(14) | PermID for the deal |
| `tranche_permid` | varchar(12) | PermID for the tranche |
| `borrower_name` | varchar(100) | Borrower name |
| `borrower_id` | varchar(10) | Borrower company ID |
| `lender_name` | varchar(100) | Lender name |
| `lender_id` | varchar(10) | Lender company ID |
| `primary_role` | varchar(22) | Lender's primary role |
| `tranche_active_date` | date | Tranche origination date |
| `tranche_maturity_date` | date | Tranche maturity date |
| `tranche_amount` | double | Tranche amount (in **millions of local currency**) |
| `tranche_amount_converted` | double | Tranche amount converted (millions USD) |
| `deal_amount` | double | Total deal amount (millions of local currency) |
| `tranche_type` | varchar(40) | Loan type |
| `primary_purpose` | varchar(40) | Primary purpose |
| `market_segment` | varchar(190) | Pipe-delimited market segment tags |
| `distribution_method` | varchar(25) | Distribution method |
| `seniority_type` | varchar(20) | Seniority |
| `secured` | varchar(5) | Secured indicator |
| `country_of_syndication` | varchar(30) | Syndication country |
| `tranche_currency` | varchar(50) | Currency |
| `tranche_cusip` | varchar(25) | CUSIP (if assigned) |
| `all_in_spread_drawn_bps` | double | All-in spread (drawn) in basis points |
| `all_in_spread_undrawn_bps` | double | All-in spread (undrawn) in basis points |
| `lead_arranger` | varchar(1200) | Comma-separated lead arranger names |
| `bookrunner` | varchar(800) | Comma-separated bookrunner names |
| `all_lenders` | varchar(7700) | All syndicate members |
| `number_of_lenders` | double | Number of lenders in syndicate |
| `covenants` | varchar(30) | Covenant types present |
| `max_leverage_ratio` | varchar(35) | Max leverage covenant |
| `law_firm_borrower_primary` | varchar(300) | Borrower's counsel |
| `law_firm_lender_primary` | varchar(141) | Lender's counsel |

> **CRITICAL**: `tranche_amount` in the flat table is in **millions**, while `facilityamt` in the `facility` table is in **raw currency units** (i.e., dollars). Always check which table you're querying.

## Loan Type Codes

| `loantype` | Count | Description |
|------------|-------|-------------|
| `Term Loan` | 123,125 | Generic term loan |
| `Revolver/Line >= 1 Yr.` | 121,161 | Multi-year revolving credit |
| `Term Loan B` | 23,307 | Institutional term loan (higher spread, lower amortization) |
| `364-Day Facility` | 17,817 | Short-term backup facility |
| `Term Loan A` | 14,985 | Bank term loan (lower spread, faster amortization) |
| `Revolver/Line < 1 Yr.` | 14,602 | Short-term revolving credit |
| `Other Loan` | 11,781 | Miscellaneous |
| `Fixed-Rate Bond` | 11,180 | Fixed-rate loan/bond |
| `Standby Letter of Credit` | 6,322 | Standby LC facility |
| `Bridge Loan` | 6,161 | Short-term bridge financing |
| `Revolver/Term Loan` | 4,405 | Combined revolver/term |
| `Note` | 4,239 | Note issuance |
| `Delay Draw Term Loan` | 4,154 | Delayed-draw term loan |
| `Schuldschein` | 3,590 | German-law promissory note (non-US) |
| `FRN (Bond-Style)` | 2,574 | Floating rate note (bond-style) |
| `Term Loan C` | 2,505 | Third-tier term loan |
| `Securitisation` | 2,487 | Securitization facility |

**Standard groupings for analysis:**

```python
TERM_LOANS = {'Term Loan', 'Term Loan A', 'Term Loan B', 'Term Loan C', 'Delay Draw Term Loan'}
REVOLVERS = {'Revolver/Line >= 1 Yr.', 'Revolver/Line < 1 Yr.', '364-Day Facility', 'Revolver/Term Loan'}
INSTITUTIONAL = {'Term Loan B', 'Term Loan C'}  # "institutional" tranches
BANK_LOANS = {'Term Loan A', 'Revolver/Line >= 1 Yr.'}  # "bank" tranches
```

**TL;A vs TL;B distinction**: Term Loan A ("TLA") is the bank tranche — lower spread, pro-rata amortization, held by relationship banks. Term Loan B ("TLB") is the institutional tranche — higher spread, bullet maturity, sold to CLOs, hedge funds, and other institutional investors. This is the most important structural distinction in leveraged finance.

## Primary Purpose Codes

| `primarypurpose` | Count | Description |
|------------------|-------|-------------|
| `Corp. purposes` | 166,209 | General corporate purposes |
| `Debt Repay.` | 44,899 | Debt repayment/refinancing |
| `Work. cap.` | 39,895 | Working capital |
| `Proj. finance` | 23,986 | Project finance |
| `LBO` | 21,965 | Leveraged buyout |
| `Acquis. line` | 20,245 | Acquisition financing |
| `Takeover` | 15,625 | Takeover financing |
| `Real estate` | 13,364 | Real estate financing |
| `Capital expend.` | 9,991 | Capital expenditure |
| `CP backup` | 5,857 | Commercial paper backup |
| `Recap.` | 4,154 | Recapitalization |
| `SBO` | 3,971 | Secondary buyout |
| `Dividend Recap` | 3,920 | Dividend recapitalization |
| `Debtor-in-poss.` | 1,261 | DIP financing (bankruptcy) |
| `Exit financing` | 537 | Post-bankruptcy exit |

**Standard groupings:**

```python
LBO_RECAP = {'LBO', 'SBO', 'MBO', 'Dividend Recap', 'Recap.'}
MA_PURPOSES = {'Acquis. line', 'Takeover', 'Merger'}
GENERAL_CORP = {'Corp. purposes', 'Work. cap.', 'CP backup'}
```

## Market Segment Indicators

The `dealscan.marketsegment` table is **multi-valued**: a single facility can have multiple segment tags. This is the primary mechanism for identifying leveraged, investment-grade, and institutional loans.

| `marketsegment` | Count | Description |
|-----------------|-------|-------------|
| `Non Investment Grade` | 125,932 | Below-IG borrower |
| `Leveraged` | 107,199 | Meets LPC leveraged definition |
| `M&A` | 63,744 | M&A-related facility |
| `U.S. Middle Market` | 60,435 | US middle-market borrower |
| `Sponsored` | 58,561 | PE-sponsored deal |
| `Highly Leveraged` | 56,183 | Highly leveraged (subset of Leveraged) |
| `Investment Grade` | 52,813 | Investment-grade borrower |
| `U.S. Traditional Middle Market` | 36,371 | Traditional US middle market |
| `Institutional` | 35,367 | Institutional tranche (TLB, etc.) |
| `LBO` | 26,430 | LBO-related |
| `Project Finance` | 25,501 | Project finance deal |
| `U.S. Large Middle Market` | 24,064 | Large US middle market |
| `Borrowing Base` | 13,865 | Asset-based borrowing base facility |
| `Covenant Lite` | 7,536 | Covenant-lite loan (no maintenance covenants) |
| `Asset Based` | 7,400 | Asset-based lending |
| `Second Lien` | 3,453 | Second-lien debt |
| `Unitranche` | 1,215 | Unitranche (combined senior + mezzanine) |
| `Green Loan` | 559 | Green/sustainability-linked loan |
| `ESG` | 381 | ESG-linked facility |
| `PIK` | 339 | Payment-in-kind |

## Distribution Methods

| `distributionmethod` | Count | Description |
|---------------------|-------|-------------|
| `Syndication` | 297,832 | Traditional syndication |
| `Club Deal` | 33,308 | Club deal (small group, no broad syndication) |
| `None` | 15,858 | Not specified |
| `Private Placement` | 14,285 | Private placement (generic) |
| `Sole Lender` | 12,991 | Single lender |
| `Bilateral` | 11,131 | Bilateral (two-party) |
| `Public Underwriting` | 4,424 | Publicly underwritten |
| **`Rule 144A Private Placement`** | **2,034** | **Rule 144A placement** |
| `Non-Rule 144A Private Placement` | 1,631 | Non-144A private placement |

## Leveraged vs Investment Grade Filter

DealScan has **no single column** for leveraged/IG classification.

**Normalized tables (through ~2020):** Use the `marketsegment` join table:

```python
leveraged_q = """
SELECT DISTINCT f.facilityid
FROM tr_dealscan.facility f
JOIN tr_dealscan.marketsegment ms ON f.facilityid = ms.facilityid
WHERE ms.marketsegment IN ('Leveraged', 'Highly Leveraged')
"""
```

**Flat table (all years through 2025):** Use `ILIKE` on the comma-separated `market_segment` string:

```python
leveraged_q = """
SELECT DISTINCT lpc_tranche_id
FROM tr_dealscan.dealscan
WHERE market_segment ILIKE '%%Leveraged%%'
"""

ig_q = """
SELECT DISTINCT lpc_tranche_id
FROM tr_dealscan.dealscan
WHERE market_segment ILIKE '%%Investment Grade%%'
"""
```

**Important**: Not every facility is tagged. Many smaller deals, non-US deals, and older deals have no market segment tags. The classification rate is higher for US syndicated deals post-2000.

## 144A / Institutional Tranche Filter

DealScan has limited 144A coverage compared to FISD (bonds). Use these approaches:

### 1. Distribution method (direct 144A flag)

```python
# Only ~2,034 facilities explicitly tagged as 144A
df_144a = df[df['distributionmethod'] == 'Rule 144A Private Placement']
```

### 2. Institutional tranche via market segment

```python
# More comprehensive: ~35,367 facilities tagged "Institutional"
# These are typically Term Loan B tranches sold to CLOs/hedge funds
inst_q = """
SELECT DISTINCT f.facilityid
FROM dealscan.facility f
JOIN dealscan.marketsegment ms ON f.facilityid = ms.facilityid
WHERE ms.marketsegment = 'Institutional'
"""
```

### 3. Loan type proxy

```python
# Term Loan B/C are de facto institutional tranches
INSTITUTIONAL_TYPES = {'Term Loan B', 'Term Loan C', 'FRN (Loan-Style)', 'FRN (Bond-Style)'}
```

**Bottom line**: DealScan's 144A flag is sparse. For securities regulation analysis of 144A private placements, use FISD (bonds) or SDC NI. DealScan is better for understanding the **institutional loan market** via the TLB/Institutional market segment.

## Canonical Query Patterns

### Annual US Syndicated Loan Origination (flat table, through 2025)

```python
import psycopg2, pandas as pd

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737, database='wrds', user='eddyhu', sslmode='require'
)

# Use the flat table for full coverage through 2025.
# IMPORTANT: Deduplicate by lpc_tranche_id (flat table has 1 row per lender).
query = """
WITH tranches AS (
    SELECT DISTINCT ON (lpc_tranche_id)
        lpc_tranche_id, lpc_deal_id, tranche_active_date,
        tranche_amount, tranche_amount_converted
    FROM tr_dealscan.dealscan
    WHERE country_of_syndication = 'United States'
      AND tranche_active_date BETWEEN %s AND %s
      AND tranche_amount > 0
    ORDER BY lpc_tranche_id, tranche_active_date
)
SELECT
    EXTRACT(YEAR FROM tranche_active_date)::int AS year,
    COUNT(*) AS n_tranches,
    COUNT(DISTINCT lpc_deal_id) AS n_deals,
    SUM(tranche_amount) / 1e3 AS volume_bn  -- tranche_amount is in MILLIONS
FROM tranches
GROUP BY year
ORDER BY year
"""
df = pd.read_sql(query, conn, params=('1990-01-01', '2025-12-31'))
```

### Loan Type Breakdown (Term Loan vs Revolver)

```python
# Uses the flat table with dedup CTE
query = """
WITH tranches AS (
    SELECT DISTINCT ON (lpc_tranche_id)
        lpc_tranche_id, tranche_active_date, tranche_amount, tranche_type
    FROM tr_dealscan.dealscan
    WHERE country_of_syndication = 'United States'
      AND tranche_active_date BETWEEN %s AND %s
      AND tranche_amount > 0
    ORDER BY lpc_tranche_id, tranche_active_date
)
SELECT
    EXTRACT(YEAR FROM tranche_active_date)::int AS year,
    CASE
        WHEN tranche_type LIKE 'Term Loan%%' OR tranche_type = 'Delay Draw Term Loan'
            THEN 'Term Loan'
        WHEN tranche_type LIKE 'Revolver%%' OR tranche_type = '364-Day Facility'
            THEN 'Revolver/Line'
        WHEN tranche_type = 'Bridge Loan' THEN 'Bridge Loan'
        ELSE 'Other'
    END AS loan_category,
    COUNT(*) AS n,
    SUM(tranche_amount) / 1e3 AS volume_bn
FROM tranches
GROUP BY year, loan_category
ORDER BY year
"""
```

### Market Segment (Leveraged vs IG) Breakdown

```python
# In the flat table, market_segment is a comma-separated string (not a join table).
# Use ILIKE for substring matching.
query = """
WITH tranches AS (
    SELECT DISTINCT ON (lpc_tranche_id)
        lpc_tranche_id, tranche_active_date, tranche_amount, market_segment
    FROM tr_dealscan.dealscan
    WHERE country_of_syndication = 'United States'
      AND tranche_active_date BETWEEN %s AND %s
      AND tranche_amount > 0
      AND market_segment IS NOT NULL
    ORDER BY lpc_tranche_id, tranche_active_date
)
SELECT
    EXTRACT(YEAR FROM tranche_active_date)::int AS year,
    CASE
        WHEN market_segment ILIKE '%%Investment Grade%%' THEN 'Investment Grade'
        WHEN market_segment ILIKE '%%Leveraged%%' THEN 'Leveraged'
        WHEN market_segment ILIKE '%%Institutional%%' THEN 'Institutional'
    END AS segment,
    COUNT(*) AS n,
    SUM(tranche_amount) / 1e3 AS volume_bn
FROM tranches
WHERE market_segment ILIKE '%%Investment Grade%%'
   OR market_segment ILIKE '%%Leveraged%%'
   OR market_segment ILIKE '%%Institutional%%'
GROUP BY year, segment
ORDER BY year
"""
```

### Top Lead Arrangers (League Table)

```python
# Use the flat table — one row per lender-tranche pair, so no dedup needed here.
# Filter on league_table_credit = 'Yes' for league table attribution.
query = """
SELECT
    lender_name AS arranger,
    COUNT(DISTINCT lpc_tranche_id) AS n_tranches,
    SUM(tranche_amount) / 1e3 AS volume_bn
FROM tr_dealscan.dealscan
WHERE league_table_credit = 'Yes'
  AND country_of_syndication = 'United States'
  AND tranche_active_date BETWEEN %s AND %s
  AND tranche_amount > 0
GROUP BY lender_name
ORDER BY volume_bn DESC
LIMIT 20
"""
```

### Using the Flat Table for All Years (recommended)

```python
# The normalized tables stop ~2020. The flat table covers 1981-2025.
# ALWAYS use the flat table for queries that need current data.
#
# Key differences from normalized tables:
#   - One row per LENDER-TRANCHE pair → must DISTINCT ON (lpc_tranche_id)
#   - tranche_amount in MILLIONS (not raw currency like facilityamt)
#   - country_of_syndication = 'United States' (not 'USA')
#   - market_segment is a comma-separated string (not a join table)
#   - primary_purpose values differ (e.g., 'General Purpose' not 'Corp. purposes')
#   - lpc_tranche_id (varchar) maps to facilityid (numeric) via ::numeric cast

query = """
WITH tranches AS (
    SELECT DISTINCT ON (lpc_tranche_id)
        lpc_tranche_id,
        lpc_deal_id,
        tranche_active_date,
        tranche_amount,                    -- millions of local currency
        tranche_amount_converted,          -- millions USD
        tranche_type,
        primary_purpose,
        market_segment,
        distribution_method,
        country_of_syndication
    FROM tr_dealscan.dealscan
    WHERE tranche_active_date BETWEEN %s AND %s
      AND tranche_amount > 0
      AND country_of_syndication = 'United States'
    ORDER BY lpc_tranche_id, tranche_active_date
)
SELECT
    EXTRACT(YEAR FROM tranche_active_date)::int AS year,
    COUNT(*) AS n_tranches,
    COUNT(DISTINCT lpc_deal_id) AS n_deals,
    SUM(tranche_amount) / 1e3 AS volume_bn
FROM tranches
GROUP BY year
ORDER BY year
"""
```

## Linking to Other Datasets

### DealScan -> Compustat (via WRDS Linking Table)

WRDS provides `wrdsapps_link_dealscan_wscope.dswslink` (17,444 rows) which links DealScan `companyid` to WorldScope `code`:

```python
link_q = """
SELECT l.companyid, l.company, l.code, l.cusip, l.isin, l.sic
FROM wrdsapps_link_dealscan_wscope.dswslink l
"""
```

For direct Compustat linking, the standard approach in academic literature (Chava & Roberts, 2008) uses the `dealscan.company.ticker` and `dealscan.company.primarysiccode` to fuzzy-match against `comp.company`:

```python
# Step 1: Get DealScan borrower info
ds_q = """
SELECT c.companyid, c.company, c.ticker, c.primarysiccode, c.state
FROM dealscan.company c
WHERE c.companyid = %s
"""
# Step 2: Match to Compustat via ticker or name
```

The **Michael Roberts DealScan-Compustat linking table** (available on his website) is the gold standard for academic work. It is NOT on WRDS but is widely used.

### DealScan -> FISD (bonds)

No direct link exists. Match via:
1. Borrower name -> Issuer name (fuzzy match)
2. `dealscan.company.ticker` -> `fisd_fisd.fisd_mergedissuer.cusip6` (via CRSP/Compustat intermediate)
3. Timing: DealScan loan close date near FISD offering date for same borrower

### DealScan -> SDC

No direct link. Match via borrower name + date proximity.

### DealScan -> CRSP

Via Compustat linking (DealScan -> Compustat -> CRSP permno).

## Coverage Notes & Quirks

- **Coverage start**: Sporadic data from 1981; comprehensive US coverage from ~1990; global coverage improves through 2000s.
- **LSEG migration (Aug 2021)**: DealScan moved from Thomson Reuters/Refinitiv to LSEG. Use `tr_dealscan` schema (LSEG > WRDS-LSEG DealScan path). The `dealscan` schema is a legacy alias pointing to the same data.
- **Normalized tables stop ~2020**: The `facility`, `package`, `lendershares`, `marketsegment`, and other normalized tables are **not populated after ~2020**. Only the flat table (`tr_dealscan.dealscan`) is actively updated quarterly through 2025. **Always use the flat table for current data.**
- **Flat table dedup**: The flat table has one row per **lender-tranche pair**. For tranche-level analysis, always `DISTINCT ON (lpc_tranche_id)`.
- **Amount units differ**: `facilityamt` (normalized) is in raw currency (dollars). `tranche_amount` (flat table) is in **millions** of local currency. Divide by 1,000 for billions.
- **Country naming differs**: Normalized: `countryofsyndication = 'USA'`. Flat table: `country_of_syndication = 'United States'`.
- **Market segment format differs**: Normalized: join to `marketsegment` table (multi-valued). Flat table: `market_segment` is a **comma-separated string** — use `ILIKE '%%Leveraged%%'` etc.
- **Purpose codes differ**: Normalized: `'Corp. purposes'`, `'Debt Repay.'`, `'LBO'`. Flat table: `'General Purpose'`, `'General Purpose/Refinance'`, `'Leveraged Buyout'`, `'Sponsored Buyout'`. Always check distinct values when migrating queries.
- **ID linking**: `lpc_tranche_id` (varchar in flat table) maps to `facilityid` (numeric in normalized) via `facilityid = lpc_tranche_id::numeric`. Similarly `lpc_deal_id` maps to `packageid`.
- **Chava-Roberts linking table stale**: `wrdsapps_link_dealscan_wscope.dswslink` stops ~2020. Needs manual extension for recent data.
- **Deal vs facility/tranche**: A single deal (`lpc_deal_id`/`packageid`) may have multiple tranches. Always be clear whether counting deals or tranches.
- **Lead arranger identification**: In flat table, use `league_table_credit = 'Yes'` for league table attribution. The `lead_arranger` column is a comma-separated string.
- **Secured flag**: `'Yes'`, `'No'`, or `'None'`. `'None'` means **unknown/not reported**, NOT unsecured. ~56% of facilities have `secured = 'None'`.
- **Seniority**: 99%+ are `'Senior'`. DealScan covers primarily senior secured and unsecured syndicated debt.
- **Covenant-lite tracking**: `'Covenant Lite'` market segment tag starts ~2005.
- **PE sponsors**: The `facilitysponsor` table (73,621 rows, through ~2020 only). In flat table, use `sponsored = 'Yes'` or `market_segment ILIKE '%%Sponsored%%'`.

## Validated Benchmarks

Annual US syndicated loan origination (from `tr_dealscan.dealscan` flat table, deduped to tranche level):

| Year | Tranches | Deals | Volume ($Bn) | Notes |
|------|----------|-------|-------------|-------|
| 1995 | 5,875 | 3,993 | $1,057 | Market growth |
| 2000 | 6,397 | 4,181 | $1,507 | Dot-com peak |
| 2005 | 7,519 | 4,554 | $2,191 | Pre-GFC credit boom |
| 2007 | 8,058 | 4,667 | $2,963 | Pre-GFC peak |
| 2009 | 3,867 | 2,670 | $1,756 | GFC trough |
| 2013 | 7,654 | 4,506 | $3,198 | Post-GFC recovery |
| 2018 | 9,038 | 4,641 | $4,072 | Pre-COVID peak |
| 2020 | 7,991 | 3,983 | $3,112 | COVID year (full year from flat table) |
| 2021 | 10,271 | 5,087 | $4,747 | Post-COVID boom |
| 2022 | 8,262 | 4,400 | $4,526 | Rate hike slowdown |
| 2023 | 7,452 | 3,832 | $3,863 | Higher-for-longer |
| 2024 | 9,495 | 4,691 | $5,679 | Recovery |
| 2025 | 10,460 | 5,476 | $6,181 | Record volume (partial year) |

**Key structural facts:**
- Term loans and revolvers each account for ~40-45% of volume; bridge loans ~5-10%
- General corporate/working capital is the largest purpose (~50%+); LBO/M&A combined ~20-30%
- Syndication dominates distribution (75%+); club deals ~8%; 144A placements are <1% of loan volume
- Top 5 US arrangers (JPMorgan, BofA, Citi, Wells Fargo, Barclays) collectively arrange >50% of US syndicated loans
- Leveraged loan volume roughly matches investment-grade volume in boom years; IG dominates in recessions
- Institutional (TLB) tranche volume grew dramatically 2004-2007 and again 2012-2019

## DealScan vs Other Databases

| Database | Best For | Loan Coverage | Bond Coverage | 144A Flag |
|----------|----------|--------------|---------------|-----------|
| **DealScan** (`tr_dealscan.dealscan`) | Syndicated loans, leveraged finance | Comprehensive (1990-2025 via flat table) | None | Sparse (~2K facilities) |
| **FISD** (`fisd_fisd.fisd_mergedissue`) | Corporate bonds, 144A analysis | None | Comprehensive (1983-present) | Clean (`rule_144a = 'Y'`) |
| **SDC NI** (`sdc.wrds_ni_details`) | All capital markets issuance | Limited | Yes (incl. structured) | Via `market` field |
| **PitchBook** (`pitchbk.deal`) | Private credit, PE/VC deals | Private credit only | None | None |

**When to use DealScan vs alternatives:**
- **Syndicated loan analysis** -> DealScan (it's the only comprehensive source)
- **144A bond analysis** -> FISD (DealScan's 144A coverage is minimal)
- **Leveraged finance (loans + bonds)** -> DealScan (loans) + FISD (HY bonds)
- **Full capital markets picture** -> SDC NI (broadest) supplemented by DealScan for loan details
