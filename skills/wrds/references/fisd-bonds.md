# FISD / Mergent — Fixed Income Securities Database

## Contents

- [Overview](#overview)
- [Tables](#tables)
- [fisd_fisd.fisd_mergedissue Key Columns](#fisd_fisdfisd_mergedissue-key-columns)
- [fisd_fisd.fisd_mergedissuer Key Columns](#fisd_fisdfisd_mergedissuer-key-columns)
- [Bond Type Codes](#bond-type-codes)
- [Rule 144A vs Registered Filter](#rule-144a-vs-registered-filter)
- [Investment Grade vs High Yield Classification](#investment-grade-vs-high-yield-classification)
- [Canonical Query Patterns](#canonical-query-patterns)
- [Standard Issuance Count Query](#standard-issuance-count-query)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Coverage Notes & Quirks](#coverage-notes--quirks)
- [Validated Benchmarks](#validated-benchmarks)

## Overview

Mergent FISD (Fixed Income Securities Database), now maintained by LSEG Mergent, covers over **140,000 US corporate, agency, and Treasury debt securities** with 550+ data fields per issue. On WRDS, it is the primary source for:

- Annual corporate bond issuance counts (IG vs HY, 144A vs registered)
- Bond-level characteristics for event studies (covenant package, rating, seniority)
- Linking to TRACE (bond transaction data) for pricing
- Capital markets practice area sizing (Rule 144A activity dominates investment-grade corporate bond market)

| Resource | Schema.Table | Description |
|----------|-------------|-------------|
| Issue characteristics | `fisd_fisd.fisd_mergedissue` | 1 row per bond issue (9-digit CUSIP) |
| Issuer characteristics | `fisd_fisd.fisd_mergedissuer` | 1 row per issuer (SIC, country) |
| Ratings history | `fisd_fisd.fisd_ratings` | Time-series of Moody's/S&P/Fitch ratings |
| Prospectus filings | `fisd_fisd.fisd_issue` | Issue-level data (alternative to mergedissue) |

## Tables

```python
# Verify available FISD tables
cur.execute("""
    SELECT table_name,
           pg_size_pretty(pg_total_relation_size('fisd_fisd.'||table_name)) AS size
    FROM information_schema.tables
    WHERE table_schema = 'fisd_fisd'
    ORDER BY table_name
""")
for row in cur.fetchall(): print(row)
```

## fisd_fisd.fisd_mergedissue Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `issue_id` | int | Unique issue identifier (Mergent primary key) |
| `issuer_id` | int | Links to `fisd_mergedissuer.issuer_id` |
| `complete_cusip` | varchar(9) | 9-digit CUSIP (most important join key) |
| `offering_date` | date | Date of bond issuance / pricing |
| `dated_date` | date | Date from which interest accrues |
| `maturity` | date | Maturity date |
| `offering_amt` | numeric | Offering amount ($ millions) |
| `coupon` | numeric | Annual coupon rate (%) |
| `coupon_type` | varchar(1) | `'F'`=fixed, `'V'`=variable, `'Z'`=zero coupon, `'S'`=step-up |
| `interest_frequency` | varchar | `'0'`=none, `'1'`=annual, `'2'`=semi-annual, `'4'`=quarterly, `'12'`=monthly |
| `bond_type` | varchar | Security type code (see Bond Type Codes below) |
| `rule_144a` | varchar(1) | `'Y'`=Rule 144A offering, `'N'`=registered/public |
| `private_placement` | varchar(1) | `'Y'`=private placement (non-144A), `'N'`=public |
| `security_level` | varchar | `'SEN'`=senior unsecured, `'SEN_SEC'`=senior secured, `'SUB'`=subordinated |
| `convertible` | varchar(1) | `'Y'`=convertible bond |
| `callable` | varchar(1) | `'Y'`=callable |
| `putable` | varchar(1) | `'Y'`=putable |
| `yankee` | varchar(1) | `'Y'`=Yankee bond (foreign issuer, US market, USD) |
| `canadian` | varchar(1) | `'Y'`=Canadian issuer |
| `foreign_currency` | varchar(1) | `'Y'`=non-USD denomination |
| `asset_backed` | varchar(1) | `'Y'`=asset-backed security |
| `defaulted` | varchar(1) | `'Y'`=currently in default |
| `filing_date` | date | Bankruptcy filing date (if defaulted) |
| `settlement` | date | Settlement date (if defaulted) |
| `exchange` | varchar | Exchange where listed (NULL if OTC) |
| `slob` | varchar(1) | `'Y'`=secured lease obligation bond |
| `security_pledge` | varchar | Collateral description (NULL if unsecured) |
| `pay_in_kind` | varchar(1) | `'Y'`=PIK bond (interest paid in additional bonds) |
| `perpetual` | varchar(1) | `'Y'`=no stated maturity |
| `preferred_security` | varchar(1) | `'Y'`=preferred security (trust preferred, etc.) |
| `unit_deal` | varchar(1) | `'Y'`=issued as part of a unit |
| `exchangeable` | varchar(1) | `'Y'`=exchangeable into equity |
| `defeased` | varchar(1) | `'Y'`=defeased/economically retired early |
| `defeased_date` | date | Date of defeasance |
| `last_interest_date` | date | Last coupon payment date |

> **Note**: `moody_rating`, `sp_rating`, and `fitch_rating` are **NOT columns in `fisd_mergedissue`**. Ratings are in the separate `fisd_fisd.fisd_ratings` table — join on `issue_id`. See [Investment Grade vs High Yield Classification](#investment-grade-vs-high-yield-classification) for the correct join pattern.

## fisd_fisd.fisd_mergedissuer Key Columns

| Column | Type | Description |
|--------|------|-------------|
| `issuer_id` | int | Unique issuer identifier |
| `issuer_name` | varchar | Issuer name |
| `sic_code` | varchar | SIC industry code |
| `country_domicile` | varchar | Country of issuer domicile (`'USA'` for domestic) |
| `issuer_type` | varchar | `'C'`=corporation, `'M'`=municipality, `'S'`=sovereign, etc. |
| `cusip6` | varchar(6) | 6-digit issuer CUSIP |

## Bond Type Codes

| `bond_type` | Description | Notes |
|-------------|-------------|-------|
| `'CDEB'` | Corporate Debenture | Standard unsecured corporate bond |
| `'CMTN'` | Corporate Medium-Term Note | MTN program issuances (registered) |
| `'CMTZ'` | Corporate MTN Zero Coupon | Zero coupon MTN |
| `'CZ'` | Corporate Zero Coupon | Zero coupon corporate bond |
| `'USBN'` | US Bank Note | Senior bank obligations |
| `'CMNT'` | Corporate MTN (floating) | Floating-rate MTN |
| `'CABS'` | Corporate Asset-Backed Security | Structured/securitized |
| `'CCOV'` | Corporate Covered Bond | Covered bonds |
| `'AGOV'` | Agency Government | Federal agency (Fannie, Freddie, etc.) |
| `'CFRN'` | Corporate Floating Rate Note | Variable rate corporate |

**Standard "plain vanilla" corporate bond filter** (used in most academic studies — e.g., Tidy Finance):
```python
PLAIN_VANILLA_TYPES = {'CDEB', 'CMTN', 'CMTZ', 'CZ', 'USBN'}
```

## Rule 144A vs Registered Filter

Rule 144A is the dominant mechanism for investment-grade and high-yield bond issuance. In a typical year, ~70–80% of high-yield bonds and ~40–50% of investment-grade bonds are issued under 144A (often with registration rights).

```python
# 144A bonds (institutional market)
df_144a = df[df['rule_144a'] == 'Y']

# Registered (SEC-registered, public market)
df_registered = df[
    (df['rule_144a'] == 'N') &
    (df['private_placement'] != 'Y')
]

# All corporate bonds including 144A (for issuance counting)
df_all_corporate = df[
    df['bond_type'].isin({'CDEB', 'CMTN', 'CMTZ', 'CZ', 'USBN', 'CFRN'}) &
    (df['yankee'] != 'Y') &
    (df['canadian'] != 'Y') &
    (df['foreign_currency'] != 'Y') &
    (df['asset_backed'] != 'Y') &
    (df['convertible'] != 'Y') &
    (df['preferred_security'] != 'Y') &
    (df['defeased'] != 'Y') &
    (df['perpetual'] != 'Y')
]
```

## Investment Grade vs High Yield Classification

Ratings are **not in `fisd_mergedissue`**. They are in `fisd_fisd.fisd_ratings`:

| Column | Values | Description |
|--------|--------|-------------|
| `issue_id` | int | Join key to `fisd_mergedissue.issue_id` |
| `rating_type` | `'MR'`=Moody's, `'SPR'`=S&P, `'FR'`=Fitch, `'DPR'`=D&P | Agency |
| `rating_date` | date | Date rating was assigned |
| `rating` | e.g. `'Baa2'`, `'BBB-'` | Rating string |
| `investment_grade` | `'Y'` / `'N'` / NULL | Pre-computed IG flag |
| `rating_status` | `'A'`=active, `'T'`=terminated | Use `'A'` for current |

### Joining ratings at issuance

Pick the rating closest to (but not after) `offering_date` for each agency:

```python
query_rated = """
WITH rated AS (
    SELECT DISTINCT ON (r.issue_id, r.rating_type)
        r.issue_id,
        r.rating_type,
        r.rating,
        r.investment_grade
    FROM fisd_fisd.fisd_ratings r
    JOIN fisd_fisd.fisd_mergedissue i USING (issue_id)
    WHERE r.rating_date <= i.offering_date
      AND r.rating_type IN ('MR', 'SPR')
    ORDER BY r.issue_id, r.rating_type, r.rating_date DESC
),
moody AS (SELECT issue_id, rating AS moody_rating, investment_grade AS moody_ig
          FROM rated WHERE rating_type = 'MR'),
sp    AS (SELECT issue_id, rating AS sp_rating,    investment_grade AS sp_ig
          FROM rated WHERE rating_type = 'SPR')
SELECT
    EXTRACT(YEAR FROM i.offering_date)::int AS issue_year,
    i.rule_144a,
    CASE
        WHEN m.moody_ig = 'Y' OR s.sp_ig = 'Y' THEN 'IG'
        WHEN m.moody_ig = 'N' OR s.sp_ig = 'N' THEN 'HY'
        ELSE 'NR'
    END AS rating_cat,
    COUNT(*)              AS n_issues,
    SUM(i.offering_amt)/1e3 AS proceeds_bn
FROM fisd_fisd.fisd_mergedissue i
JOIN fisd_fisd.fisd_mergedissuer u ON u.issuer_id = i.issuer_id
LEFT JOIN moody m USING (issue_id)
LEFT JOIN sp    s USING (issue_id)
WHERE u.country_domicile = 'USA'
  AND i.bond_type IN ('CDEB','CMTN','CMTZ','CZ','USBN')
  AND (i.yankee = 'N' OR i.yankee IS NULL)
  AND (i.foreign_currency = 'N' OR i.foreign_currency IS NULL)
  AND (i.asset_backed = 'N' OR i.asset_backed IS NULL)
  AND (i.convertible = 'N' OR i.convertible IS NULL)
  AND (i.preferred_security = 'N' OR i.preferred_security IS NULL)
  AND i.offering_date BETWEEN %s AND %s
  AND i.offering_amt > 0
GROUP BY issue_year, i.rule_144a, rating_cat
ORDER BY issue_year, rating_cat, i.rule_144a
"""
df_rated = pd.read_sql(query_rated, conn, params=('2000-01-01', '2026-12-31'))
```

**Split-rated convention**: "at least one IG agency = IG" (use `moody_ig='Y' OR sp_ig='Y'`). For the lower-rating convention, require both: `moody_ig='Y' AND sp_ig='Y'`.

## Canonical Query Patterns

### Annual US Corporate Bond Issuances (all types)

```python
import psycopg2, pandas as pd

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737, database='wrds', user='eddyhu', sslmode='require'
)

query = """
SELECT
    EXTRACT(YEAR FROM i.offering_date)::int  AS issue_year,
    i.rule_144a,
    i.coupon_type,
    i.bond_type,
    COUNT(*)                                 AS n_issues,
    SUM(i.offering_amt) / 1e3               AS total_proceeds_bn,
    AVG(i.coupon)                            AS avg_coupon,
    AVG(EXTRACT(YEAR FROM i.maturity) -
        EXTRACT(YEAR FROM i.offering_date))  AS avg_maturity_yrs
FROM fisd_fisd.fisd_mergedissue i
JOIN fisd_fisd.fisd_mergedissuer u ON i.issuer_id = u.issuer_id
WHERE u.country_domicile = 'USA'
  AND i.bond_type IN ('CDEB','CMTN','CMTZ','CZ','USBN','CFRN')
  AND (i.yankee = 'N' OR i.yankee IS NULL)
  AND (i.canadian = 'N' OR i.canadian IS NULL)
  AND (i.foreign_currency = 'N' OR i.foreign_currency IS NULL)
  AND (i.asset_backed = 'N' OR i.asset_backed IS NULL)
  AND (i.convertible = 'N' OR i.convertible IS NULL)
  AND (i.preferred_security = 'N' OR i.preferred_security IS NULL)
  AND (i.defeased = 'N' OR i.defeased IS NULL)
  AND i.offering_date BETWEEN %s AND %s
  AND i.offering_amt IS NOT NULL
  AND i.offering_amt > 0
GROUP BY issue_year, i.rule_144a, i.coupon_type, i.bond_type
ORDER BY issue_year, i.rule_144a
"""
df = pd.read_sql(query, conn, params=('1990-01-01', '2024-12-31'))
```

### Annual Counts by IG/HY and 144A Status

See the join pattern in [Investment Grade vs High Yield Classification](#investment-grade-vs-high-yield-classification). The `query_rated` there produces the correct `df_rated` with columns `issue_year`, `rule_144a`, `rating_cat`, `n_issues`, `proceeds_bn`.

## Standard Issuance Count Query

For clean **annual 144A vs registered bond issuance counts** (practice area sizing):

```python
# Simple annual count: 144A vs registered, IG vs HY
pivot = (df_rated
    .assign(category=lambda d: d['rating_cat'] + '_' + d['rule_144a'].map({'Y':'144A','N':'Reg'}))
    .pivot_table(index='issue_year', columns='category',
                 values=['n_issues','proceeds_bn'], aggfunc='sum')
    .fillna(0)
)
```

**Expected output shape** (per year):
- `IG_144A` — investment-grade 144A (largest dollar volume)
- `IG_Reg` — investment-grade registered
- `HY_144A` — high-yield 144A (largest count)
- `HY_Reg` — high-yield registered (smaller)
- `NR_*` — unrated

## Linking to Other Datasets

### FISD → TRACE (bond trading data)

```python
# TRACE tables: trace.trace_enhanced (enhanced clean data)
# Join on complete_cusip (9-digit)
trace_query = """
    SELECT t.cusip_id, t.trd_exctn_dt, t.entrd_vol_qt, t.rptd_pr
    FROM trace.trace_enhanced t
    WHERE t.cusip_id = ANY(%s)
      AND t.trd_exctn_dt BETWEEN %s AND %s
"""
```

### FISD → Compustat (via 6-digit CUSIP)

```python
link_query = """
    SELECT s.gvkey, s.cusip, c.conm
    FROM comp.security s
    JOIN comp.company c USING (gvkey)
    WHERE s.cusip = ANY(%s)
"""
# Match fisd_fisd.fisd_mergedissuer.issuer_cusip to comp.security.cusip (6-char)
```

### FISD → CRSP Bond / WRDS Linking

```python
# WRDS maintains a bond-CRSP linking table
# Check wrds_linking schema
link_query = """
    SELECT l.cusip, l.permno, l.gvkey
    FROM crsp.bondlink l     -- name may vary; check wrds_linking schema
    WHERE l.cusip = ANY(%s)
"""
```

## Coverage Notes & Quirks

- **Coverage start**: Comprehensive for publicly registered US corporate bonds from ~1983. 144A bonds tracked from ~1990 (Rule 144A enacted April 1990).
- **offering_amt units**: Values in **$ millions**. A $500M bond = `offering_amt = 500`.
- **Rating at issuance**: `moody_rating` and `sp_rating` are ratings at issuance, not current ratings. Use `fisd.fisd_ratings` for time-series if needed.
- **MTN programs**: `bond_type = 'CMTN'` includes medium-term note program takedowns. Each takedown is a separate row even if same issuer/program. MTNs are legitimate but can inflate "number of offerings" counts — consider filtering `offering_amt >= 25` to exclude very small takedowns.
- **Shelf offerings**: Registered bonds issued off shelf registration statements are in FISD. These are more common post-2005 and are legally pre-registered, just not marketed at specific time.
- **Missing ratings**: ~20–30% of bonds lack a rating at issuance, especially smaller/private company issuers. `NR` does not mean junk — could be investment-quality unrated issuer.
- **144A with registration rights**: Most 144A deals have a "registration rights agreement" requiring the issuer to file a registration statement within 6–12 months (an "A/B exchange offer"). FISD shows the original 144A offering date.
- **Dedup**: `issue_id` is unique. Each row = one bond series. No dedup needed.

## Validated Benchmarks

Annual US non-financial corporate bond issuance (plain vanilla IG + HY):

| Year | IG Issues | HY Issues | IG $Bn | HY $Bn | Notes |
|------|-----------|-----------|--------|--------|-------|
| 2000 | ~450 | ~200 | ~$400Bn | ~$60Bn | Pre-dot-com crash |
| 2005 | ~600 | ~400 | ~$600Bn | ~$150Bn | Credit boom |
| 2009 | ~700 | ~150 | ~$750Bn | ~$50Bn | Post-GFC IG surge |
| 2012 | ~900 | ~600 | ~$900Bn | ~$200Bn | ZIRP era |
| 2020 | ~1,400 | ~700 | ~$1.5Tn | ~$300Bn | COVID liquidity |
| 2021 | ~1,100 | ~900 | ~$1.2Tn | ~$400Bn | Record HY |
| 2022 | ~600 | ~300 | ~$600Bn | ~$80Bn | Rate hike freeze |

**Rule 144A share of issuance**: ~50–60% of IG bond count, ~70–80% of HY bond count in most years. This is the dominant capital markets product by volume.

**Practice area implication**: US investment-grade and high-yield debt capital markets (primarily 144A) produce more lawyer work by number of transactions than all other capital markets products combined. A single large law firm may close 100+ 144A bond deals per year vs. 20–30 IPOs.
