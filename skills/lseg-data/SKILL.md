---
name: lseg-data
version: 1.0
description: Use when "query LSEG/Refinitiv", "fundamentals or market data from LSEG", "ESG scores", "RIC/ISIN symbology", "corporate governance or activism (poison pills, campaigns)", "M&A or IPO deals", "syndicated loans or project finance", "PE/VC investments", "joint ventures", "municipal bonds", "Lipper fund details", "stock screening (fscreen)", "Refinitiv news", or any use of the `lseg.data` Python API. (For academic loan/PE data, WRDS DealScan/PitchBook may be the better source — the wrds skill covers those.)
user-invocable: false
---

## Contents

- [Query Enforcement](#query-enforcement)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Core APIs](#core-apis)
- [Key Field Prefixes](#key-field-prefixes)
- [RIC Symbology](#ric-symbology)
- [Rate Limits](#rate-limits)
- [Additional Resources](#additional-resources)

# LSEG Data Library

Access financial data from LSEG (London Stock Exchange Group), formerly Refinitiv, via the `lseg.data` Python library.

## Query Enforcement

### IRON LAW: NO DATA CLAIM WITHOUT SAMPLE INSPECTION

Before claiming ANY LSEG query succeeded, follow these steps:
1. **VALIDATE** field names exist (check prefixes: TR., CF_)
2. **VALIDATE** RIC symbology is correct (.O, .N, .L, .T)
3. **EXECUTE** the query
4. **INSPECT** sample rows with `.head()` or `.sample()`
5. **VERIFY** critical columns are not NULL
6. **VERIFY** date range matches expectations
7. **CLAIM** success only after all checks pass

This is not negotiable. Skipping result inspection is NOT HELPFUL — the user builds analysis on data with undetected quality problems.

### LSEG API Facts

- The API does not raise errors for invalid field names or wrong RICs — it returns empty results or NULL columns. Treating returned rows as correct data is an unverified claim presented as fact: inspect for NULLs, wrong dates, and invalid values before returning anything.
- Field-name typos are common and fail silently (TR.EPS vs TR.Eps). Validate field names against the documentation before executing.
- User-supplied RICs often carry the wrong exchange suffix. Verify against the RIC Symbology section (`.O`, `.N`, `.L`, `.T`) before querying.
- Market data has T-1 availability — today's data arrives tomorrow. Querying through today produces silent gaps; see the Date Awareness section.
- Rate limits bind per session (500 requests/minute) and per request (`get_data()` 10,000 data points, `get_history()` 3,000 rows) — many small queries still hit the session cap. Batch instead of looping.

### Red Flags — STOP If About To:

- Execute a query without validating field names and RIC suffixes first → STOP. The API will not error for you.
- Return a dataframe without `.head()` or `.sample()` inspection → STOP. Handing over uninspected data gives the user undetected quality problems — unhelpful on its own terms.

### Data Validation Checklist

Before EVERY data retrieval claim, verify the following:

**For `ld.get_data()` (fundamentals/ESG):**
- [ ] Field names use correct prefix (TR. for Refinitiv)
- [ ] RIC symbology verified (correct exchange suffix)
- [ ] Result inspection: `.head()` or `.sample()` executed
- [ ] NULL check on critical fields (e.g., revenue, EPS)
- [ ] Row count verification (is result size reasonable?)
- [ ] Date context verified (fiscal periods, as-of dates)

**For `ld.get_history()` (time series):**
- [ ] Field names are valid (OPEN, HIGH, LOW, CLOSE, VOLUME, or CF_ prefixes)
- [ ] Start/end dates specified explicitly
- [ ] Date range adjusted for T-1 availability (market data lag)
- [ ] Result inspection: check first and last rows
- [ ] NULL check on OHLCV fields
- [ ] Date continuity check (gaps in trading days expected, but not in date sequence)

**For `symbol_conversion.Definition()` (mapping):**
- [ ] Input identifier type specified correctly
- [ ] Result inspection: verify mapped values exist
- [ ] NULL check (some securities may not have all identifiers)

**For ALL queries:**
- [ ] Rate limits considered (batch if >10k data points)
- [ ] Session management: `open_session()` at start, `close_session()` at end
- [ ] Error handling: try/except for network failures
- [ ] Sample inspection BEFORE claiming data is ready

## Quick Start

To get started with LSEG Data Library, initialize a session and execute queries:

```python
import lseg.data as ld

# Initialize session
ld.open_session()

# Get fundamentals
df = ld.get_data(
    universe=[‘AAPL.O’, ‘MSFT.O’],
    fields=[‘TR.CompanyName’, ‘TR.Revenue’, ‘TR.EPS’]
)
print(df.head())  # Inspect sample data

# Get historical prices
prices = ld.get_history(
    universe=’AAPL.O’,
    fields=[‘OPEN’, ‘HIGH’, ‘LOW’, ‘CLOSE’, ‘VOLUME’],
    start=‘2023-01-01’,
    end=‘2023-12-31’
)
print(prices.head())  # Inspect sample data

# Close session
ld.close_session()
```

## Authentication

Configure LSEG authentication using either a config file or environment variables.

### Config File Method

Create `lseg-data.config.json`:
```json
{
  “sessions”: {
    “default”: “platform.ldp”,
    “platform”: {
      “ldp”: {
        “app-key”: “YOUR_APP_KEY”,
        “username”: “YOUR_MACHINE_ID”,
        “password”: “YOUR_PASSWORD”
      }
    }
  }
}
```

### Environment Variables Method

Set the following environment variables for LSEG authentication:

```bash
# Configure LSEG credentials via environment variables
export RDP_USERNAME=”YOUR_MACHINE_ID”
export RDP_PASSWORD=”YOUR_PASSWORD”
export RDP_APP_KEY=”YOUR_APP_KEY”
```

## Core APIs

| API | Use Case | Example |
|-----|----------|---------|
| `ld.get_data()` | Point-in-time data | Fundamentals, ESG scores |
| `ld.get_history()` | Time series | Historical prices, OHLCV |
| `ld.news.get_headlines()` | News headlines | Company news, topic filtering |
| `symbol_conversion.Definition()` | ID mapping | RIC ↔ ISIN ↔ CUSIP |

## Key Field Prefixes

| Prefix | Type | Example |
|--------|------|---------|
| `TR.` | Refinitiv fields | `TR.Revenue`, `TR.EPS` |
| `TR.MnA` | Mergers & Acquisitions | `TR.MnAAcquirorName`, `TR.MnADealValue` |
| `TR.NI` | Equity/New Issues (IPOs) | `TR.NIIssuer`, `TR.NIOfferPrice` |
| `TR.JV` | Joint Ventures/Alliances | `TR.JVDealName`, `TR.JVStatus` |
| `TR.SACT` | Shareholder Activism | `TR.SACTLeadDissident` |
| `TR.PP` | Poison Pills | `TR.PPPillAdoptionDate` |
| `TR.LN` | Syndicated Loans | `TR.LNTotalFacilityAmount` |
| `TR.PJF` | Infrastructure/Project Finance | `TR.PJFProjectName` |
| `TR.PEInvest` | Private Equity/Venture Capital | `TR.PEInvestRoundDate` |
| `TR.Muni` | Municipal Bonds | `TR.MuniIssuerName` |
| `CF_` | Composite (real-time) | `CF_LAST`, `CF_BID` |

## RIC Symbology

| Suffix | Exchange | Example |
|--------|----------|---------|
| `.O` | NASDAQ | `AAPL.O` |
| `.N` | NYSE | `IBM.N` |
| `.L` | London | `VOD.L` |
| `.T` | Tokyo | `7203.T` |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `get_data()` | 10,000 data points/request |
| `get_history()` | 3,000 rows/request |
| Session | 500 requests/minute |

## Additional Resources

### Reference Files

- **`references/fundamentals.md`** - Financial statement fields, ratios, estimates
- **`references/esg.md`** - ESG scores, pillars, controversies
- **`references/symbology.md`** - RIC/ISIN/CUSIP conversion
- **`references/pricing.md`** - Historical prices, real-time data
- **`references/screening.md`** - Stock screening with Screener object
- **`references/fscreen.md`** - Fund screening (ETFs, mutual funds) with FSCREEN app
- **`references/fund-details.md`** - Fund details and characteristics
- **`references/news.md`** - News headlines, pagination, query syntax
- **`references/mna.md`** - Mergers & acquisitions deals (SDC Platinum, 2,683 fields)
- **`references/equity-new-issues.md`** - IPOs, follow-ons, equity offerings (SDC Platinum, 1,708 fields)
- **`references/joint-ventures.md`** - Joint ventures, strategic alliances (SDC Platinum, 301 fields)
- **`references/corporate-governance.md`** - Shareholder activism, poison pills (SDC Platinum)
- **`references/syndicated-loans.md`** - Syndicated loan deals (SDC Platinum)
- **`references/infrastructure.md`** - Infrastructure/project finance deals (SDC Platinum)
- **`references/private-equity.md`** - Private equity/venture capital investments (SDC Platinum)
- **`references/municipal-bonds.md`** - Municipal bond issuances (SDC Platinum)
- **`references/api-discovery.md`** - Reverse-engineering APIs via CDP network monitoring
- **`references/troubleshooting.md`** - Common issues and solutions
- **`references/wrds-comparison.md`** - LSEG vs WRDS data mapping

### Example Files

- **`examples/historical_pricing.ipynb`** - Historical price retrieval
- **`examples/fundamentals_query.py`** - Fundamental data patterns
- **`examples/stock_screener.ipynb`** - Dynamic stock screening

### Scripts

- **`scripts/test_connection.py`** - Validate LSEG connectivity

### Local Sample Repositories

LSEG API samples at `~/resources/lseg-samples/`:
- `Example.RDPLibrary.Python/` - Core API examples
- `Examples.DataLibrary.Python.AdvancedUsecases/` - Advanced patterns
- `Article.DataLibrary.Python.Screener/` - Stock screening

### Refinitiv Codebook

Interactive JupyterLab environment with pre-configured LSEG access:

- **URL**: `https://workspace.refinitiv.com/codebook/`
- **Environment**: JupyterHub with Python 3.8, pre-installed `refinitiv.data` library
- **Session**: Auto-authenticated via Workspace credentials (`{name=’codebook’}`)

```python
# In Codebook, session opens automatically with Workspace auth
import refinitiv.data as rd
rd.open_session()  # Returns session with name=’codebook’

# Query data immediately
df = rd.news.get_headlines(‘R:AAPL.O AND SUGGAC’, count=10)
```

**Note**: Codebook uses `refinitiv.data` (older name) rather than `lseg.data`. Both APIs are equivalent.

## Date Awareness

When querying market data, account for current date context and market data lag.

### Market Data Lag

Market data typically has T-1 availability, meaning today’s data becomes available tomorrow. Adjust date ranges accordingly.

### Date Range Example

Use current date context when querying historical prices:

```python
from datetime import datetime, timedelta

# Get recent market data
end_date = datetime.now()
start_date = end_date - timedelta(days=365)

# Adjust to exclude recent data (T-1 for market data availability)
end_date = end_date - timedelta(days=1)

df = ld.get_history(
    universe=”AAPL.O”,
    fields=[‘CLOSE’],
    start=start_date.strftime(‘%Y-%m-%d’),
    end=end_date.strftime(‘%Y-%m-%d’)
)
```

Remember: Always account for the T-1 lag in market data availability.
