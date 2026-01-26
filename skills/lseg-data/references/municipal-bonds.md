# Municipal Bonds Data (SDC Platinum)

Access municipal bond issuance data via the LSEG Data Library using `TR.Muni*` fields.

## Overview

Municipal bond data comes from SDC Platinum. Unlike equity-based datasets, muni bonds must be queried using **deal IDs** (`@DEALID` suffix) rather than ticker symbols.

## Quick Start

```python
import lseg.data as ld

ld.open_session()

# Query by deal ID (obtained from SDC Platinum reports)
deal_ids = [
    ‘154089144377@DEALID’,
    ‘154089144290@DEALID’,
    ‘154089144305@DEALID’,
]

df = ld.get_data(
    universe=deal_ids,
    fields=[
        ‘TR.MuniIssuerName’,
        ‘TR.MuniIssueDescription’,
        ‘TR.MuniSaleDate’,
        ‘TR.MuniPrincipalAmount’,
        ‘TR.MuniIssuerState’,
        ‘TR.MuniRefundingStatus’,
    ]
)

ld.close_session()
```

## Available Fields

### Issue Identification

| Field | Description |
|-------|-------------|
| `TR.MuniDealId` | SDC deal identifier |
| `TR.MuniSdcDealNumber` | SDC deal number |
| `TR.MuniIssueNumber` | Issue number |
| `TR.MuniSeriesOfIssue` | Series designation |

### Issuer Information

| Field | Description |
|-------|-------------|
| `TR.MuniIssuerName` | Issuer full name |
| `TR.MuniIssuerState` | State of issuer |
| `TR.MuniIssuerPermid` | Issuer PermID |

### Issue Details

| Field | Description |
|-------|-------------|
| `TR.MuniIssueDescription` | Issue description (GO Bonds, Revenue Bonds, etc.) |
| `TR.MuniIssueOfferingType` | Offering type |
| `TR.MuniIssueBidType` | Bid type (Negotiated, Competitive) |
| `TR.MuniBackedSecurityType` | Security backing type |
| `TR.MuniRefundingStatus` | Refunding status (New Financing, Refunding) |
| `TR.MuniIsPreliminary` | Preliminary offering flag |

### Deal Classification

| Field | Description |
|-------|-------------|
| `TR.MuniSDCDealType` | SDC deal type |
| `TR.MuniSDCDealTypeCategory` | Deal type category (TE = Tax Exempt) |

### Financials

| Field | Description |
|-------|-------------|
| `TR.MuniPrincipalAmount` | Principal/par amount |
| `TR.MuniAmountOfMaturity` | Amount at maturity |
| `TR.MuniCallPriceOfMaturity` | Call price at maturity |

### Coupon & Yield

| Field | Description |
|-------|-------------|
| `TR.MuniBeginningSerialOrTermCoupon` | Beginning serial/term coupon rate |
| `TR.MuniFinalEndingSerialCouponRate` | Final ending serial coupon rate |
| `TR.MuniCouponAnyMaturity` | Coupon for any maturity |
| `TR.MuniBeginningSerialOrTermYieldAmount` | Beginning yield amount |
| `TR.MuniFinalEndingSerialPriceYield` | Final ending price/yield |
| `TR.MuniYieldAnyMaturity` | Yield for any maturity |

### Dates

| Field | Description |
|-------|-------------|
| `TR.MuniSaleDate` | Sale/pricing date |
| `TR.MuniIssueDatedDate` | Issue dated date |
| `TR.MuniBeginningSerialOrTermMaturityDate` | Beginning maturity date |
| `TR.MuniFinalEndingSerialMaturity` | Final maturity date |
| `TR.MuniAmountOfMaturityDate` | Maturity date for amount |
| `TR.MuniYearToMaturity` | Years to maturity |

### Underwriters

| Field | Description |
|-------|-------------|
| `TR.MuniAllManagersCode` | All underwriter/manager codes |

## Example Output

| Instrument | Issuer Name | Issue Description | Sale Date | Par Amount | State |
|------------|-------------|-------------------|-----------|------------|-------|
| 154089144377 | New York City | General Obligation Bonds | 2025-01-15 | $500,000,000 | New York |
| 154089144290 | California State | Revenue Bonds | 2025-01-14 | $250,000,000 | California |
| 154089144305 | Texas Water Dev Bd | Water Revenue Bonds | 2025-01-13 | $150,000,000 | Texas |

## Workflow: Getting Deal IDs

Since muni bonds require deal IDs, you need to first obtain them from SDC Platinum:

1. **Run a query in SDC Platinum** (e.g., last 90 days of tax-exempt issuances)
2. **Export the deal IDs** from the results
3. **Query via Python API** using the `@DEALID` suffix

```python
# Example: Query deals exported from SDC
deal_ids = [‘154089144377@DEALID’, ‘154089144290@DEALID’]  # From SDC export

df = ld.get_data(
    universe=deal_ids,
    fields=[‘TR.MuniIssuerName’, ‘TR.MuniPrincipalAmount’, ‘TR.MuniSaleDate’]
)
```

## Data Characteristics

- **Deal ID-based queries**: Must use `@DEALID` suffix, not ticker symbols
- **Tax-exempt focus**: Primary coverage of tax-exempt municipal issuances
- **Detailed maturity schedules**: Serial and term bond structures
- **Underwriter data**: Lead and co-manager information

## Limitations

1. **No ticker-based queries**: Must have deal IDs from SDC Platinum first
2. **No direct SCREEN**: Cannot screen muni universe via Python API
3. **Rate limits**: Batch deal ID queries to avoid API limits

## Related SDC Datasets

- **Syndicated Loans**: `TR.LN*` fields - see `syndicated-loans.md`
- **Infrastructure/Project Finance**: `TR.PJF*` fields - see `infrastructure.md`
- **Private Equity**: `TR.PEInvest*` fields - see `private-equity.md`

## Discovering More Fields

The fields documented here were captured from specific SDC reports. To discover additional fields:

1. **Open the Column Picker** in SDC Platinum while network monitoring is active
2. **Run different report templates** to capture fields used in each
3. **Check field patterns** - try variations like `TR.MuniCUSIP`, `TR.MuniRating*`, etc.
