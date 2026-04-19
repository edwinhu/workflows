# Thomson Reuters Form 4 Insider Data

## Contents

- [Tables](#tables)
- [Key Fields](#key-fields)
- [Rolecode Reference](#rolecode-reference)
- [Transaction Codes](#transaction-codes)
- [Query Patterns](#query-patterns)
- [Common Gotchas](#common-gotchas)

## Tables

| Table | Description |
|-------|-------------|
| `tr_insiders.table1` | Form 4 transactions (trades) |
| `tr_insiders.table2` | Derivative holdings |
| `tr_insiders.header` | Insider identity and role codes |
| `tr_insiders.company` | Company identifiers |
| `tr_insiders.form144` | Form 144 filings |

## Key Fields

### table1 (Transactions)
- `ticker` - Stock ticker
- `dcn` - Document control number (links to header)
- `personid` - Person identifier (links to header)
- `fdate` - Filing date
- `trandate` - Transaction date
- `trancode` - Transaction code (S=Sale, P=Purchase, etc.)
- `acqdisp` - A=Acquisition, D=Disposition
- `shares` - Number of shares
- `tprice` - Transaction price per share
- `sharesheld` - Shares held after transaction
- `ownership` - D=Direct, I=Indirect

### header (Insider Info)
- `dcn` - Document control number
- `personid` - Person identifier
- `owner` - Insider name
- `rolecode1`, `rolecode2`, `rolecode3` - Role codes

## Rolecode Reference

### C-Suite Executives
| Code | Role |
|------|------|
| CEO | Chief Executive Officer |
| CFO | Chief Financial Officer |
| COO | Chief Operating Officer |
| CT | Chief Technology Officer |
| GC | General Counsel |
| P | President |
| CI | Chief Investment Officer |
| CO | Chief Operating Officer |

### Senior Officers
| Code | Role |
|------|------|
| EVP | Executive Vice President |
| SVP | Senior Vice President |
| OE | Other Executive Officer |
| OS | Other Senior Officer |

### Directors
| Code | Role |
|------|------|
| D | Director |
| CB | Chairman of the Board |
| VC | Vice Chairman |
| OD | Officer and Director |
| DO | Director and Officer |

### Other
| Code | Role |
|------|------|
| O | Officer |
| C | Controller |
| F | Financial Officer |
| FO | Financial Officer |
| S | Secretary |
| B | 10% Beneficial Owner |
| H | 10% Holder |

## Transaction Codes

| Code | Description |
|------|-------------|
| S | Open market sale |
| P | Open market purchase |
| D | Disposition (non-open market) |
| A | Grant/award |
| G | Gift |
| F | Tax payment (shares withheld) |
| M | Exercise of derivative |
| C | Conversion |
| J | Other acquisition |
| K | Equity swap |

## Query Patterns

### Executive Stock Disposals
```python
sql = """
    SELECT DISTINCT
        t.ticker,
        t.fdate as filing_date,
        t.trandate as transaction_date,
        h.owner as insider_name,
        CASE
            WHEN h.rolecode1 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'P')
                 OR h.rolecode2 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'P')
            THEN 'Executive Officer'
            WHEN h.rolecode1 IN ('EVP', 'SVP', 'OE', 'OS')
                 OR h.rolecode2 IN ('EVP', 'SVP', 'OE', 'OS')
            THEN 'Senior Officer'
            WHEN h.rolecode1 IN ('D', 'CB', 'VC')
                 OR h.rolecode2 IN ('D', 'CB', 'VC')
            THEN 'Director'
            ELSE 'Other'
        END as insider_role,
        t.trancode,
        t.acqdisp,
        t.shares as trans_shares,
        t.tprice as price_per_share,
        t.sharesheld as shares_held_after
    FROM tr_insiders.table1 t
    LEFT JOIN tr_insiders.header h
        ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE t.ticker = 'AAPL'
      AND t.trandate BETWEEN '2020-01-01' AND '2023-12-31'
      AND t.acqdisp = 'D'
      AND t.trancode IN ('S', 'D', 'G', 'F')
      AND t.shares IS NOT NULL
    ORDER BY t.trandate DESC
"""
```

### All Insider Activity for Company
```python
sql = """
    SELECT
        t.ticker,
        t.trandate,
        h.owner,
        t.trancode,
        t.acqdisp,
        t.shares,
        t.tprice,
        t.shares * t.tprice as transaction_value
    FROM tr_insiders.table1 t
    LEFT JOIN tr_insiders.header h
        ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE t.ticker = %s
      AND t.trandate >= %s
      AND t.shares IS NOT NULL
    ORDER BY t.trandate DESC
"""
```

### Filter for Executives Only
```python
executive_roles = (
    'CEO', 'CFO', 'COO', 'CT', 'GC', 'P', 'CI', 'CO',
    'EVP', 'SVP', 'OE', 'OS'
)

sql = f"""
    SELECT *
    FROM tr_insiders.table1 t
    JOIN tr_insiders.header h ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE (h.rolecode1 IN {executive_roles}
           OR h.rolecode2 IN {executive_roles}
           OR h.rolecode3 IN {executive_roles})
"""
```

## Common Gotchas

1. **Multiple rolecodes** - Check all three rolecode fields (rolecode1, rolecode2, rolecode3)
2. **Null shares** - Filter `WHERE shares IS NOT NULL AND shares != 0`
3. **Transaction value** - Calculate as `shares * tprice`
4. **Direct vs Indirect** - `ownership = 'D'` for direct holdings only
5. **Join keys** - Use both `dcn` AND `personid` when joining table1 to header

## Bulk extraction for panel construction

`tr_insiders.table1` is **17.3M rows / 5.5 GB** — unsafe for a naive `SELECT *`.
The Volkova blockholders port (script 8) needs per-year aggregation, so
we pull bulk via SAS on the WRDS SGE cluster rather than streaming over
Postgres from a laptop.

- SAS script: `mirror/sas/pull_tr_insiders.sas` — one year per SGE task.
- SGE wrapper: `mirror/sas/run_insider_array.sh` (`#$ -t 1994-2024 -l m_mem_free=8G`).
- Fallback Python puller for quick iteration:
  `mirror/scripts/pull_insider_ownership.py` (server-side filters, year chunking).

### Index hints used server-side

| Filter | Pattern | Why |
|--------|---------|-----|
| `fdate` | `between "01jan&year."d and "31dec&year."d` | Uses the fdate index; NEVER `year(fdate)=` |
| `formtype` | `in ('3','4','5')` | Drops ~1.5M NaN rows |
| `sectitle` | `= 'COM'` | Common stock only (Volkova filter) |
| `cusip6` | `inner join out.cusip6_whitelist` | Scopes to ~12K issuers in panel universe |
| `sharesheld` | `is not null` | Volkova's formula requires non-null holdings |

### Per-year row counts (2019-2024, cusip6 pruned to ~12K)

| Year | Raw TR rows | Panel add-on rows (>5%) |
|------|---|---|
| 2019 | 274,480 | 2,196 |
| 2020 | 255,147 | 2,376 |
| 2021 | 304,022 | 2,767 |
| 2022 | 277,620 | 2,273 |
| 2023 | 276,889 | 2,122 |
| 2024 | 309,053 | 1,929 |
| **Total** | **1,697,211** | **13,663** |

### Ship/aggregate ratio

~125× reduction (1.7M raw rows → 13,663 add-on rows). This justifies pushing
aggregation into SAS server-side (vs pulling all rows to Python). If the
universe were expanded to all 40K CRSP issuers, raw rows triple but the
add-on still lands near 15-18K — so `cusip6_whitelist` pruning is
cost-effective.

### Quick Volkova-style formula

```
prc_own = 100 * sharesheld / (1000 * shrout)   -- shrout is in thousands
max_prc = max(prc_own) per (cusip6, personid, year)
panel rows: keep where max_prc > 5
```

Shares in `tr_insiders.table1.sharesheld` are raw share counts (not thousands);
`crsp.msf.shrout` is in thousands — hence the `* 1000` scaling. Verified
against Berkshire Form 4 filings in 2020 (cross-checked against the SEC
EDGAR cover page).

### PersonID ↔ SEC CIK caveat

`personid` is Thomson Reuters' internal insider ID, NOT the SEC-assigned
reporter CIK.

**Where the SEC CIK lives in WRDS** (all permission-gated — verify your
subscription):
- `wrdssec_insiders.table1.rptownercik` — the canonical Form 4 owner CIK
- `wrds_insiders.table1.rptownercik` — legacy copy
- `wrdssec.table1.rptownercik` — view routing to `wrdssec_insiders`

**WRDS linking tables that do NOT give SEC CIK** (useful for other
studies — documented here so you don't go looking):
- `wrdsapps_plink_trinsider_ciq.trinsider_ciq_link` (790K rows) —
  `tr_personid → ciq_personid` (Capital IQ)
- `wrdsapps_plink_trinsider_twoiq.trinsider_twoiq_link` — similar to 2iQ
- `wrdsapps_plink_boardex_trinsider` — boardroom directory link
- `wrdsapps_plink_exec_trinsider` — Execucomp link (for pay studies)
- `wrdssec.wciklink_{cusip,gvkey,names,ticker}` — ISSUER-level only

None of the above resolve `tr_personid` to SEC owner CIK.

**Name-level bridge fallback**: if you don't have `wrdssec_insiders`
access, build a `(company_CIK, normalized_name) → blockholder_CIK` dict
from an external source with real SEC owner CIKs (e.g., Volkova's
published blockholder CSV, or a one-off scrape of SEC own-disp) and
join on `(cusip6→company_CIK, normalize(owner))`. See
`mirror/scripts/bridge_insider_names.py` for the normalization rules
(suffixes stripped, punctuation removed, uppercase).
