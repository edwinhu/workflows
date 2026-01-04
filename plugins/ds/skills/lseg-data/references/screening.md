# LSEG Screener

## Overview

The `Screener` object allows dynamic stock screening with complex criteria. Use it to filter instruments by market cap, exchange, sector, returns, and other metrics.

## Basic Usage

```python
import lseg.data as ld
from lseg.data.discovery import Screener

ld.open_session()

# Create screener with criteria
rics = Screener(
    'U(IN(Equity(active,public,primary))/*UNV:Public*/), '
    'TR.CompanyMarketCap(Scale=6)>=5000, '
    'IN(TR.ExchangeMarketIdCode,"XNYS"), '
    'IN(TR.TRBCBusinessSectorCode,"5010","5020","5030"), '
    'TR.TotalReturn3Mo>=15, '
    'CURN=USD'
)

# Screener is iterable - returns list of RICs
print(list(rics))  # ['TPL.N', 'TRGP.N', 'MUSA.N']

# Use with get_data()
df = ld.get_data(
    rics,
    ['TR.CommonName', 'TR.CompanyMarketCap(Scale=6)',
     'TR.ExchangeName', 'TR.TRBCBusinessSector', 'TR.TotalReturn3Mo']
)

ld.close_session()
```

## Screener Expression Syntax

### Universe Selection

| Expression | Description |
|------------|-------------|
| `U(IN(Equity(active,public,primary)))` | Active public primary equities |
| `U(IN(Equity(active,public)))` | All active public equities |
| `/*UNV:Public*/` | Comment for clarity |

### Market Cap Filters

| Expression | Description |
|------------|-------------|
| `TR.CompanyMarketCap(Scale=6)>=5000` | Market cap >= $5B |
| `TR.CompanyMarketCap(Scale=6)>=1000` | Market cap >= $1B |
| `TR.CompanyMarketCap(Scale=6)>=100` | Market cap >= $100M |

### Exchange Filters

| Code | Exchange |
|------|----------|
| `XNYS` | NYSE |
| `XNAS` | NASDAQ |
| `XLON` | London |
| `XTKS` | Tokyo |

```
IN(TR.ExchangeMarketIdCode,"XNYS","XNAS")
```

### Sector Filters (TRBC Codes)

| Code | Sector |
|------|--------|
| `5010` | Energy - Fossil Fuels |
| `5020` | Energy - Renewable |
| `5030` | Energy - Utilities |
| `5110` | Basic Materials |
| `5210` | Industrials |
| `5310` | Consumer Cyclicals |

```
IN(TR.TRBCBusinessSectorCode,"5010","5020","5030")
```

### Performance Filters

| Expression | Description |
|------------|-------------|
| `TR.TotalReturn3Mo>=15` | 3-month return >= 15% |
| `TR.TotalReturn1Yr>=20` | 1-year return >= 20% |
| `TR.PricePercentChg52W>=10` | 52-week price change >= 10% |

### Valuation Filters

| Expression | Description |
|------------|-------------|
| `TR.PERatio<=20` | P/E <= 20 |
| `TR.PriceToBVPerShare<=3` | P/B <= 3 |
| `TR.DividendYield>=2` | Dividend yield >= 2% |

### Currency

```
CURN=USD
```

## Building Screener Expressions

Combine filters with commas:

```python
expression = (
    'U(IN(Equity(active,public,primary))), '
    'TR.CompanyMarketCap(Scale=6)>=1000, '        # $1B+ market cap
    'IN(TR.ExchangeMarketIdCode,"XNYS","XNAS"), ' # NYSE or NASDAQ
    'TR.PERatio<=25, '                            # P/E <= 25
    'TR.DividendYield>=1, '                       # Dividend >= 1%
    'CURN=USD'
)

screener = Screener(expression)
```

## Common Screener Patterns

### Large Cap Value

```python
large_cap_value = Screener(
    'U(IN(Equity(active,public,primary))), '
    'TR.CompanyMarketCap(Scale=6)>=10000, '  # $10B+
    'TR.PERatio<=15, '
    'TR.PriceToBVPerShare<=2, '
    'CURN=USD'
)
```

### High Dividend

```python
high_dividend = Screener(
    'U(IN(Equity(active,public,primary))), '
    'TR.CompanyMarketCap(Scale=6)>=1000, '
    'TR.DividendYield>=4, '
    'IN(TR.ExchangeMarketIdCode,"XNYS"), '
    'CURN=USD'
)
```

### Momentum

```python
momentum = Screener(
    'U(IN(Equity(active,public,primary))), '
    'TR.CompanyMarketCap(Scale=6)>=5000, '
    'TR.TotalReturn3Mo>=15, '
    'TR.TotalReturn1Yr>=25, '
    'CURN=USD'
)
```

## Using Screener Results

### With get_data()

```python
df = ld.get_data(
    screener,
    ['TR.CommonName', 'TR.CompanyMarketCap', 'TR.PERatio']
)
```

### With get_history()

```python
rics = list(screener)
for ric in rics:
    hist = ld.get_history(
        universe=ric,
        fields=['CLOSE', 'VOLUME'],
        start='2023-01-01',
        end='2023-12-31'
    )
```

## Refinitiv Workspace Integration

To build complex screening expressions, use the Screener app in Refinitiv Workspace:

1. Open Screener app
2. Configure filters visually
3. Copy the generated expression
4. Use in Python code

## Rate Limits

- Screener results are limited by the same rate limits as `get_data()`
- Large result sets may be truncated
- Consider adding stricter filters if results are too large
