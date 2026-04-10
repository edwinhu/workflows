# CRSP Stock Data

## Contents

- [Tables](#tables)
- [Key Fields](#key-fields)
- [CRSP v2 Filters](#crsp-v2-filters)
- [CRSP-Compustat Merge (CCM)](#crsp-compustat-merge-ccm)
- [Market Equity](#market-equity)
- [Fama-French Breakpoints](#fama-french-breakpoints)
- [Common Gotchas](#common-gotchas)

## Tables

### Legacy Format
| Table | Description |
|-------|-------------|
| `crsp.dsf` | Daily stock file |
| `crsp.msf` | Monthly stock file |
| `crsp.dse` | Daily stock events |
| `crsp.stocknames` | Security names/identifiers |
| `crsp.ccmxpf_linkhist` | CRSP-Compustat link |

### v2 (CIZ) Format
| Table | Description |
|-------|-------------|
| `crsp.dsf_v2` | Daily stock file (CIZ) |
| `crsp.msf_v2` | Monthly stock file (CIZ) |
| `crsp.stocknames_v2` | Security names (CIZ) |

## Key Fields

### Stock Files (dsf/msf)
- `permno` - Permanent security identifier
- `permco` - Permanent company identifier
- `date` / `mthcaldt` - Date
- `ret` / `mthret` - Return
- `prc` / `mthprc` - Price (negative = bid/ask average)
- `vol` - Volume
- `shrout` - Shares outstanding

### v2 Additional Fields
- `sharetype` - Share type (NS=Normal Shares)
- `securitytype` - Security type (EQTY=Equity)
- `securitysubtype` - Subtype (COM=Common)
- `usincflg` - US incorporated flag
- `issuertype` - Issuer type (ACOR, CORP)
- `primaryexch` - Primary exchange (N, A, Q)
- `conditionaltype` - Conditional type (RW=Real When-issued)
- `tradingstatusflg` - Trading status (A=Active)

## CRSP v2 Filters

### Common Stock (equivalent to shrcd 10, 11)
```python
df = df.loc[
    (df.sharetype == 'NS') &
    (df.securitytype == 'EQTY') &
    (df.securitysubtype == 'COM') &
    (df.usincflg == 'Y') &
    (df.issuertype.isin(['ACOR', 'CORP']))
]
```

### NYSE/AMEX/NASDAQ (equivalent to exchcd 1, 2, 3)
```python
df = df.loc[
    (df.primaryexch.isin(['N', 'A', 'Q'])) &
    (df.conditionaltype == 'RW') &
    (df.tradingstatusflg == 'A')
]
```

## CRSP-Compustat Merge (CCM)

### Link Table Fields
- `gvkey` - Compustat identifier
- `lpermno` - CRSP PERMNO
- `lpermco` - CRSP PERMCO
- `linktype` - Link type (LC, LU, etc.)
- `linkprim` - Primary link flag (P, C)
- `linkdt` - Link start date
- `linkenddt` - Link end date (NULL = current)

### Standard CCM Merge
```python
sql = """
    SELECT a.gvkey, a.datadate, a.at, a.sale,
           b.lpermno as permno, c.mthret
    FROM comp.funda a
    INNER JOIN crsp.ccmxpf_linkhist b
        ON a.gvkey = b.gvkey
        AND b.linktype IN ('LU', 'LC')
        AND b.linkprim IN ('P', 'C')
        AND a.datadate >= b.linkdt
        AND (a.datadate <= b.linkenddt OR b.linkenddt IS NULL)
    INNER JOIN crsp.msf_v2 c
        ON b.lpermno = c.permno
        AND DATE_TRUNC('month', a.datadate) = DATE_TRUNC('month', c.mthcaldt)
    WHERE a.fyear >= 2020
    AND a.indfmt = 'INDL'
    AND a.datafmt = 'STD'
    AND a.popsrc = 'D'
    AND a.consol = 'C'
"""
```

### Link Type Reference
| Code | Description |
|------|-------------|
| LC | Link research complete |
| LU | Link unresearched |
| LX | Link to inactive issue |
| LD | Duplicate link |
| LS | Secondary link |
| LN | Non-matching link |

### CCM Date Collapse
Consolidate consecutive link date ranges:
```python
df['prev_linkenddt'] = df.groupby(['gvkey', 'lpermno'])['linkenddt'].shift()
df['linkdt'] = np.where(
    (df['prev_linkenddt'].notna()) &
    (df['linkdt'] <= df['prev_linkenddt'] + pd.Timedelta(days=1)),
    df.groupby(['gvkey', 'lpermno'])['linkdt'].transform('first'),
    df['linkdt']
)
collapsed = df.drop_duplicates(subset=['gvkey', 'lpermno', 'linkdt'], keep='last')
```

## Market Equity

```python
# Calculate market equity
crsp['me'] = abs(crsp['mthprc']) * crsp['shrout']

# Aggregate to PERMCO level (sum across share classes)
crsp_summe = crsp.groupby(['mthcaldt', 'permco'])['me'].sum().reset_index()
```

## Fama-French Breakpoints

Use NYSE stocks only for breakpoints:
```python
nyse = ccm[(ccm['primaryexch'] == 'N') &
           (ccm['beme'] > 0) &
           (ccm['me'] > 0)]

# Size breakpoint (median)
nyse_sz = nyse.groupby('jdate')['me'].median()

# B/M breakpoints (30th, 70th percentile)
nyse_bm = nyse.groupby('jdate')['beme'].describe(percentiles=[0.3, 0.7])
```

## Market Index Tables

| Table | Description |
|-------|-------------|
| `crsp.msi` | Monthly market index (vwretd, ewretd) |
| `crsp.dsi` | Daily market index |

### Annual Stock Performance (Market-Adjusted)

```python
# Log returns, calendar year, require ≥10 months
merged["log_ret"] = np.log(1 + merged["ret"])
merged["log_vwretd"] = np.log(1 + merged["vwretd"])

annual = merged.groupby(["permno", "year"]).agg(
    firm_log_ret=("log_ret", lambda x: x.sum() if x.notna().sum() >= 10 else np.nan),
    idx_log_ret=("log_vwretd", lambda x: x.sum() if x.notna().sum() >= 10 else np.nan),
)
stock_performance = firm_log_ret - idx_log_ret  # market-adjusted
```

### 60-Month Rolling Volatility

```python
# Rolling std of monthly returns, annualized
group["vol_monthly"] = group["ret"].rolling(window=60, min_periods=24).std()
volatility = vol_monthly * np.sqrt(12)
# Take December value for each permno-year
```

**Lookback**: To compute volatility starting in year Y, pull monthly data from Y-5.

### Year-End Market Cap

```python
mktcap = abs(prc) * shrout  # in $thousands (shrout is in thousands)
# Use December observation
```

## Common Gotchas

1. **Negative prices** - Absolute value needed: `abs(prc)`
2. **Delisting returns** - CIZ format includes in time series (no separate adjustment)
3. **Link dates** - Always check `linkdt` and `linkenddt` bounds; `linkenddt` can be NULL (still active)
4. **Primary links** - Use `linkprim IN ('P', 'C')` for primary links only
5. **Share classes** - Aggregate to PERMCO for company-level market cap
6. **Lookback for volatility** — if your sample starts 1996, pull returns from 1991 for 60-month window
7. **December selection** — for annual variables (vol, mktcap), use December month-end obs
8. **`ret` includes dividends** — this is total return, not price return
9. **`shrout` units** — thousands of shares, not raw shares
10. **Duplicate CCM links** — some gvkey-fyear pairs match multiple permnos; deduplicate (keep first or largest)
