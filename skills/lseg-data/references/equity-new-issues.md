# Equity/New Issues Data (SDC Platinum)

Access equity offerings (IPOs, follow-ons, secondary offerings) via the LSEG Data Library using `TR.NI*` fields.

## Overview

Equity new issues data comes from SDC Platinum. Like other deal databases, queries return **multiple rows per company** (one per offering).

**Field count**: 1,708 fields available with TR.NI* prefix.

## Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘AAPL.O’, ‘MSFT.O’, ‘GOOGL.O’],
    fields=[
        ‘TR.NIIssuer’,
        ‘TR.NIPricingDate’,
        ‘TR.NIOfferPrice’,
        ‘TR.NIProceeds’,
        ‘TR.NIIssueType’,
        ‘TR.NIBookrunner’,
    ]
)
# Returns multiple rows per company (one per equity offering)

ld.close_session()
```

## Available Fields

### Issue Identification

| Field | Description |
|-------|-------------|
| `TR.NISDCDealNumber` | SDC deal number |
| `TR.NIIssuer` | Issuer/Borrower name |
| `TR.NIIssuerShortName` | Issuer short name |
| `TR.NIIssuerParent` | Issuer immediate parent name |
| `TR.NIIssuerUltParent` | Issuer ultimate parent name |
| `TR.NICompLongName` | Full company name |

### Key Dates

| Field | Description |
|-------|-------------|
| `TR.NIPricingDate` | Date issue was priced |
| `TR.NIFilingDate` | SEC filing date |
| `TR.NIFoundedDate` | Date company was founded |
| `TR.NIGenDate` | Date of fundamental company change |

### Deal Value/Pricing

| Field | Description |
|-------|-------------|
| `TR.NIOfferPrice` | Offer price per share |
| `TR.NIProceeds` | Total proceeds from offering |
| `TR.NISharesOffered` | Number of shares offered |
| `TR.NIOverallotment` | Overallotment shares (greenshoe) |

### Issue Type/Structure

| Field | Description |
|-------|-------------|
| `TR.NIIssueType` | Issue type (IPO, Follow-on, etc.) |
| `TR.NIPubStatus` | Public status (P=public, V=private, S=subsidiary) |
| `TR.NIPubMid` | Mid-level public status |
| `TR.NIIsFinancialSponsor` | Financial sponsor flag |

### Issuer Information

| Field | Description |
|-------|-------------|
| `TR.NICity` | City of headquarters |
| `TR.NIStateHQ` | State of headquarters |
| `TR.NINationHQ` | Nation of headquarters |
| `TR.NIRegionHQ` | Region of headquarters |
| `TR.NIEmployees` | Number of employees |
| `TR.NIStreetAddress` | Street address |
| `TR.NIPhoneNumber` | Phone number |

### Industry Classification

| Field | Description |
|-------|-------------|
| `TR.NISdcIndustry` | SDC industry code |
| `TR.NIMajorIndustry` | Major industry group |
| `TR.NIMacroIndustry` | Macro industry (14 classifications) |
| `TR.NIMidIndustry` | Mid-level industry (85+ categories) |
| `TR.NIIssuerSic` | Issuer SIC code |
| `TR.NIIssuerNaics` | Issuer NAICS 2007 code |
| `TR.NIIssuerNaics2022` | Issuer NAICS 2022 code |
| `TR.NIIssuerHiTech` | High-tech industry classification |

### TRBC Classification

| Field | Description |
|-------|-------------|
| `TR.NITRBCEconomicSector` | TRBC Economic Sector |
| `TR.NITRBCBusinessSector` | TRBC Business Sector |
| `TR.NITRBCIndustryGroup` | TRBC Industry Group |
| `TR.NITRBCIndustry` | TRBC Industry |
| `TR.NITRBCActivity` | TRBC Activity |

### Identifiers

| Field | Description |
|-------|-------------|
| `TR.NISDCCusip` | SDC 6-digit CUSIP |
| `TR.NIPrimaryTickerSymbol` | Primary ticker symbol |
| `TR.NIPrimaryStockExch` | Primary stock exchange |
| `TR.NICompSedol` | SEDOL identifier |
| `TR.NIDataStream` | Datastream code |

### Stakeholders

| Field | Description |
|-------|-------------|
| `TR.NIBookrunner` | Lead bookrunner |
| `TR.NIStrategicInvestor` | Strategic investor name |
| `TR.NISellingShareholder` | Selling shareholder name |
| `TR.NISignificantShareholder` | Significant shareholder name |
| `TR.NIInvestor` | Investor name |
| `TR.NIGuarantorNation` | Guarantor nation |

### Spinoff/Related Companies

| Field | Description |
|-------|-------------|
| `TR.NISpinoffParent` | Spinoff parent name |
| `TR.NISpinoffParentSic` | Spinoff parent SIC code |

### REIT/Specialized

| Field | Description |
|-------|-------------|
| `TR.NIREITType` | REIT type classification |
| `TR.NIIssuerREITSgmt` | REIT segment (Hotel, Office, etc.) |

### Flags

| Field | Description |
|-------|-------------|
| `TR.NIIsCertBCorpCompany` | Certified B Corporation flag |
| `TR.NIIsDivision` | Division flag |
| `TR.NIIsSupranational` | Supranational flag |

## Example Output

| Instrument | Issuer | Pricing Date | Offer Price | Proceeds | Type |
|------------|--------|--------------|-------------|----------|------|
| SNOW.N | Snowflake Inc | 2020-09-15 | $120.00 | $3.4B | IPO |
| ABNB.O | Airbnb Inc | 2020-12-09 | $68.00 | $3.5B | IPO |
| RIVN.O | Rivian Automotive | 2021-11-09 | $78.00 | $11.9B | IPO |

## Practical Workflow

### Query IPOs for a Universe

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get tech companies
tech_rics = [‘AAPL.O’, ‘MSFT.O’, ‘GOOGL.O’, ‘META.O’, ‘AMZN.O’]

# Query equity offerings
df = ld.get_data(
    universe=tech_rics,
    fields=[
        ‘TR.NIIssuer’,
        ‘TR.NIPricingDate’,
        ‘TR.NIOfferPrice’,
        ‘TR.NIProceeds’,
        ‘TR.NIIssueType’,
        ‘TR.NIBookrunner’,
        ‘TR.NIPrimaryStockExch’,
    ]
)

# Filter to actual IPOs (not NaN pricing dates)
df = df.dropna(subset=[‘NI Pricing Date’])

ld.close_session()
```

### Filter by Date and Issue Type

```python
# Filter to recent IPOs
df[‘NI Pricing Date’] = pd.to_datetime(df[‘NI Pricing Date’])
recent_ipos = df[
    (df[‘NI Pricing Date’] >= ‘2020-01-01’) &
    (df[‘NI Issue Type’] == ‘IPO’)
]
```

## Data Characteristics

- **Multiple rows per company**: Each equity offering gets its own row
- **Historical depth**: Data goes back to 1970s
- **Global coverage**: Worldwide equity offerings
- **Issue lifecycle**: Tracks from filing through pricing

## Field Categories Summary

| Category | Field Count | Prefix Pattern |
|----------|-------------|----------------|
| Issuer Information | ~200 | TR.NIIssuer*, TR.NIComp* |
| Strategic Investors | ~50 | TR.NIStrategicInvestor* |
| Selling Shareholders | ~50 | TR.NISellingShareholder* |
| Significant Shareholders | ~50 | TR.NISignificantShareholder* |
| Investors | ~50 | TR.NIInvestor* |
| Spinoff Parents | ~30 | TR.NISpinoffParent* |
| Industry Classifications | ~100 | TR.NISic*, TR.NINaics*, TR.NITRBC* |
| Geographic | ~50 | TR.NICity, TR.NIState*, TR.NINation* |

## Limitations

1. **Must query by ticker**: Need a list of companies first, then query their offerings
2. **Rate limits**: Batch queries to avoid API limits (max 10,000 data points/request)
3. **Field availability**: Not all fields populated for all offerings

## Related SDC Datasets

- **M&A**: `TR.MnA*` fields - see `mna.md`
- **Private Equity**: `TR.PEInvest*` fields - see `private-equity.md`
- **Syndicated Loans**: `TR.LN*` fields - see `syndicated-loans.md`
