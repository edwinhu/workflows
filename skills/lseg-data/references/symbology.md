# Symbology Module

Identifier conversion and mapping between RIC, ISIN, CUSIP, SEDOL, and other symbol types.

## Contents

- [Overview](#overview)
- [Key Fields](#key-fields)
- [Parameters](#parameters)
- [RIC Exchange Suffixes](#ric-exchange-suffixes)
- [Code Examples](#code-examples)
- [Notes and Gotchas](#notes-and-gotchas)
- [See Also](#see-also)

## Overview

Convert between different financial identifier systems. Essential for linking datasets, building cross-platform analytics, and mapping between LSEG and other data sources.

### Supported Identifier Types

| Type | Description | Example |
|------|-------------|---------|
| **RIC** | Reuters Instrument Code | `AAPL.O` |
| **ISIN** | International Securities ID | `US0378331005` |
| **CUSIP** | Committee on Uniform Security ID | `037833100` |
| **SEDOL** | Stock Exchange Daily Official List | `2046251` |
| **Ticker** | Exchange ticker symbol | `AAPL` |
| **OrgId** | LSEG Organization ID | `4295905573` |
| **PermId** | LSEG Permanent ID | `4295905573` |
| **LEI** | Legal Entity Identifier | `HWUPKR0MPOU8FGXBT394` |

## Key Fields

### RIC Components

| Field | Description | Example |
|-------|-------------|---------|
| `TR.RIC` | Full RIC | `AAPL.O` |
| `TR.RICCode` | RIC root | `AAPL` |
| `TR.ExchangeCode` | Exchange suffix | `O` |
| `TR.PrimaryRIC` | Primary RIC for company | `AAPL.O` |

### Identifiers

| Field | Description |
|-------|-------------|
| `TR.ISIN` | ISIN code |
| `TR.CUSIP` | CUSIP code |
| `TR.SEDOL` | SEDOL code |
| `TR.Ticker` | Ticker symbol |
| `TR.OrganizationID` | LSEG Organization ID |
| `TR.LEI` | Legal Entity Identifier |

### Company Information

| Field | Description |
|-------|-------------|
| `TR.CommonName` | Company common name |
| `TR.CompanyName` | Full company name |
| `TR.HeadquartersCountry` | HQ country |
| `TR.TRBCEconomicSector` | TRBC sector |

## Parameters

For `symbol_conversion.Definition()`:

| Parameter | Description | Values |
|-----------|-------------|--------|
| `symbols` | List of symbols to convert | `['AAPL.O', 'MSFT.O']` |
| `from_symbol_type` | Source identifier type | `'RIC'`, `'ISIN'`, `'CUSIP'` |
| `to_symbol_types` | Target identifier types | `['ISIN', 'CUSIP', 'SEDOL']` |

## RIC Exchange Suffixes

### Major US Exchanges

| Exchange | Suffix | Example |
|----------|--------|---------|
| NASDAQ | `.O` | `AAPL.O` |
| NYSE | `.N` | `IBM.N` |
| NYSE Arca | `.P` | `SPY.P` |
| OTC | `.PK` | `TCEHY.PK` |

### International Exchanges

| Exchange | Suffix | Example |
|----------|--------|---------|
| London | `.L` | `VOD.L` |
| Frankfurt | `.DE` | `BMW.DE` |
| Paris | `.PA` | `OR.PA` |
| Tokyo | `.T` | `7203.T` |
| Hong Kong | `.HK` | `0700.HK` |
| Sydney | `.AX` | `BHP.AX` |
| Toronto | `.TO` | `RY.TO` |

### Special RIC Patterns

| Pattern | Meaning | Example |
|---------|---------|---------|
| `0#.INDEX` | Index chain | `0#.SPX` |
| `=CURR` | FX rate | `=EUR` |
| `^SYMBOL` | Index | `^SPX` |

## Code Examples

### Basic Symbol Conversion

```python
import lseg.data as ld
from lseg.data.content import symbol_conversion

ld.open_session()

# Convert RICs to other identifiers
result = symbol_conversion.Definition(
    symbols=['AAPL.O', 'MSFT.O', 'GOOGL.O'],
    from_symbol_type='RIC',
    to_symbol_types=['ISIN', 'CUSIP', 'SEDOL']
).get_data()

print(result.data.df)

ld.close_session()
```

### ISIN to RIC

```python
import lseg.data as ld
from lseg.data.content import symbol_conversion

ld.open_session()

# Convert ISINs to RICs
result = symbol_conversion.Definition(
    symbols=[
        'US0378331005',  # Apple
        'US5949181045',  # Microsoft
        'US02079K3059'   # Alphabet
    ],
    from_symbol_type='ISIN',
    to_symbol_types=['RIC', 'Ticker', 'CUSIP']
).get_data()

print(result.data.df)

ld.close_session()
```

### CUSIP to Multiple Identifiers

```python
import lseg.data as ld
from lseg.data.content import symbol_conversion

ld.open_session()

# Convert CUSIPs
result = symbol_conversion.Definition(
    symbols=['037833100', '594918104'],  # Apple, Microsoft
    from_symbol_type='CUSIP',
    to_symbol_types=['RIC', 'ISIN', 'SEDOL', 'Ticker']
).get_data()

print(result.data.df)

ld.close_session()
```

### Get Identifiers via get_data

```python
import lseg.data as ld

ld.open_session()

# Alternative: get identifiers as fields
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O'],
    fields=[
        'TR.CompanyName',
        'TR.ISIN',
        'TR.CUSIP',
        'TR.SEDOL',
        'TR.Ticker',
        'TR.OrganizationID',
        'TR.LEI'
    ]
)

print(df)

ld.close_session()
```

### Bulk Conversion for Data Linking

```python
import lseg.data as ld
from lseg.data.content import symbol_conversion
import pandas as pd

ld.open_session()

# Convert large list of ISINs (from another dataset)
isins = ['US0378331005', 'US5949181045', 'US02079K3059']  # From WRDS, etc.

# Chunk if list is large
def chunk_list(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

all_results = []
for chunk in chunk_list(isins, 100):
    result = symbol_conversion.Definition(
        symbols=chunk,
        from_symbol_type='ISIN',
        to_symbol_types=['RIC', 'CUSIP']
    ).get_data()
    all_results.append(result.data.df)

# Combine results
mapping = pd.concat(all_results, ignore_index=True)

ld.close_session()
print(mapping)
```

### Find Primary RIC for Company

```python
import lseg.data as ld

ld.open_session()

# Get primary RIC (main listing)
df = ld.get_data(
    universe=['AAPL.O', 'VOD.L', 'SAP.DE'],
    fields=[
        'TR.CompanyName',
        'TR.PrimaryRIC',
        'TR.RIC',
        'TR.ExchangeCode',
        'TR.ExchangeName'
    ]
)

print(df)

ld.close_session()
```

### Cross-Listed Securities

```python
import lseg.data as ld
from lseg.data.content import symbol_conversion

ld.open_session()

# Find all RICs for a company (cross-listings)
# Start with one RIC, get the OrgId, then search
df = ld.get_data(
    universe='VOD.L',
    fields=['TR.OrganizationID']
)

org_id = df['TR.OrganizationID'].iloc[0]

# Search for all instruments with same OrgId
# (This is a simplified approach)
result = symbol_conversion.Definition(
    symbols=[f'orgid:{org_id}'],
    from_symbol_type='OrgId',
    to_symbol_types=['RIC']
).get_data()

ld.close_session()
```

### Create WRDS Linking Table

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Build linking table for WRDS integration
universe = ['AAPL.O', 'MSFT.O', 'GOOGL.O', 'AMZN.O', 'META.O']

df = ld.get_data(
    universe=universe,
    fields=[
        'TR.RIC',
        'TR.ISIN',
        'TR.CUSIP',
        'TR.SEDOL',
        'TR.Ticker',
        'TR.CompanyName'
    ]
)

# CUSIP without check digit for CRSP linking
df['CUSIP8'] = df['TR.CUSIP'].str[:8]

# Save for WRDS linking
df.to_csv('lseg_wrds_link.csv', index=False)

ld.close_session()
```

## Notes and Gotchas

### 1. RIC Format Matters

Always include the exchange suffix:
```python
# Wrong
ld.get_data('AAPL', fields)  # Ambiguous

# Right
ld.get_data('AAPL.O', fields)  # NASDAQ
ld.get_data('AAPL.MX', fields)  # Mexico
```

### 2. CUSIP Check Digit

LSEG returns 9-character CUSIP (with check digit). WRDS often uses 8-character:
```python
cusip_9 = df['TR.CUSIP']  # LSEG format: 037833100
cusip_8 = cusip_9.str[:8]  # WRDS format: 03783310
```

### 3. Historical Identifiers

Symbols change over time (mergers, ticker changes):
```python
# Get historical symbol chain
df = ld.get_data(
    universe='META.O',  # Was FB.O before 2022
    fields=['TR.RIC', 'TR.PreviousRIC']
)
```

### 4. Multiple Matches

A single ISIN may have multiple RICs (different exchanges):
```python
# ISIN maps to multiple RICs
result = symbol_conversion.Definition(
    symbols=['GB00BH4HKS39'],  # Vodafone
    from_symbol_type='ISIN',
    to_symbol_types=['RIC']
).get_data()
# May return: VOD.L, VOD.N (ADR), etc.
```

### 5. Invalid Identifiers

Handle cases where conversion fails:
```python
try:
    result = symbol_conversion.Definition(
        symbols=['INVALID123'],
        from_symbol_type='ISIN',
        to_symbol_types=['RIC']
    ).get_data()
except Exception as e:
    print(f"Conversion failed: {e}")
```

### 6. Case Sensitivity

Identifiers are generally case-insensitive:
```python
# These are equivalent
'AAPL.O' == 'aapl.o'  # True for lookup purposes
'US0378331005' == 'us0378331005'  # True
```

### 7. OrgId vs PermId

| ID Type | Scope | Use Case |
|---------|-------|----------|
| OrgId | Organization level | Link all securities of same company |
| PermId | Instrument level | Identify specific security |
| QuoteId | Quote level | Identify specific quote |

## See Also

- [SKILL.md](../SKILL.md) - Core API patterns
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) - Symbol conversion issues
- [WRDS_COMPARISON.md](../WRDS_COMPARISON.md) - PERMNO/GVKEY mapping
- [fundamentals.md](fundamentals.md) - Using symbols for data retrieval
