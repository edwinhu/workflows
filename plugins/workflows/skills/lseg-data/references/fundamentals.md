# Fundamentals Module

Company financial data including income statement, balance sheet, cash flow, and financial ratios.

## Contents

- [Overview](#overview)
- [Key Fields](#key-fields)
- [Parameters](#parameters)
- [Code Examples](#code-examples)
- [Notes and Gotchas](#notes-and-gotchas)
- [See Also](#see-also)

## Overview

Access fundamental financial data for public companies worldwide. Data sourced from company filings, with standardized and as-reported values available.

### Coverage
- **Companies**: 80,000+ globally
- **History**: Up to 20+ years for major markets
- **Update frequency**: Daily (after filings)
- **Periods**: Annual (FY), Quarterly (FQ), Semi-annual, LTM

## Key Fields

### Income Statement

| Field | Description | Units |
|-------|-------------|-------|
| `TR.RevenueActValue` | Total revenue | Currency |
| `TR.GrossProfit` | Gross profit | Currency |
| `TR.OperatingIncome` | Operating income (EBIT) | Currency |
| `TR.EBITDA` | EBITDA | Currency |
| `TR.NetIncomeActValue` | Net income | Currency |
| `TR.EPSActValue` | Earnings per share (basic) | Currency/share |
| `TR.EPSDilActValue` | Earnings per share (diluted) | Currency/share |

### Balance Sheet

| Field | Description | Units |
|-------|-------------|-------|
| `TR.TotalAssetsReported` | Total assets | Currency |
| `TR.TotalLiabilities` | Total liabilities | Currency |
| `TR.TotalEquity` | Shareholders' equity | Currency |
| `TR.TotalDebt` | Total debt | Currency |
| `TR.CashAndSTInvestments` | Cash and equivalents | Currency |
| `TR.TotalCurrentAssets` | Current assets | Currency |
| `TR.TotalCurrentLiabilities` | Current liabilities | Currency |

### Cash Flow

| Field | Description | Units |
|-------|-------------|-------|
| `TR.OperCashFlow` | Operating cash flow | Currency |
| `TR.CapexActValue` | Capital expenditures | Currency |
| `TR.FreeCashFlow` | Free cash flow | Currency |
| `TR.DividendsPaid` | Dividends paid | Currency |

### Ratios & Margins

| Field | Description | Units |
|-------|-------------|-------|
| `TR.GrossMargin` | Gross margin | Percent |
| `TR.OperatingMargin` | Operating margin | Percent |
| `TR.NetProfitMargin` | Net profit margin | Percent |
| `TR.ROE` | Return on equity | Percent |
| `TR.ROA` | Return on assets | Percent |
| `TR.ROIC` | Return on invested capital | Percent |
| `TR.CurrentRatio` | Current ratio | Ratio |
| `TR.QuickRatio` | Quick ratio | Ratio |
| `TR.DebtToEquity` | Debt to equity | Ratio |

### Valuation

| Field | Description | Units |
|-------|-------------|-------|
| `TR.PriceToBVPerShare` | Price to book value | Ratio |
| `TR.PriceToSalesPerShare` | Price to sales | Ratio |
| `TR.EV` | Enterprise value | Currency |
| `TR.EVToEBITDA` | EV/EBITDA | Ratio |
| `TR.PERatio` | Price/Earnings ratio | Ratio |

## Parameters

| Parameter | Description | Values |
|-----------|-------------|--------|
| `Period` | Fiscal period type | `FY` (annual), `FQ` (quarterly), `FS` (semi-annual), `LTM` |
| `SDate` | Start date/period | Date or relative (`FY-4`, `FQ-8`) |
| `EDate` | End date/period | Date or relative (`FY0`, `FQ0` = most recent) |
| `Frq` | Frequency | `FY`, `FQ`, `FS`, `M` (monthly) |
| `Curn` | Currency | `USD`, `EUR`, `GBP`, etc. |
| `Scale` | Scaling factor | `6` (millions), `9` (billions) |

### Period Notation

| Notation | Meaning |
|----------|---------|
| `FY0` | Most recent fiscal year |
| `FY-1` | Previous fiscal year |
| `FQ0` | Most recent fiscal quarter |
| `FQ-4` | Same quarter last year |
| `2023-12-31` | Specific date |

## Code Examples

### Basic Financial Snapshot

```python
import lseg.data as ld

ld.open_session()

# Current fundamentals for tech companies
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O', 'AMZN.O', 'META.O'],
    fields=[
        'TR.CompanyName',
        'TR.RevenueActValue',
        'TR.NetIncomeActValue',
        'TR.EPSActValue',
        'TR.CompanyMarketCap'
    ],
    parameters={'Period': 'FY0'}  # Most recent fiscal year
)

ld.close_session()
print(df)
```

### Historical Quarterly Data

```python
import lseg.data as ld

ld.open_session()

# Last 8 quarters of revenue and EPS
df = ld.get_data(
    universe='AAPL.O',
    fields=[
        'TR.RevenueActValue',
        'TR.RevenueActValue.date',  # Get period end date
        'TR.EPSActValue',
        'TR.GrossMargin'
    ],
    parameters={
        'SDate': 'FQ-7',
        'EDate': 'FQ0',
        'Period': 'FQ'
    }
)

ld.close_session()
print(df)
```

### Multi-Year Annual Comparison

```python
import lseg.data as ld

ld.open_session()

# 5-year annual financials
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O'],
    fields=[
        'TR.RevenueActValue',
        'TR.NetIncomeActValue',
        'TR.OperatingMargin',
        'TR.ROE',
        'TR.FreeCashFlow'
    ],
    parameters={
        'SDate': 'FY-4',
        'EDate': 'FY0',
        'Period': 'FY',
        'Curn': 'USD',
        'Scale': 6  # Millions
    }
)

ld.close_session()
print(df)
```

### Balance Sheet Analysis

```python
import lseg.data as ld

ld.open_session()

# Balance sheet items
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O'],
    fields=[
        'TR.TotalAssetsReported',
        'TR.TotalLiabilities',
        'TR.TotalEquity',
        'TR.TotalDebt',
        'TR.CashAndSTInvestments',
        'TR.CurrentRatio',
        'TR.DebtToEquity'
    ],
    parameters={'Period': 'FQ0'}
)

ld.close_session()
print(df)
```

### Financial Ratios Time Series

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Profitability ratios over time
df = ld.get_data(
    universe='AAPL.O',
    fields=[
        'TR.GrossMargin',
        'TR.OperatingMargin',
        'TR.NetProfitMargin',
        'TR.ROE',
        'TR.ROIC'
    ],
    parameters={
        'SDate': 'FY-9',
        'EDate': 'FY0',
        'Period': 'FY'
    }
)

ld.close_session()

# Reshape for analysis
df_melted = df.melt(id_vars=['Instrument'], var_name='Metric', value_name='Value')
print(df_melted)
```

### Estimates vs Actuals

```python
import lseg.data as ld

ld.open_session()

# Compare estimates to actuals
df = ld.get_data(
    universe='AAPL.O',
    fields=[
        'TR.EPSActValue',        # Actual EPS
        'TR.EPSMean',            # Consensus estimate
        'TR.EPSSurprise',        # Surprise amount
        'TR.EPSSurprisePct',     # Surprise percentage
        'TR.RevenueActValue',
        'TR.RevenueMean'
    ],
    parameters={
        'SDate': 'FQ-3',
        'EDate': 'FQ0',
        'Period': 'FQ'
    }
)

ld.close_session()
print(df)
```

## Notes and Gotchas

### 1. Currency Matters

Financial values are reported in the company's reporting currency by default:
```python
# Apple reports in USD, SAP reports in EUR
# Specify Curn to convert:
parameters={'Curn': 'USD'}  # Convert all to USD
```

### 2. Fiscal Year Alignment

Companies have different fiscal year ends:
- Apple: September
- Microsoft: June
- Most companies: December

Be aware when comparing across companies.

### 3. Actual vs Standardized Fields

| Field Type | Example | Notes |
|------------|---------|-------|
| `*ActValue` | `TR.RevenueActValue` | As reported by company |
| Standard | `TR.Revenue` | LSEG standardized |

Use `ActValue` fields for precise as-reported data.

### 4. Missing Historical Data

Not all fields available for all periods:
```python
# Check for NaN values
df.dropna(subset=['TR.RevenueActValue'])
```

### 5. Restated Financials

Companies sometimes restate historical data. LSEG typically provides the most recent version. For point-in-time analysis, check update dates.

### 6. Scale Parameter

Large numbers can be scaled for readability:
```python
parameters={'Scale': 6}  # Divide by 1,000,000 (millions)
parameters={'Scale': 9}  # Divide by 1,000,000,000 (billions)
```

## See Also

- [SKILL.md](../SKILL.md) - Core API patterns
- [esg.md](esg.md) - ESG scores
- [symbology.md](symbology.md) - Identifier conversion
- [WRDS_COMPARISON.md](../WRDS_COMPARISON.md) - Compustat field mapping
