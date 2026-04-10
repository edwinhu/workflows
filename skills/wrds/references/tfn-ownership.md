# Thomson Reuters / Refinitiv Institutional Ownership & Mutual Fund Holdings

WRDS PostgreSQL reference for 13-F institutional holdings (S34) and mutual fund holdings (S12), including MFLINKS and CRSP mutual fund integration.

## Tables

### 13-F Institutional Holdings

| Table | Description | Grain |
|-------|-------------|-------|
| `tfn.s34type1` | Manager-quarter header | mgrno-rdate-fdate |
| `tfn.s34type3` | Stock-level holdings | mgrno-fdate-cusip |

**s34type1 fields:** `rdate` (report date), `fdate` (file/vintage date), `mgrno`, `mgrname`

**s34type3 fields:** `fdate`, `mgrno`, `cusip`, `shares`, `type`, `sole`, `shared`, `no`

### Mutual Fund Holdings (S12)

| Table | Description | Grain |
|-------|-------------|-------|
| `tfn.s12` | Fund-level stock holdings | fundno-rdate-cusip |

**s12 fields:** `rdate`, `fdate`, `fundno`, `cusip`, `shares`, `fundname`

### MFLINKS

| Table | Description |
|-------|-------------|
| `mfl.mflink1` | TFN fundno -> wficn -> CRSP crsp_fundno |
| `mfl.mflink2` | TFN fundno -> wficn (with rdate alignment) |

**mflink1 fields:** `wficn`, `crsp_fundno`, `fundno`

**mflink2 fields:** `wficn`, `fundno`, `rdate` (use this for date-aligned joins)

### CRSP Mutual Fund Tables

| Table | Description |
|-------|-------------|
| `crsp.portnomap` | crsp_fundno -> crsp_portno mapping with date ranges (`begdt`, `enddt`), `index_fund_flag`, `et_flag` |
| `crsp.fund_fees` | Expense ratios by crsp_fundno with date ranges |
| `crsp.fund_summary` | Monthly TNA and returns |
| `crsp.fund_hdr` | Fund header (`mgmt_name`, `fund_name`, `ticker`) |

## Building 13-F Institutional Ownership

### Step 1: First vintage per manager-quarter

```sql
SELECT DISTINCT rdate, fdate, mgrno, mgrname
FROM tfn.s34type1
GROUP BY mgrno, rdate
HAVING fdate = MIN(fdate)
ORDER BY mgrno, rdate
```

### Step 2: Merge with holdings

```sql
SELECT a.rdate, a.fdate, a.mgrno, a.numinst,
       a.first_report, a.last_report,
       b.permno, a.shares
FROM first_vint a
INNER JOIN tfn.s34type3 b ON a.fdate = b.fdate AND a.mgrno = b.mgrno
-- Map cusip to permno via crsp.msenames
INNER JOIN (
    SELECT DISTINCT ncusip, permno FROM crsp.msenames
    WHERE ncusip IS NOT NULL
) c ON b.cusip = c.ncusip
WHERE b.shares > 0
```

### Step 3: Adjust shares via CRSP factors

```python
shares_adj = shares * cfacshr  # CRSP adjustment factor aligned at vintage date
```

### Step 4: Aggregate to permno-quarter

```python
# Key output variables
IO_total = shares_adj_sum           # total institutional shares held
IOR = IO_total / TSO                # institutional ownership ratio (0-1)
NumOwners = count(distinct mgrno)
IOC_HHI = sum((shares_i / IO_total) ** 2)  # concentration
```

## Building Mutual Fund Holdings (TFN S12 -> CRSP MF)

### Linking chain: TFN fundno -> wficn -> crsp_fundno -> crsp_portno

```sql
-- Step 1: Link TFN S12 to MFLINKS (date-aligned)
SELECT b.wficn, b.crsp_fundno, c.crsp_portno,
       a.rdate, a.fdate, a.fundno, a.cusip, a.shares, a.fundname,
       c.index_fund_flag, c.et_flag
FROM tfn.s12 a
INNER JOIN mfl.mflink2 b  -- or out.mfl2 if pre-built
  ON a.fundno = b.fundno AND a.rdate = b.rdate
INNER JOIN crsp.portnomap c
  ON b.crsp_fundno = c.crsp_fundno
  AND a.rdate >= c.begdt AND a.rdate <= c.enddt
WHERE b.wficn IS NOT NULL AND c.crsp_fundno IS NOT NULL AND a.shares > 0
```

### Passive/Index fund classification

Use CRSP `index_fund_flag` plus regex on fundname:

```python
passive = (index_fund_flag != '') | bool(re.search(
    r'Index|Idx|Indx|Ind |Russell|S \& P|S and P|S&P|SP|Dow|DJ|'
    r'MSCI|Bloomberg|KBW|Nasdaq|NYSE|STOXX|FTSE|Wilshire|Morningstar|'
    r'[14569]00|(10|15|20|50)00',
    fundname, re.IGNORECASE
))
pure_index = (index_fund_flag == 'D')
```

### Aggregate to permno-quarter

```python
# Map cusip to permno via crsp.msenames, adjust shares by cfacshr
# Then aggregate:
MF_TOTAL = sum(shares_adj)                      # total MF shares
PASSIVE_TOTAL = sum(shares_adj * passive)        # passive fund shares
PURE_INDEX_TOTAL = sum(shares_adj * pure_index)
MF_PCT = MF_TOTAL / TSO                         # bound 0-1
PASSIVE_PCT = PASSIVE_TOTAL / TSO
INDEX_PCT = PURE_INDEX_TOTAL / TSO
EXP_RATIO_VW = sum(exp_ratio * shares_adj) / sum(shares_adj)  # value-weighted
```

## Merging Ownership with Meetings/Events

Use an as-of merge: for each event (by permno + recorddate), find the most recent ownership quarter:

```python
# pandas merge_asof
ownership = ownership.sort_values(['permno', 'rdate'])
events = events.sort_values(['permno', 'recorddate'])
merged = pd.merge_asof(
    events, ownership,
    left_on='recorddate', right_on='rdate',
    by='permno', direction='backward'
)
```

## Common Gotchas

1. **Vintage dates** -- s34type1 has multiple fdate per rdate (restatements); keep the earliest fdate.
2. **First/last report flags** -- track gaps in 13-F reporting; useful for clean time-series analysis.
3. **CUSIP is historical** -- map through `crsp.msenames.ncusip`, not the current CUSIP.
4. **IOR > 1** -- can happen due to timing mismatches between 13-F and CRSP shares outstanding; cap at 1.0 (or filter > 1.2).
5. **S12 data coverage** -- starts ~2003, drops off in 2024; check year-by-year counts.
6. **Deduplication** -- after all joins, dedup by `(wficn, crsp_portno, crsp_fundno, rqdate, cusip8)`.
7. **CRSP adjustment factors** -- align `cfacshr` at the vintage date (fdate), not the report date.
8. **mflink2 vs mflink1** -- mflink2 has rdate for date-aligned joins; mflink1 is static mapping with wficn and crsp_fundno.
9. **portnomap date ranges** -- always filter rdate between begdt and enddt.
10. **exp_ratio sentinel** -- value of -99 means missing in `crsp.fund_fees`; replace with NULL.
