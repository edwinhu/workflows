# Compustat Data Access

## Contents

- [Overview](#overview)
- [Key Tables](#key-tables)
- [Common Query Patterns](#common-query-patterns)
- [Bank-Specific Data](#bank-specific-data)
- [Data Quality Notes](#data-quality-notes)
- [Linking Tables](#linking-tables)

## Overview

Compustat provides fundamental financial data for public companies. Accessed via the `comp` schema in WRDS PostgreSQL.

## Key Tables

### Company Information

#### comp.company
Master company identifier table.

| Field | Type | Description |
|-------|------|-------------|
| `gvkey` | varchar(6) | Global Company Key (primary identifier) |
| `conm` | varchar(100) | Company name |
| `cik` | varchar(10) | SEC CIK number |
| `sic` | varchar(4) | Standard Industrial Classification |
| `naics` | varchar(6) | NAICS industry code |
| `state` | varchar(2) | State of incorporation |
| `fic` | varchar(3) | Foreign incorporation code |
| `add1`-`add4` | varchar | Address lines |
| `city` | varchar(50) | City |
| `ipodate` | date | IPO date |
| `dldte` | date | Deletion date (if delisted) |

```python
# Find company by name
cursor.execute("""
    SELECT gvkey, conm, cik, sic
    FROM comp.company
    WHERE UPPER(conm) LIKE %s
    ORDER BY conm
    LIMIT 10
""", ('%SILICON VALLEY%',))
```

### Annual Fundamentals

#### comp.funda
Annual financial statements (10-K data).

##### Standard Filters (ALWAYS INCLUDE)
```sql
WHERE indfmt = 'INDL'   -- Industrial format (vs FS for financials)
  AND datafmt = 'STD'   -- Standardized format
  AND popsrc = 'D'      -- Domestic population
  AND consol = 'C'      -- Consolidated statements
```

##### Key Fields

| Field | Description | Notes |
|-------|-------------|-------|
| `gvkey` | Company identifier | Link to comp.company |
| `datadate` | Fiscal year end date | |
| `fyear` | Fiscal year | |
| `fyr` | Fiscal year-end month | 12 = December |
| `at` | Total assets | |
| `lt` | Total liabilities | |
| `seq` | Stockholders' equity | |
| `ceq` | Common equity | |
| `revt` | Total revenue | |
| `sale` | Net sales | |
| `cogs` | Cost of goods sold | |
| `xsga` | SG&A expense | |
| `dp` | Depreciation & amortization | |
| `xint` | Interest expense | |
| `txt` | Income taxes | |
| `ni` | Net income | |
| `oibdp` | Operating income before D&A | |
| `oiadp` | Operating income after D&A | |
| `ib` | Income before extraordinary items | |
| `che` | Cash and short-term investments | |
| `rect` | Receivables | |
| `invt` | Inventories | |
| `ppent` | Property, plant & equipment (net) | |
| `dltt` | Long-term debt | |
| `dlc` | Debt in current liabilities | |
| `csho` | Common shares outstanding | Millions |
| `prcc_f` | Price close (fiscal year end) | |
| `mkvalt` | Market value | At fiscal year end |
| `emp` | Employees | Thousands |

```python
# Get annual fundamentals for multiple companies
gvkeys = ['001045', '001078', '002285']

cursor.execute("""
    SELECT gvkey, datadate, fyear, at, lt, seq, revt, ni
    FROM comp.funda
    WHERE gvkey = ANY(%s)
      AND datadate >= %s
      AND indfmt = 'INDL'
      AND datafmt = 'STD'
      AND popsrc = 'D'
      AND consol = 'C'
    ORDER BY gvkey, datadate
""", (gvkeys, '2018-01-01'))
```

### Quarterly Fundamentals

#### comp.fundq
Quarterly financial statements (10-Q data).

Same filter requirements as `comp.funda`. Key differences:

| Field | Description |
|-------|-------------|
| `fqtr` | Fiscal quarter (1-4) |
| `rdq` | Report date of quarterly earnings |
| `atq` | Total assets (quarterly) |
| `ltq` | Total liabilities (quarterly) |
| `revtq` | Revenue (quarterly) |
| `niq` | Net income (quarterly) |

```python
# Get quarterly data
cursor.execute("""
    SELECT gvkey, datadate, fqtr, revtq, niq
    FROM comp.fundq
    WHERE gvkey = %s
      AND datadate >= %s
      AND indfmt = 'INDL'
      AND datafmt = 'STD'
      AND popsrc = 'D'
      AND consol = 'C'
    ORDER BY datadate
""", ('001045', '2020-01-01'))
```

### Security Data

#### comp.secm (Monthly)
Monthly security prices and returns.

| Field | Description |
|-------|-------------|
| `gvkey` | Company identifier |
| `datadate` | Month end date |
| `prccm` | Price close (monthly) |
| `trt1m` | Monthly total return |
| `cshom` | Shares outstanding |

#### comp.secd (Daily)
Daily security prices.

| Field | Description |
|-------|-------------|
| `gvkey` | Company identifier |
| `datadate` | Trading date |
| `prccd` | Price close (daily) |
| `ajexdi` | Adjustment factor |
| `cshtrd` | Trading volume |

### Segment Data

#### comp.segment
Business segment data.

| Field | Description |
|-------|-------------|
| `gvkey` | Company identifier |
| `stype` | Segment type (BUSSEG, GEOSEG, OPSEG) |
| `sid` | Segment identifier |
| `srcdate` | Source date |
| `snms` | Segment name |
| `sales` | Segment sales |

## Common Query Patterns

### Company Lookup by CIK

```python
def get_company_by_cik(pool, cik: str) -> dict | None:
    """Find company by CIK number."""
    # Normalize CIK to 10 digits
    cik_normalized = cik.zfill(10)

    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT gvkey, conm, cik, sic, naics
            FROM comp.company
            WHERE cik = %s
        """, (cik_normalized,))

        row = cursor.fetchone()
        if row:
            return {
                'gvkey': row[0],
                'name': row[1],
                'cik': row[2],
                'sic': row[3],
                'naics': row[4]
            }
        return None
```

### Financial Ratios

```python
def get_financial_ratios(pool, gvkey: str, start_date: str):
    """Calculate key financial ratios from Compustat data."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                gvkey,
                datadate,
                fyear,
                -- Profitability
                ni / NULLIF(revt, 0) AS net_margin,
                ni / NULLIF(at, 0) AS roa,
                ni / NULLIF(seq, 0) AS roe,
                -- Leverage
                lt / NULLIF(at, 0) AS debt_to_assets,
                (dltt + dlc) / NULLIF(seq, 0) AS debt_to_equity,
                -- Liquidity
                che / NULLIF(at, 0) AS cash_ratio,
                -- Valuation
                mkvalt / NULLIF(ni, 0) AS pe_ratio,
                mkvalt / NULLIF(seq, 0) AS pb_ratio
            FROM comp.funda
            WHERE gvkey = %s
              AND datadate >= %s
              AND indfmt = 'INDL'
              AND datafmt = 'STD'
              AND popsrc = 'D'
              AND consol = 'C'
            ORDER BY datadate
        """, (gvkey, start_date))

        return cursor.fetchall()
```

### Industry Comparison

```python
def get_industry_peers(pool, sic: str, year: int) -> list:
    """Get companies in same SIC industry for comparison."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                c.gvkey,
                c.conm,
                f.revt,
                f.at,
                f.ni
            FROM comp.company c
            JOIN comp.funda f ON c.gvkey = f.gvkey
            WHERE c.sic = %s
              AND f.fyear = %s
              AND f.indfmt = 'INDL'
              AND f.datafmt = 'STD'
              AND f.popsrc = 'D'
              AND f.consol = 'C'
            ORDER BY f.at DESC
            LIMIT 50
        """, (sic, year))

        return cursor.fetchall()
```

### Time Series Panel Data

```python
def get_panel_data(pool, gvkeys: list, start_year: int, end_year: int):
    """Get panel data for multiple companies across years."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                gvkey,
                fyear,
                datadate,
                at,
                lt,
                seq,
                revt,
                ni,
                che,
                prcc_f * csho AS market_cap
            FROM comp.funda
            WHERE gvkey = ANY(%s)
              AND fyear BETWEEN %s AND %s
              AND indfmt = 'INDL'
              AND datafmt = 'STD'
              AND popsrc = 'D'
              AND consol = 'C'
            ORDER BY gvkey, fyear
        """, (gvkeys, start_year, end_year))

        return cursor.fetchall()
```

## Bank-Specific Data

For banks (SIC 60xx), use `comp.bank` tables or apply `indfmt = 'FS'`:

```python
def get_bank_data(pool, gvkey: str, start_date: str):
    """Get bank financial data (financial services format)."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT
                gvkey,
                datadate,
                at,           -- Total assets
                dptc,         -- Total deposits
                lntal,        -- Total loans
                nii,          -- Net interest income
                nim,          -- Net interest margin
                npl,          -- Non-performing loans
                tier1,        -- Tier 1 capital ratio
                roa,          -- Return on assets
                roe           -- Return on equity
            FROM comp.funda
            WHERE gvkey = %s
              AND datadate >= %s
              AND indfmt = 'FS'  -- Financial services format
              AND datafmt = 'STD'
              AND popsrc = 'D'
              AND consol = 'C'
            ORDER BY datadate
        """, (gvkey, start_date))

        return cursor.fetchall()
```

## Data Quality Notes

1. **Missing values**: Many fields are NULL; always use `NULLIF()` in divisions
2. **Restatements**: Use `datadate` for point-in-time; `rdq` shows when reported
3. **Currency**: North American data in USD; global in local currency
4. **Fiscal years**: `fyear` is fiscal year; `datadate` is fiscal year end
5. **Industry codes**: SIC being replaced by NAICS; check both

## Linking Tables

### CRSP-Compustat Link

```python
def get_crsp_permno(pool, gvkey: str) -> str | None:
    """Get CRSP PERMNO for a Compustat GVKEY."""
    with pool.cursor() as cursor:
        cursor.execute("""
            SELECT lpermno
            FROM crsp.ccmxpf_linkhist
            WHERE gvkey = %s
              AND linktype IN ('LC', 'LU')
              AND linkprim IN ('P', 'C')
            ORDER BY linkdt DESC
            LIMIT 1
        """, (gvkey,))

        row = cursor.fetchone()
        return row[0] if row else None
```
