---
name: lseg-data
description: This skill should be used when the user asks to "access LSEG data", "query Refinitiv", "get market data from Refinitiv", "download fundamentals from LSEG", "access ESG scores", "convert RIC to ISIN", or needs the LSEG Data Library Python API.
---

# LSEG Data Library

Access financial data from LSEG (London Stock Exchange Group), formerly Refinitiv, via the `lseg.data` Python library.

## Quick Start

```python
import lseg.data as ld

ld.open_session()

# Get fundamentals
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O'],
    fields=['TR.CompanyName', 'TR.Revenue', 'TR.EPS']
)

# Get historical prices
prices = ld.get_history(
    universe='AAPL.O',
    fields=['OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME'],
    start='2023-01-01',
    end='2023-12-31'
)

ld.close_session()
```

## Authentication

Config file `lseg-data.config.json`:
```json
{
  "sessions": {
    "default": "platform.ldp",
    "platform": {
      "ldp": {
        "app-key": "YOUR_APP_KEY",
        "username": "YOUR_MACHINE_ID",
        "password": "YOUR_PASSWORD"
      }
    }
  }
}
```

Or environment variables: `RDP_USERNAME`, `RDP_PASSWORD`, `RDP_APP_KEY`

## Core APIs

| API | Use Case | Example |
|-----|----------|---------|
| `ld.get_data()` | Point-in-time data | Fundamentals, ESG scores |
| `ld.get_history()` | Time series | Historical prices, OHLCV |
| `symbol_conversion.Definition()` | ID mapping | RIC ↔ ISIN ↔ CUSIP |

## Key Field Prefixes

| Prefix | Type | Example |
|--------|------|---------|
| `TR.` | Refinitiv fields | `TR.Revenue`, `TR.EPS` |
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
