---
name: wrds
version: 1.0
description: This skill should be used when the user asks to "query WRDS", "access Compustat", "get CRSP data", "pull Form 4 insider data", "query ISS compensation", "download SEC EDGAR filings", "get ExecuComp data", "access Capital IQ", or needs WRDS PostgreSQL query patterns.
---

## Contents

- [Quick Reference: Table Names](#quick-reference-table-names)
- [Connection](#connection)
- [Critical Filters](#critical-filters)
- [Parameterized Queries](#parameterized-queries)
- [Additional Resources](#additional-resources)

# WRDS Data Access

WRDS (Wharton Research Data Services) provides academic research data via PostgreSQL at `wrds-pgdata.wharton.upenn.edu:9737`.

## Quick Reference: Table Names

| Dataset | Schema | Key Tables |
|---------|--------|------------|
| Compustat | `comp` | `company`, `funda`, `fundq`, `secd` |
| ExecuComp | `comp_execucomp` | `anncomp` |
| CRSP | `crsp` | `dsf`, `msf`, `stocknames`, `ccmxpf_linkhist` |
| CRSP v2 | `crsp` | `dsf_v2`, `msf_v2`, `stocknames_v2` |
| Form 4 Insiders | `tr_insiders` | `table1`, `header`, `company` |
| ISS Incentive Lab | `iss_incentive_lab` | `comppeer`, `sumcomp`, `participantfy` |
| Capital IQ | `ciq` | `wrds_compensation` |
| IBES | `tr_ibes` | `det_epsus`, `statsum_epsus` |
| SEC EDGAR | `wrdssec` | `wrds_forms`, `wciklink_cusip` |
| SEC Search | `wrds_sec_search` | `filing_view`, `registrant` |
| EDGAR | `edgar` | `filings`, `filing_docs` |
| Fama-French | `ff` | `factors_monthly`, `factors_daily` |
| LSEG/Datastream | `tr_ds` | `ds2constmth`, `ds2indexlist` |

## Connection

```python
import psycopg2

conn = psycopg2.connect(
    host='wrds-pgdata.wharton.upenn.edu',
    port=9737,
    database='wrds',
    sslmode='require'
    # Credentials from ~/.pgpass
)
```

Auth: `~/.pgpass` with `chmod 600`:
```
wrds-pgdata.wharton.upenn.edu:9737:wrds:USERNAME:PASSWORD
```

SSH: `ssh wrds` (uses `~/.ssh/wrds_rsa`)

## Critical Filters

### Compustat Standard Filters
Always include for clean fundamental data:
```sql
WHERE indfmt = 'INDL'
  AND datafmt = 'STD'
  AND popsrc = 'D'
  AND consol = 'C'
```

### CRSP v2 Common Stock Filter
Equivalent to legacy `shrcd IN (10, 11)`:
```python
df = df.loc[
    (df.sharetype == 'NS') &
    (df.securitytype == 'EQTY') &
    (df.securitysubtype == 'COM') &
    (df.usincflg == 'Y') &
    (df.issuertype.isin(['ACOR', 'CORP']))
]
```

### Form 4 Transaction Types
```sql
WHERE acqdisp = 'D'  -- Dispositions
  AND trancode IN ('S', 'D', 'G', 'F')  -- Sales, Dispositions, Gifts, Tax
```

## Parameterized Queries

Always use parameterized queries (never string formatting):

```python
# Correct
cursor.execute("""
    SELECT gvkey, conm FROM comp.company WHERE gvkey = %s
""", (gvkey,))

# For lists, use ANY()
cursor.execute("""
    SELECT * FROM comp.funda WHERE gvkey = ANY(%s)
""", (gvkey_list,))
```

## Additional Resources

### Reference Files

Detailed query patterns and table documentation:

- **`references/compustat.md`** - Compustat tables, ExecuComp, financial variables
- **`references/crsp.md`** - CRSP stock data, CCM linking, v2 format
- **`references/insider-form4.md`** - Thomson Reuters Form 4, rolecodes, insider types
- **`references/iss-compensation.md`** - ISS Incentive Lab, peer companies, compensation
- **`references/edgar.md`** - SEC EDGAR filings, URL construction, DCN vs accession numbers
- **`references/connection.md`** - Connection pooling, caching, error handling

### Example Files

Working code from real projects:

- **`examples/form4_disposals.py`** - Insider trading analysis (from a prior project)
- **`examples/wrds_connector.py`** - Connection pooling pattern

### Scripts

- **`scripts/test_connection.py`** - Validate WRDS connectivity

### Local Sample Notebooks

WRDS-provided samples at `~/resources/wrds-code-samples/`:
- `ResearchApps/CCM2025.ipynb` - Modern CRSP-Compustat merge
- `ResearchApps/ff3_crspCIZ.ipynb` - Fama-French factor construction
- `comp/sas/execcomp_ceo_screen.sas` - ExecuComp patterns

## Date Awareness

**Pattern from oh-my-opencode:** When querying historical data, be aware of current date context.

Current date is automatically available via `datetime.now()`. Use this for:
- Data range validation ("get data for last 5 years")
- Fiscal year calculations
- Event study windows

Example:
```python
from datetime import datetime, timedelta

# Query last 5 years of data
end_date = datetime.now()
start_date = end_date - timedelta(days=5*365)

query = """
SELECT * FROM comp.funda
WHERE datadate BETWEEN %s AND %s
"""
df = pd.read_sql(query, conn, params=(start_date, end_date))
```

Force current year awareness in date-dependent queries.
