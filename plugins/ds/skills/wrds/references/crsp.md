# CRSP Stock Data

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

## Common Gotchas

1. **Negative prices** - Absolute value needed: `abs(prc)`
2. **Delisting returns** - CIZ format includes in time series (no separate adjustment)
3. **Link dates** - Always check `linkdt` and `linkenddt` bounds
4. **Primary links** - Use `linkprim IN ('P', 'C')` for primary links only
5. **Share classes** - Aggregate to PERMCO for company-level market cap
