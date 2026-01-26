# Private Equity / Venture Capital Data (SDC Platinum)

Access private equity and venture capital investment data via the LSEG Data Library using `TR.PEInvest*` fields.

## Overview

Private Equity/VC data comes from SDC Platinum. Queries return **multiple rows per company** (one per investment round where the company received funding).

## Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘UBER.N’, ‘ABNB.OQ’, ‘SNOW.N’, ‘PLTR.N’],  # PE-backed companies
    fields=[
        ‘TR.PEInvestCompanyName’,
        ‘TR.PEInvestRoundDate’,
        ‘TR.PEInvestRoundEquityTotal’,
        ‘TR.PEInvestCompanyNation’,
        ‘TR.PEInvestCompanyAllInvestorFirms’,
        ‘TR.PEInvestCompanyCurrentOperatingStage’,
    ]
)
# Returns multiple rows per company (one per investment round)

ld.close_session()
```

## Available Fields

### Investment Round Details

| Field | Description |
|-------|-------------|
| `TR.PEInvestDealId` | Investment round deal ID |
| `TR.PEInvestRoundDate` | Date of investment round |
| `TR.PEInvestRoundEquityTotal` | Total equity raised in round |
| `TR.PEInvestBuyoutValue` | Buyout transaction value |
| `TR.PEInvestRankValue` | Ranking value for deal |
| `TR.PEInvestAgeAtFinancingInMonths` | Company age at time of financing |
| `TR.PEInvestDisclosedPostRoundCompanyValuation` | Post-money valuation |
| `TR.PEInvestPostRoundCompanyValuationDirection` | Valuation direction (up/down) |

### Investee Company Information

| Field | Description |
|-------|-------------|
| `TR.PEInvestCompanyName` | Company name |
| `TR.PEInvestCompanyAliasName` | Company alias/trade name |
| `TR.PEInvestCompanyNation` | Company country |
| `TR.PEInvestInvesteeBEID` | Investee company BEID |
| `TR.PEInvestInvesteePermID` | Investee PermID |
| `TR.PEInvestCompanyPermID` | Company PermID |
| `TR.PEInvestCompanyTRBCEconomicSector` | TRBC economic sector |
| `TR.PEInvestCompanyBusinessDescriptionShort` | Short business description |
| `TR.PEInvestCompanyBusinessDescriptionLong` | Detailed business description |
| `TR.PEInvestCompanyWebsite` | Company website |
| `TR.PEInvestCompanyStatus` | Company status |
| `TR.PEInvestCompanyFoundedDate` | Date company was founded |

### Company Operating Status

| Field | Description |
|-------|-------------|
| `TR.PEInvestCompanyCurrentOperatingStage` | Current operating stage |
| `TR.PEInvestCompanyCurrentPublicStatus` | Public/private status |
| `TR.PEInvestCompanyPortfolioStatus` | Portfolio company status |
| `TR.PEInvestCompanyIPODate` | IPO date (if applicable) |
| `TR.PEInvestCompanyPrimaryCustomerType` | Primary customer type (B2B/B2C) |
| `TR.PEInvestCompanyNumberOfEmployeesMostRecentYearEnd` | Employee count |

### Investor Information

| Field | Description |
|-------|-------------|
| `TR.PEInvestFirmInvestorBEID` | Investor firm BEID |
| `TR.PEInvestFundInvestorBEID` | Investor fund BEID |
| `TR.PEInvestCompanyAllInvestorFirms` | All investor firms (all rounds) |
| `TR.PEInvestCompanyAllInvestorFunds` | All investor funds (all rounds) |
| `TR.PEInvestCompanyCurrentInvestorFirms` | Current investor firms |
| `TR.PEInvestCompanyCurrentInvestorFunds` | Current investor funds |
| `TR.PEInvestCompanyHistoricalInvestorFirms` | Historical investor firms |
| `TR.PEInvestCompanyHistoricalInvestorFunds` | Historical investor funds |

### Investment History (Company Level)

| Field | Description |
|-------|-------------|
| `TR.PEInvestCompanyFirstInvestmentReceivedDate` | First investment date |
| `TR.PEInvestCompanyLastInvestmentReceivedDate` | Most recent investment date |
| `TR.PEInvestCompanyNumberOfInvestmentsReceivedToDate` | Total investment rounds |
| `TR.PEInvestCompanyNumberOfInvestorFirmsToDate` | Total investor firms |
| `TR.PEInvestCompanyNumberOfInvestorFundsToDate` | Total investor funds |
| `TR.PEInvestCompanyEstEquityReceivedToDate` | Total equity received |

### ESG and Classification

| Field | Description |
|-------|-------------|
| `TR.PEInvestCompanyisSustainable` | Sustainable company flag |
| `TR.PEInvestCompanyisRealEstateProperty` | Real estate property flag |

### Contact Information

| Field | Description |
|-------|-------------|
| `TR.PEInvestCompanyPhoneNumber` | Company phone |
| `TR.PEInvestCompanyBranchPhone` | Branch phone |
| `TR.PEInvestCompanyFaxNumber` | Company fax |
| `TR.PEInvestCompanyBranchFax` | Branch fax |

## Example Output

| Instrument | Company Name | Round Date | Round Equity | Nation | Investor Firms |
|------------|--------------|------------|--------------|--------|----------------|
| UBER.N | Uber Technologies Inc | 2011-02-14 | $1,250,000 | United States | Benchmark; First Round; Lowercase... |
| UBER.N | Uber Technologies Inc | 2013-08-14 | $258,000,000 | United States | Google Ventures; TPG; Benchmark... |
| ABNB.OQ | Airbnb Inc | 2011-07-25 | $112,000,000 | United States | Andreessen Horowitz; DST Global... |
| SNOW.N | Snowflake Inc | 2017-04-06 | $100,000,000 | United States | Iconiq Capital; Altimeter... |

## Practical Workflow

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get recently IPO’d tech companies
recent_ipos = ld.get_data(
    universe=’SCREEN(U(IN(Equity(active,public,primary))),IN(TR.TRBCEconSectorCode,”57”),TR.IPODate>=2020-01-01,CURN=USD)’,
    fields=[‘TR.CommonName’, ‘TR.IPODate’]
)
rics = recent_ipos[‘Instrument’].tolist()[:50]  # Limit to 50

# Get their PE/VC funding history
pe_fields = [
    ‘TR.PEInvestCompanyName’,
    ‘TR.PEInvestRoundDate’,
    ‘TR.PEInvestRoundEquityTotal’,
    ‘TR.PEInvestCompanyAllInvestorFirms’,
    ‘TR.PEInvestCompanyCurrentOperatingStage’,
]

# Query in batches
batch_size = 25
all_pe_data = []

for i in range(0, len(rics), batch_size):
    batch = rics[i:i+batch_size]
    df = ld.get_data(universe=batch, fields=pe_fields)
    df = df.dropna(subset=[‘Investee Company Name’])
    all_pe_data.append(df)

pe_df = pd.concat(all_pe_data, ignore_index=True)

ld.close_session()
```

## Data Characteristics

- **Multiple rows per company**: Each investment round gets its own row
- **Investee-centric**: Data is about companies that received investment, not the PE/VC firms
- **Investor details**: Full list of investor firms and funds per round
- **Historical depth**: Investment history going back to company founding
- **Valuation data**: Post-round valuations when disclosed

## Limitations

1. **Must query by ticker**: Need a list of target companies (investees) first
2. **No direct SCREEN for deals**: `SCREEN(U(IN(PRIVATEEQUITY)))` only works in Workspace
3. **Rate limits**: Batch queries to avoid API limits
4. **Large result sets**: Well-funded companies can have many rounds (Uber has 40+ rows)

## Related SDC Datasets

- **Syndicated Loans**: `TR.LN*` fields - see `syndicated-loans.md`
- **Infrastructure/Project Finance**: `TR.PJF*` fields - see `infrastructure.md`
- **Corporate Governance**: `TR.SACT*`, `TR.PP*` fields - see `corporate-governance.md`
