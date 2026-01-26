# Syndicated Loans Data (SDC Platinum)

Access syndicated loan deal data via the LSEG Data Library using `TR.LN*` fields.

## Overview

Syndicated loans data comes from SDC Platinum (now integrated into LSEG). Like corporate governance data, loan queries return **multiple rows per company** (one per loan facility/tranche).

## Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘F.N’, ‘GM.N’, ‘T.N’, ‘BA.N’],
    fields=[
        ‘TR.LNAnnouncementDate’,
        ‘TR.LNIssuerShortName’,
        ‘TR.LNTotalFacilityAmount’,
        ‘TR.LNTrancheAmount’,
        ‘TR.LNTrancheType’,
        ‘TR.LNPricingRange’,
        ‘TR.LNStatusOfLoan’,
    ]
)
# Returns multiple rows per company (one per loan facility)

ld.close_session()
```

## Available Fields

| Field | Description |
|-------|-------------|
| **Loan Identification** | |
| `TR.LNDealId` | SDC deal identifier |
| `TR.LNSdcDealNum` | SDC deal number |
| `TR.LNDocumentControlNumber` | Document control number |
| **Dates** | |
| `TR.LNAnnouncementDate` | Loan announcement date |
| **Borrower Information** | |
| `TR.LNIssuerShortName` | Borrower/issuer name |
| `TR.LNIssuerSDCCusip` | Borrower CUSIP |
| **Loan Structure** | |
| `TR.LNTotalFacilityAmount` | Total facility/package amount |
| `TR.LNTrancheAmount` | Individual tranche amount |
| `TR.LNTrancheType` | Tranche type (Term Loan A/B, Revolver, etc.) |
| `TR.LNNumberOfTranchesInFacility` | Number of tranches |
| `TR.LNMaturityDesc` | Maturity description |
| **Pricing** | |
| `TR.LNPricingRange` | Pricing spread (e.g., “Term SOFR +150.000 bps”) |
| `TR.LNAllFeesStatedInRange` | All-in fees |
| **Status & Market** | |
| `TR.LNStatusOfLoan` | Status (Closed, In Process, Awaiting Mandate) |
| `TR.LNTargetMarket` | Target market |
| **Participants** | |
| `TR.LNLeadManagerCode` | Lead arranger/manager code |
| **Ratings** | |
| `TR.LNMoodysLongTermCorpDebtFacilityRating` | Moody’s facility rating |
| `TR.LNSAndPLongTermCorpDebtFacilityRating` | S&P facility rating |

## Common Loan Types

| Type | Description |
|------|-------------|
| Term Loan A | Amortizing term loan, typically held by banks |
| Term Loan B | Institutional term loan, bullet repayment |
| Revolving Credit Facility | Drawable/repayable credit line |
| 364 Day Revolver | Short-term revolving facility |
| Delayed Draw Term Loan | Commitment to fund term loan later |

## Example Output

| Instrument | Announcement Date | Borrower | Package Amount | Tranche | Type | Pricing |
|------------|-------------------|----------|----------------|---------|------|---------|
| F.N | 2025-04-17 | Ford Motor Co | $18B | $10.1B | Revolving Credit | SOFR +150bp |
| F.N | 2025-04-17 | Ford Motor Co | $18B | $2B | 364 Day Revolver | SOFR +150bp |
| GM.N | 2025-03-16 | General Motors Co | $14.1B | $10B | Revolving Credit | SOFR +125bp |
| GM.N | 2025-03-16 | General Motors Co | $14.1B | $4.1B | Revolving Credit | SOFR +125bp |

## Practical Workflow

### Get Loans for a Universe

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get S&P 500 constituents
sp500 = ld.get_data(universe=‘0#.SPX’, fields=[‘TR.CommonName’])
rics = sp500[‘Instrument’].tolist()

# Query loans in batches
batch_size = 100
all_loans = []

for i in range(0, len(rics), batch_size):
    batch = rics[i:i+batch_size]
    df = ld.get_data(
        universe=batch,
        fields=[
            ‘TR.LNAnnouncementDate’,
            ‘TR.LNIssuerShortName’,
            ‘TR.LNTotalFacilityAmount’,
            ‘TR.LNTrancheType’,
            ‘TR.LNPricingRange’,
        ]
    )
    # Filter to rows with actual data
    df = df.dropna(subset=[‘Loan Dates: Announcement Date’])
    all_loans.append(df)

loans_df = pd.concat(all_loans, ignore_index=True)

ld.close_session()
```

### Filter by Date

```python
# Filter to recent loans (2024-2025)
loans_df[‘Loan Dates: Announcement Date’] = pd.to_datetime(
    loans_df[‘Loan Dates: Announcement Date’]
)
recent_loans = loans_df[
    loans_df[‘Loan Dates: Announcement Date’] >= ‘2024-01-01’
]
```

## Data Characteristics

- **Multiple rows per company**: Each loan facility and tranche gets its own row
- **Historical depth**: Data goes back to late 1990s
- **Currency**: Amounts typically in USD (controlled by CURN parameter in Workspace)
- **Status tracking**: Shows loan lifecycle from “Awaiting Mandate” to “Closed”
- **Pricing evolution**: Historical loans show LIBOR spreads, recent loans show SOFR

## Limitations

1. **Must query by ticker**: Like corporate governance, you need a list of target companies first
2. **No direct SCREEN**: The `SCREEN(U(IN(DEALS)))` syntax only works in Workspace, not via Python API
3. **Rate limits**: Batch queries to avoid hitting API limits

## Related SDC Datasets

- **Corporate Governance**: `TR.SACT*` (activism), `TR.PP*` (poison pills) - see `corporate-governance.md`
- **M&A Deals**: `TR.MnA*` fields (not yet tested)
- **IPOs/New Issues**: `TR.NI*` fields (not yet tested)
