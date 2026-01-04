# LSEG Data vs WRDS Comparison

A guide for researchers familiar with WRDS who need to work with LSEG data, and vice versa.

## Overview

| Aspect | WRDS | LSEG Data Library |
|--------|------|-------------------|
| **Access** | SQL queries via `wrds` package | Python API via `lseg.data` |
| **Data model** | Relational tables | Instruments + fields |
| **Identifiers** | PERMNO, GVKEY, CUSIP | RIC, ISIN, SEDOL |
| **Coverage focus** | US-centric, academic | Global, real-time capable |
| **Update frequency** | Batch (daily/monthly) | Real-time to daily |

## Identifier Mapping

### Primary Identifiers

| WRDS | LSEG | Notes |
|------|------|-------|
| PERMNO | RIC | CRSP permanent number vs Reuters Instrument Code |
| GVKEY | OrgId | Compustat company key vs LSEG Organization ID |
| CUSIP | CUSIP | Same standard, can convert directly |
| TICKER | Ticker | Exchange-specific |

### Converting Between Systems

```python
# LSEG: Convert CUSIP to RIC
from lseg.data.content import symbol_conversion

result = symbol_conversion.Definition(
    symbols=['037833100'],  # Apple CUSIP
    from_symbol_type='CUSIP',
    to_symbol_types=['RIC', 'ISIN']
).get_data()
```

```python
# WRDS: Get CUSIP from PERMNO
import wrds

db = wrds.Connection()
query = """
    SELECT permno, cusip, ncusip
    FROM crsp.msenames
    WHERE permno = 14593
"""
df = db.raw_sql(query)
```

## Data Coverage Comparison

### Company Fundamentals

| Data Item | WRDS (Compustat) | LSEG |
|-----------|------------------|------|
| Revenue | `revt` (funda) | `TR.RevenueActValue` |
| Net Income | `ni` (funda) | `TR.NetIncomeActValue` |
| Total Assets | `at` (funda) | `TR.TotalAssetsReported` |
| EPS | `epspx` (funda) | `TR.EPSActValue` |
| Book Value | `ceq` (funda) | `TR.TotalEquity` |

### Pricing Data

| Data Item | WRDS (CRSP) | LSEG |
|-----------|-------------|------|
| Close Price | `prc` (dsf) | `TR.PriceClose` / `CLOSE` |
| Return | `ret` (dsf) | Calculate from prices |
| Volume | `vol` (dsf) | `TR.Volume` / `VOLUME` |
| Bid/Ask | `bid`, `ask` (dsf) | `BID`, `ASK` |
| Market Cap | `prc * shrout` | `TR.CompanyMarketCap` |

### ESG Data

| Data Item | WRDS | LSEG |
|-----------|------|------|
| ESG Score | MSCI ESG / Sustainalytics | `TR.TRESGScore` |
| Environmental | Varies by provider | `TR.EnvironmentPillarScore` |
| Social | Varies by provider | `TR.SocialPillarScore` |
| Governance | Varies by provider | `TR.GovernancePillarScore` |

## Code Examples: Same Task, Both Platforms

### Get Annual Revenue for Tech Companies

**WRDS (Compustat):**
```python
import wrds

db = wrds.Connection()

query = """
    SELECT gvkey, datadate, fyear, tic, revt, ni
    FROM comp.funda
    WHERE tic IN ('AAPL', 'MSFT', 'GOOGL')
      AND fyear >= 2020
      AND indfmt = 'INDL'
      AND datafmt = 'STD'
      AND popsrc = 'D'
      AND consol = 'C'
    ORDER BY tic, fyear
"""
df = db.raw_sql(query)
```

**LSEG:**
```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O'],
    fields=['TR.RevenueActValue', 'TR.NetIncomeActValue'],
    parameters={
        'SDate': '2020-01-01',
        'EDate': '2024-12-31',
        'Period': 'FY'
    }
)

ld.close_session()
```

### Get Daily Stock Prices

**WRDS (CRSP):**
```python
import wrds

db = wrds.Connection()

query = """
    SELECT a.permno, a.date, a.prc, a.ret, a.vol
    FROM crsp.dsf a
    JOIN crsp.msenames b ON a.permno = b.permno
    WHERE b.ticker = 'AAPL'
      AND a.date BETWEEN '2023-01-01' AND '2023-12-31'
    ORDER BY date
"""
df = db.raw_sql(query)
```

**LSEG:**
```python
import lseg.data as ld

ld.open_session()

df = ld.get_history(
    universe='AAPL.O',
    fields=['OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME'],
    start='2023-01-01',
    end='2023-12-31'
)

ld.close_session()
```

### Get ESG Scores

**WRDS (MSCI ESG via KLD):**
```python
import wrds

db = wrds.Connection()

query = """
    SELECT ticker, year, cgov_str_num, cgov_con_num,
           com_str_num, com_con_num, env_str_num, env_con_num
    FROM kld.history
    WHERE ticker IN ('AAPL', 'MSFT', 'XOM')
      AND year >= 2020
"""
df = db.raw_sql(query)
```

**LSEG:**
```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'XOM'],
    fields=[
        'TR.TRESGScore',
        'TR.EnvironmentPillarScore',
        'TR.SocialPillarScore',
        'TR.GovernancePillarScore'
    ]
)

ld.close_session()
```

## Key Differences to Note

### 1. Date Handling

**WRDS:** Fiscal year end dates, period end dates in tables
```python
# fyear = fiscal year
# datadate = fiscal period end date
```

**LSEG:** Use parameters to specify periods
```python
# 'Period': 'FY' for fiscal year
# 'Period': 'FQ0' for current fiscal quarter
# 'SDate', 'EDate' for date ranges
```

### 2. Adjusted vs Unadjusted Prices

**WRDS (CRSP):** Separate fields
```python
# prc = price (may be negative if bid/ask average)
# ret = return (split-adjusted)
# cfacpr = cumulative adjustment factor
```

**LSEG:** Adjustments as parameters
```python
df = ld.get_history(
    'AAPL.O',
    adjustments=['split', 'dividend']  # Specify adjustments
)
```

### 3. Missing Data

**WRDS:** NULL values in SQL
```sql
WHERE revt IS NOT NULL
```

**LSEG:** NaN in DataFrame
```python
df = df.dropna(subset=['TR.RevenueActValue'])
```

### 4. Universe Construction

**WRDS:** Query tables to build universe
```python
# Get S&P 500 constituents
query = """
    SELECT gvkey, iid, from, thru
    FROM comp.idxcst_his
    WHERE gvkeyx = '000003'  -- S&P 500
"""
```

**LSEG:** Use chain RICs or indices
```python
# Get S&P 500 constituents
df = ld.get_data(
    universe='0#.SPX',  # Chain RIC for S&P 500
    fields=['TR.CompanyName', 'TR.PriceClose']
)
```

## Strengths by Platform

### When to Use WRDS

- **Historical academic research**: Longer history, cleaner backfilled data
- **US-focused analysis**: CRSP/Compustat gold standard for US
- **Linking databases**: PERMNO-GVKEY links well established
- **Reproducibility**: Static datasets, consistent across researchers
- **Complex SQL**: Join multiple tables, complex filters

### When to Use LSEG

- **Global coverage**: Better international data
- **Real-time needs**: Streaming quotes, intraday data
- **ESG data**: Comprehensive ESG coverage and history
- **Quick lookups**: API faster than SQL for simple queries
- **News and sentiment**: Rich unstructured data

## Migration Tips

### From WRDS to LSEG

1. **Map identifiers first**: Convert PERMNO/GVKEY to RIC
2. **Validate data**: Compare values for overlapping periods
3. **Check field definitions**: Same name may mean different things
4. **Handle periodicity**: LSEG fiscal periods may differ

### From LSEG to WRDS

1. **Get CUSIP from LSEG**: Use symbology conversion
2. **Link to PERMNO**: Use CRSP msenames table
3. **Verify coverage**: Not all LSEG instruments in WRDS
4. **Adjust for timing**: WRDS may have lag in updates

## See Also

- [SKILL.md](SKILL.md) - LSEG main documentation
- [modules/symbology.md](modules/symbology.md) - Identifier conversion
- [../wrds/SKILL.md](../wrds/SKILL.md) - WRDS skill documentation
