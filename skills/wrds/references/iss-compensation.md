# ISS Incentive Lab Compensation Data

## Contents

- [Tables](#tables)
- [Key Fields](#key-fields)
- [Grain & Keys](#grain--keys)
- [Query Patterns](#query-patterns)
- [Related: Compustat ExecuComp](#related-compustat-execucomp)
- [Related: Capital IQ Compensation](#related-capital-iq-compensation)
- [Common Use Cases](#common-use-cases)

## Tables

| Table | Description |
|-------|-------------|
| `iss_incentive_lab.comppeer` | Peer company designations |
| `iss_incentive_lab.sumcomp` | Summary compensation |
| `iss_incentive_lab.participantfy` | Participant fiscal year data |

## Key Fields

### comppeer (Peer Companies)
- `ticker` - Company ticker
- `companyname` - Company name
- `fiscalyear` - Fiscal year
- `peerticker` - Peer company ticker
- `peername` - Peer company name
- `peercik` - Peer company CIK

### sumcomp (Summary Compensation)
- `ticker` - Company ticker
- `fiscalyear` - Fiscal year
- `execid` - Executive identifier
- `salary` - Base salary
- `bonus` - Cash bonus
- `stock_awards` - Stock award value
- `option_awards` - Option award value
- `total_comp` - Total compensation

## Grain & Keys

Declare the grain before aggregating — these tables are firm-year panels and a wrong key
double-counts or merges the wrong firm. Verify each with `df.duplicated(subset=PK).sum() == 0`.

| Table | Row grain (primary key) | Notes |
|-------|-------------------------|-------|
| `comppeer` | `(cik, fiscalyear, peercik)` — one focal-firm × year × peer | A peer list is many rows; use `SELECT DISTINCT` when you only want the peer set for a year |
| `sumcomp` | `(cik, fiscalyear, execid)` — one executive × firm-year | One summary-comp row per exec-year; `SUM`ming without grouping by execid conflates executives |
| `participantfy` | `(cik, fiscalyear, participantid)` — participant identity per firm-year | Names/roles live here; join to `sumcomp` on the participant + year key |

**Firm key: use CIK, not ticker.** CIK is the stable identifier — **zero-pad to 10 digits**
(e.g. `'0000000001'`) when joining to EDGAR/other CIK sources. Tickers recycle and change over
time (a real wrong-firm / duplicate trap; this is why peer matching here is CIK-based).

**Grant-level fan-out:** Incentive Lab also carries award/grant-level detail. If you join `sumcomp`
(exec-year grain) to a grant-level table, the grain becomes per-grant — do NOT then sum exec-level
totals (you'll multiply by the grant count). Aggregate grants to exec-year first, or keep grains separate.

## Query Patterns

### Get Peer Companies
```python
sql = """
    SELECT
        fiscalyear,
        ticker,
        companyname,
        peerticker,
        peername,
        peercik
    FROM iss_incentive_lab.comppeer
    WHERE ticker = 'XXXX'
      AND fiscalyear IN (2020, 2021, 2022)
    ORDER BY fiscalyear, peername
"""
peers = pd.read_sql(sql, conn)
```

### Summary Compensation
```python
sql = """
    SELECT *
    FROM iss_incentive_lab.sumcomp
    WHERE ticker = 'AAPL'
      AND fiscalyear >= 2020
    ORDER BY fiscalyear DESC
"""
```

### Peer Group Analysis
```python
# Get all peers for a company, then query their compensation
peers_sql = """
    SELECT DISTINCT peerticker
    FROM iss_incentive_lab.comppeer
    WHERE ticker = %s
      AND fiscalyear = %s
"""
peers = pd.read_sql(peers_sql, conn, params=(ticker, year))
peer_tickers = tuple(peers['peerticker'].tolist())

# Get compensation for all peers
comp_sql = """
    SELECT *
    FROM iss_incentive_lab.sumcomp
    WHERE ticker = ANY(%s)
      AND fiscalyear = %s
"""
peer_comp = pd.read_sql(comp_sql, conn, params=(list(peer_tickers), year))
```

## Related: Compustat ExecuComp

For additional executive compensation data, use Compustat ExecuComp:

```python
sql = """
    SELECT
        gvkey, ticker, year,
        co_per_rol, exec_fullname,
        titleann, ceoann, cfoann,
        tdc1 as total_compensation,
        salary, bonus, stock_awards, option_awards
    FROM comp_execucomp.anncomp
    WHERE ticker IN ('IBM', 'MSFT', 'AAPL')
      AND ceoann = 'CEO'
      AND year >= 2020
    ORDER BY ticker, year
"""
```

### ExecuComp Tables
| Table | Description |
|-------|-------------|
| `comp_execucomp.anncomp` | Annual compensation |
| `comp.planbasedawards` | Stock/option grants (FAS 123R) |
| `comp.outstandingawards` | Outstanding awards |

## Related: Capital IQ Compensation

```python
sql = """
    SELECT *
    FROM ciq.wrds_compensation
    WHERE companyname ILIKE '%Apple%'
    LIMIT 100
"""
```

## Common Use Cases

### CEO Pay Trends
```python
sql = """
    SELECT
        ticker,
        fiscalyear,
        SUM(total_comp) as ceo_total_comp
    FROM iss_incentive_lab.sumcomp
    WHERE ticker = %s
      AND title ILIKE '%CEO%'
    GROUP BY ticker, fiscalyear
    ORDER BY fiscalyear
"""
```

### Peer Comparison
```python
# 1. Get peer group
# 2. Query compensation for focal company and peers
# 3. Calculate percentile ranking
```
