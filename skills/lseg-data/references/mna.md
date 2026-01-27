# M&A Deals Data (SDC Platinum)

Access mergers and acquisitions deal data via the LSEG Data Library using `TR.MnA*` fields.

## Overview

M&A data comes from SDC Platinum (now integrated into LSEG). Like other deal databases, M&A queries return **multiple rows per company** (one per deal where the company was acquiror or target).

**Field count**: 2,683 fields available with TR.MnA* prefix.

## Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘MSFT.O’, ‘GOOGL.O’, ‘META.O’],
    fields=[
        ‘TR.MnAAnnouncementDate’,
        ‘TR.MnAAcquirorName’,
        ‘TR.MnATargetName’,
        ‘TR.MnADealValue’,
        ‘TR.MnADealStatus’,
        ‘TR.MnADealType’,
    ]
)
# Returns multiple rows per company (one per M&A deal)

ld.close_session()
```

## Available Fields

### Deal Identification

| Field | Description |
|-------|-------------|
| `TR.MnADealId` | SDC deal identifier |
| `TR.MnASdcDealNumber` | SDC deal number |
| `TR.MnADealType` | Deal type (Merger, Acquisition, etc.) |
| `TR.MnADealStatus` | Status (Completed, Pending, Withdrawn) |

### Key Dates

| Field | Description |
|-------|-------------|
| `TR.MnAAnnouncementDate` | Deal announcement date |
| `TR.MnACompletionDate` | Deal completion/closing date |
| `TR.MnAEffectiveDate` | Deal effective date |
| `TR.MnAWithdrawnDate` | Withdrawal date (if applicable) |

### Deal Value

| Field | Description |
|-------|-------------|
| `TR.MnADealValue` | Total deal value |
| `TR.MnAEquityValue` | Equity value |
| `TR.MnAEnterpriseValue` | Enterprise value |
| `TR.MnAPricePerShare` | Price per share offered |
| `TR.MnAPremium1Day` | Premium to 1-day prior price |
| `TR.MnAPremium1Week` | Premium to 1-week prior price |
| `TR.MnAPremium4Weeks` | Premium to 4-week prior price |

### Acquiror Information

| Field | Description |
|-------|-------------|
| `TR.MnAAcquirorName` | Acquiror company name |
| `TR.MnAAcquirorTicker` | Acquiror ticker symbol |
| `TR.MnAAcquirorCusip` | Acquiror CUSIP |
| `TR.MnAAcquirorNation` | Acquiror country |
| `TR.MnAAcquirorSIC` | Acquiror SIC code |
| `TR.MnAAcquirorPublicStatus` | Acquiror public/private status |

### Acquiror Financials

| Field | Description |
|-------|-------------|
| `TR.MnAAcquirorRevenueLTM` | Acquiror LTM revenue |
| `TR.MnAAcquirorEBITDALTM` | Acquiror LTM EBITDA |
| `TR.MnAAcquirorNetIncomeLTM` | Acquiror LTM net income |
| `TR.MnAAcquirorTotalAssetsLTM` | Acquiror total assets |
| `TR.MnAAcquirorMarketCap` | Acquiror market cap |

### Target Information

| Field | Description |
|-------|-------------|
| `TR.MnATargetName` | Target company name |
| `TR.MnATargetTicker` | Target ticker symbol |
| `TR.MnATargetCusip` | Target CUSIP |
| `TR.MnATargetNation` | Target country |
| `TR.MnATargetSIC` | Target SIC code |
| `TR.MnATargetPublicStatus` | Target public/private status |

### Target Financials

| Field | Description |
|-------|-------------|
| `TR.MnATargetRevenueLTM` | Target LTM revenue |
| `TR.MnATargetEBITDALTM` | Target LTM EBITDA |
| `TR.MnATargetNetIncomeLTM` | Target LTM net income |
| `TR.MnATargetTotalAssetsLTM` | Target total assets |
| `TR.MnATargetMarketCap` | Target market cap |

### Advisors

| Field | Description |
|-------|-------------|
| `TR.MnAAcquirorFinAdvisor` | Acquiror financial advisor |
| `TR.MnAAcquirorLegalAdvisor` | Acquiror legal counsel |
| `TR.MnATargetFinAdvisor` | Target financial advisor |
| `TR.MnATargetLegalAdvisor` | Target legal counsel |

### Deal Terms

| Field | Description |
|-------|-------------|
| `TR.MnAPaymentMethod` | Payment method (Cash, Stock, Mixed) |
| `TR.MnACashComponent` | Cash component value |
| `TR.MnAStockComponent` | Stock component value |
| `TR.MnADebtComponent` | Debt component value |
| `TR.MnAPercentSought` | Percent ownership sought |
| `TR.MnAPercentAcquired` | Percent actually acquired |

### Hostile/Defense

| Field | Description |
|-------|-------------|
| `TR.MnAHostile` | Hostile deal flag |
| `TR.MnADefenseTactics` | Defense tactics employed |
| `TR.MnARelatedPoisonPill` | Related poison pill deal |

## Example Output

| Instrument | Announcement Date | Acquiror | Target | Deal Value | Status |
|------------|-------------------|----------|--------|------------|--------|
| MSFT.O | 2022-01-18 | Microsoft Corp | Activision Blizzard | $68.7B | Completed |
| MSFT.O | 2021-04-12 | Microsoft Corp | Nuance Communications | $19.7B | Completed |
| GOOGL.O | 2019-11-01 | Alphabet Inc | Fitbit Inc | $2.1B | Completed |
| META.O | 2014-02-19 | Facebook Inc | WhatsApp Inc | $19.0B | Completed |

## Practical Workflow

### Query M&A for a Universe

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get S&P 500 constituents
sp500 = ld.get_data(universe=‘0#.SPX’, fields=[‘TR.CommonName’])
rics = sp500[‘Instrument’].tolist()

# Query M&A deals in batches
batch_size = 100
all_deals = []

for i in range(0, len(rics), batch_size):
    batch = rics[i:i+batch_size]
    df = ld.get_data(
        universe=batch,
        fields=[
            ‘TR.MnAAnnouncementDate’,
            ‘TR.MnAAcquirorName’,
            ‘TR.MnATargetName’,
            ‘TR.MnADealValue’,
            ‘TR.MnADealStatus’,
        ]
    )
    df = df.dropna(subset=[‘MnA Announcement Date’])
    all_deals.append(df)

mna_df = pd.concat(all_deals, ignore_index=True)

ld.close_session()
```

### Filter by Deal Type and Date

```python
# Filter to completed acquisitions in 2024
mna_df[‘MnA Announcement Date’] = pd.to_datetime(
    mna_df[‘MnA Announcement Date’]
)
recent_deals = mna_df[
    (mna_df[‘MnA Announcement Date’] >= ‘2024-01-01’) &
    (mna_df[‘Deal Status’] == ‘Completed’)
]
```

## Data Characteristics

- **Multiple rows per company**: Each M&A deal gets its own row
- **Bidirectional**: Company may appear as acquiror OR target
- **Historical depth**: Data goes back to 1970s
- **Global coverage**: Worldwide M&A transactions
- **Deal lifecycle**: Tracks from announcement through completion/withdrawal

## Limitations

1. **Must query by ticker**: Need a list of companies first, then query their M&A activity
2. **No direct SCREEN**: The `SCREEN(U(IN(DEALS)))` syntax only works in Workspace
3. **Rate limits**: Batch queries to avoid API limits

## Related SDC Datasets

- **Corporate Governance**: `TR.SACT*` (activism), `TR.PP*` (poison pills) - see `corporate-governance.md`
- **Syndicated Loans**: `TR.LN*` fields - see `syndicated-loans.md`
- **Equity/IPO**: `TR.NI*` fields - see `equity-new-issues.md`
