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
| `tfn.s12` (SAS) / `tr_mutualfunds.s12` (PG) | Fund-level stock holdings | fundno-rdate-cusip |

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

## ETL Performance Notes

### 13-F Institutional Ownership (S34)

**Recommended approach:** PostgreSQL with per-year server-side CTEs. Each year's CTE joins s34type1 + s34type3 + CUSIP mapping and aggregates to permno-quarter, returning ~30–50K rows. Total: 674K rows in 5.2 minutes for 2002–2024.

**Key settings:** `SET work_mem = '256MB'` and `SET statement_timeout = '3600s'` before querying.

**Anti-pattern:** Downloading raw s34type3 holdings locally — recent years (2020+) have millions of rows and can OOM the compute node.

### Mutual Fund Holdings (S12)

**Recommended approach:** SAS with SGE parallelism + PostgreSQL for bulk reads. The MFLINKS join chain (fundno → wficn → crsp_fundno → portnomap) creates large intermediates that PostgreSQL cannot store (read-only, no temp tables), so SAS handles the ETL. But the initial S12 read uses PostgreSQL to avoid NFS contention.

**Working pipeline:** `examples/voting_ownership_pipeline/` in the WRDS skill — see `README.md` for architecture, `run_pipeline.sh` for orchestration.

**Pipeline pattern:**
1. SAS: Build mfl2/mfl3 prereqs (`build_mflinks.sas`, ~1 min)
2. SAS: Read S12 via PostgreSQL, write year-range partitions to /scratch (`split_s12.sas`, ~15 min)
3. SAS: 9 parallel SGE jobs reading /scratch partitions (`tfn_holdings_parallel.sas`), each doing MFLINKS join + CUSIP→PERMNO + TSO + permno-quarter aggregation → small `mf_own_YYYY_YYYY.sas7bdat`
4. SAS: Merge all outputs (`merge_panel.sas`)

**NFS contention:** `tfn.s12` is 44GB on NFS. Running 7+ parallel SAS jobs reading it causes each to take ~40 min instead of ~5 min. The `split_s12.sas` step reads via WRDS PostgreSQL (`tr_mutualfunds.s12`) — a single sequential read through the database, no NFS contention. Partitions total ~40GB on /scratch (check quota before running).

**Year range balancing:** S12 data exploded from ~4M rows/year (2003-2016) to ~20-26M rows/year (2018-2024). Year ranges must be balanced by row count, not year count: 2003-2010 (34M), 2011-2016 (27M), 2017-2018 (30M), then 1 year each for 2019-2024 (~22-27M each).

**PostgreSQL schema mapping:** SAS `tfn.s12` → PostgreSQL `tr_mutualfunds.s12`. SAS `tfn.s34` → PostgreSQL `tr_13f.s34`. Connection via `PROC SQL; CONNECT TO POSTGRES (server='wrds-pgdata-ident-w.wharton.private' port=9737 ...)`. Credentials in `~/.pgpass`.

**Critical lesson:** SAS must aggregate to permno-quarter before outputting. If SAS outputs raw fund-level holdings (millions of rows, 1–12GB per chunk), Python will OOM reading the SAS7BDAT files.

**Why PostgreSQL fails for the full S12 ETL:**
- Read-only: cannot `CREATE TEMP TABLE` for the MFLINKS chain
- Full join query (s12 × mflink2 × mflink1 × portnomap) is too complex for the query planner
- But PostgreSQL works well for the initial bulk read with server-side WHERE filtering

See `postgres-vs-sas.md` for the full decision framework.

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
