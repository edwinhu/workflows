# Joint Ventures & Strategic Alliances Data (SDC Platinum)

Access joint venture and strategic alliance data via the LSEG Data Library using `TR.JV*` fields.

## Overview

Joint venture/strategic alliance data comes from SDC Platinum. Queries return **multiple rows per company** (one per alliance where the company is a participant).

**Field count**: 301 fields available with TR.JV* prefix.

## Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘MSFT.O’, ‘GOOGL.O’, ‘AAPL.O’],
    fields=[
        ‘TR.JVDealName’,
        ‘TR.JVDateAnnounced’,
        ‘TR.JVDateCompleted’,
        ‘TR.JVStatus’,
        ‘TR.JVIsAJointVenture’,
        ‘TR.JVParticipantName’,
    ]
)
# Returns multiple rows per company (one per alliance)

ld.close_session()
```

## Available Fields

### Deal Identification

| Field | Description |
|-------|-------------|
| `TR.JVDealId` | Joint venture/strategic alliance deal identifier |
| `TR.JVSDCDealNumber` | SDC deal number |
| `TR.JVDealName` | Deal name (participants + type) |
| `TR.JVJVName` | Joint venture company name (if JV flag is True) |

### Key Dates

| Field | Description |
|-------|-------------|
| `TR.JVDateAnnounced` | Announcement date |
| `TR.JVDateCompleted` | Completion/signing date |
| `TR.JVDateSought` | Date partner sought |
| `TR.JVDateExpired` | Expiration date |
| `TR.JVDateExtended` | Extension date |
| `TR.JVDateTerminated` | Termination date |
| `TR.JVDateRenegotiated` | Renegotiation date |
| `TR.JVDateExpirationExpected` | Expected expiration date |

### Status

| Field | Description |
|-------|-------------|
| `TR.JVStatus` | Current status (S=Seeking, P=Pending, C=Completed, T=Terminated) |
| `TR.JVJointVentureType` | JV type (NF=Newly Formed, AM=Assets Merged, PA=Pct Acquired) |

### Alliance Type Flags

| Field | Description |
|-------|-------------|
| `TR.JVIsAJointVenture` | Joint venture flag (creates independent business entity) |
| `TR.JVIsAStrategicAlliance` | Strategic alliance flag (no independent entity) |
| `TR.JVIsALicensingAgreement` | Licensing agreement flag |
| `TR.JVIsAnExclusiveLicensingAgreement` | Exclusive licensing flag |
| `TR.JVIsAResearchAndDevtAgreement` | R&D agreement flag |
| `TR.JVIsAManufacturingAgreement` | Manufacturing agreement flag |
| `TR.JVIsAMarketingAgreement` | Marketing agreement flag |
| `TR.JVIsASupplyAgreement` | Supply agreement flag |
| `TR.JVIsAnOEM` | OEM/VAR agreement flag |
| `TR.JVIsAnExplorationAgreement` | Exploration agreement flag |
| `TR.JVIsAFundingAgreement` | Funding agreement flag |
| `TR.JVIsARoyaltyAgreement` | Royalty agreement flag |

### Technique Flags

| Field | Description |
|-------|-------------|
| `TR.JVIsCrossBorder` | Cross-border flag |
| `TR.JVHasCrossBorderParticipants` | Cross-border participants flag |
| `TR.JVHasTechnologyTransfer` | Technology transfer flag |
| `TR.JVHasCrossTechnologyTransfer` | Cross technology transfer flag |
| `TR.JVHasCrossLicensingAgreement` | Cross-licensing flag |
| `TR.JVHasEquityStakePurchase` | Equity stake purchase flag |
| `TR.JVHasEquityTransferAgreement` | Equity transfer flag |
| `TR.JVIsCrossEquityTransfer` | Cross equity transfer flag |
| `TR.JVIsASpinout` | Spinout flag |
| `TR.JVIsPrivatization` | Privatization flag |
| `TR.JVIsLeveraged` | Leveraged JV flag |

### Participant Information

| Field | Description |
|-------|-------------|
| `TR.JVParticipant` | Participant PermID |
| `TR.JVParticipantName` | Participant long name |
| `TR.JVParticipantShortName` | Participant short name |
| `TR.JVParticipantSDCCusip` | Participant CUSIP |
| `TR.JVParticipantNation` | Participant nation |
| `TR.JVParticipantPublicStatus` | Participant public status (P/V/S/G/J) |
| `TR.JVParticipantCity` | Participant city |
| `TR.JVParticipantState` | Participant state |
| `TR.JVParticipantRole` | Participant role |
| `TR.JVNumOfParticipants` | Total number of participants |

### Participant Ownership

| Field | Description |
|-------|-------------|
| `TR.JVParticipantTotalOwnership` | Total percentage held in JV |
| `TR.JVParticipantOriginalOwnership` | Original percentage held |
| `TR.JVParticipantOptionalOwnership` | Optional increase percentage |
| `TR.JVIsOwnershipEstimated` | Ownership estimated flag |
| `TR.JVIsStakeOptionAvailable` | Stake option available flag |

### Participant Industry

| Field | Description |
|-------|-------------|
| `TR.JVParticipantSic` | Participant SIC codes |
| `TR.JVParticipantPrimarySic` | Participant primary SIC |
| `TR.JVParticipantVeic` | Participant VEIC codes |
| `TR.JVParticipantPrimaryVeic` | Participant primary VEIC |
| `TR.JVParticipantHiTech` | Participant high-tech industry |
| `TR.JVParticipantSdcIndustry` | Participant SDC industry |

### Participant Hierarchy

| Field | Description |
|-------|-------------|
| `TR.JVParticipantParentShortName` | Participant parent name |
| `TR.JVParticipantParentSDCCusip` | Participant parent CUSIP |
| `TR.JVParticipantUltParentShortName` | Participant ultimate parent name |
| `TR.JVParticipantUltParentSDCCusip` | Participant ultimate parent CUSIP |
| `TR.JVParticipantUltParentNation` | Participant ultimate parent nation |

### Joint Venture Company

| Field | Description |
|-------|-------------|
| `TR.JVJVName` | JV company name |
| `TR.JVJointVentureSDCCusip` | JV CUSIP |
| `TR.JVJointVenturePublicStatus` | JV public status |
| `TR.JVJointVentureEmployees` | JV number of employees |
| `TR.JVJointVenturePrimarySic` | JV primary SIC |
| `TR.JVJointVentureStockExch` | JV stock exchange |
| `TR.JVJointVentureTicker` | JV ticker symbol |

### Alliance Geography

| Field | Description |
|-------|-------------|
| `TR.JVAllianceNation` | Alliance nation |
| `TR.JVAllianceNationRegion` | Alliance nation region |
| `TR.JVAllianceState` | Alliance state |
| `TR.JVAllianceCity` | Alliance city |
| `TR.JVAllianceStateLaw` | Alliance jurisdiction state |

### Alliance Industry

| Field | Description |
|-------|-------------|
| `TR.JVAllianceActivity` | Alliance activities |
| `TR.JVAllianceSic` | Alliance SIC codes |
| `TR.JVAlliancePrimarySic` | Alliance primary SIC |
| `TR.JVAllianceVeic` | Alliance VEIC codes |
| `TR.JVAlliancePrimaryVeic` | Alliance primary VEIC |
| `TR.JVAllianceHiTech` | Alliance high-tech codes |
| `TR.JVAllianceMajorIndustry` | Alliance major industry |
| `TR.JVAllianceTechnique` | Alliance technique codes |

### Financial Estimates

| Field | Description |
|-------|-------------|
| `TR.JVEstimatedCapitalizationValue` | Estimated capitalization |
| `TR.JVEstimatedAssetValue` | Estimated asset value |
| `TR.JVEstimatedCostValue` | Estimated cost |
| `TR.JVEstimatedFundingValue` | Estimated funding amount |
| `TR.JVEstimatedSalesValue` | Estimated annual sales |
| `TR.JVEstimatedLicenseFeeValue` | Estimated license fee |
| `TR.JVEstimatedRoyaltyFeeValue` | Estimated royalty fee |
| `TR.JVEstimatedSFBridgeLoanValue` | Estimated bridge loan value |
| `TR.JVEstimatedOtherValue` | Other estimated value |

### Deal Terms

| Field | Description |
|-------|-------------|
| `TR.JVExpectedTotalLength` | Expected total length (years) |
| `TR.JVExpectedOriginalLength` | Expected original length (years) |
| `TR.JVHasOpenEndedLength` | Open-ended length flag |
| `TR.JVSourceOfFunds` | Source of funds codes |
| `TR.JVRegulatoryAgency` | Regulatory agencies required |

### Deal Text

| Field | Description |
|-------|-------------|
| `TR.JVDealSynopsis` | Deal synopsis text |
| `TR.JVApplicationAndTechnologyDesc` | Application and technology text |
| `TR.JVCapitalizationAndFinancingDesc` | Capitalization and financing text |
| `TR.JVSourceOfFundsDesc` | Source of funds text |

### History Events

| Field | Description |
|-------|-------------|
| `TR.JVHistoryEventDate` | Historic event date |
| `TR.JVHistoryEventDesc` | Historic event text |

### Advisors

| Field | Description |
|-------|-------------|
| `TR.JVFinAdvisor` | Financial advisor name |
| `TR.JVFinAdvisorCode` | Financial advisor code |
| `TR.JVLegAdvisor` | Legal advisor name |
| `TR.JVLegAdvisorCode` | Legal advisor code |
| `TR.JVAuditor` | Auditor name |
| `TR.JVAuditorCode` | Auditor code |
| `TR.JVAdvisorAndRole` | Advisor and role |

### Related Deals

| Field | Description |
|-------|-------------|
| `TR.JVRelatedJVSDCDealNumber` | Related alliance deal number |
| `TR.JVRelatedJVDealName` | Related alliance deal name |
| `TR.JVRelatedJVStatus` | Related alliance status |
| `TR.JVRelatedMnASDCDealNumber` | Related M&A deal number |
| `TR.JVRelatedMnAAcquirorShortName` | Related M&A acquiror name |
| `TR.JVRelatedMnATargetShortName` | Related M&A target name |
| `TR.JVRelatedMnADealValue` | Related M&A deal value |
| `TR.JVRelatedSPSDCDealNumber` | Related M&A stake purchase deal number |

### Contact Information

| Field | Description |
|-------|-------------|
| `TR.JVContactName` | Contact person name |
| `TR.JVContactEmail` | Contact email |
| `TR.JVContactPhoneNo` | Contact phone |
| `TR.JVContactWebsite` | Contact website |

## Example Output

| Instrument | Deal Name | Date Announced | Status | JV Flag |
|------------|-----------|----------------|--------|---------|
| MSFT.O | Microsoft/OpenAI-Strategic Alliance | 2019-07-22 | Completed | False |
| GOOGL.O | Google/Samsung-Joint Venture | 2020-01-15 | Completed | True |
| AAPL.O | Apple/IBM-Strategic Alliance | 2014-07-15 | Completed | False |

## Practical Workflow

### Query Alliances for a Universe

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get tech companies
tech_rics = [‘MSFT.O’, ‘GOOGL.O’, ‘META.O’, ‘AMZN.O’]

# Query joint ventures and strategic alliances
df = ld.get_data(
    universe=tech_rics,
    fields=[
        ‘TR.JVDealName’,
        ‘TR.JVDateAnnounced’,
        ‘TR.JVDateCompleted’,
        ‘TR.JVStatus’,
        ‘TR.JVIsAJointVenture’,
        ‘TR.JVIsAStrategicAlliance’,
        ‘TR.JVParticipantShortName’,
        ‘TR.JVAllianceActivity’,
    ]
)

# Filter to actual alliances
df = df.dropna(subset=[‘JV Date Announced’])

ld.close_session()
```

### Filter by Alliance Type

```python
# Filter to joint ventures only (independent entity created)
jvs = df[df[‘JV Is A Joint Venture’] == True]

# Filter to strategic alliances only (no independent entity)
sas = df[df[‘JV Is A Strategic Alliance’] == True]

# Filter to R&D alliances
rd_alliances = df[df[‘JV Is A Research And Devt Agreement’] == True]
```

### Filter by Status

```python
# Status codes:
# C = Completed/Signed
# P = Pending
# S = Seeking partner
# T = Terminated
# X = Expired

completed = df[df[‘JV Status’] == ‘Completed/Signed’]
pending = df[df[‘JV Status’] == ‘Pending’]
```

## Data Characteristics

- **Multiple rows per company**: Each alliance gets its own row
- **Participant-centric**: Company may appear multiple times in same alliance
- **Historical depth**: Data goes back to 1980s
- **Global coverage**: Worldwide joint ventures and alliances
- **Alliance lifecycle**: Tracks from seeking through termination/expiration

## Status Code Reference

| Code | Status | Description |
|------|--------|-------------|
| S | Seeking | Partner seeking other partners |
| P | Pending | Partners plan/agree to form alliance |
| C | Completed/Signed | Alliance officially completed |
| T | Terminated | Alliance terminated before expiration |
| X | Expired | Alliance expired per original terms |
| R | Renegotiated | Alliance terms renegotiated |

## Alliance Type Reference

| Flag Field | Description |
|------------|-------------|
| `IsAJointVenture` | Creates independent business entity |
| `IsAStrategicAlliance` | No independent entity, allocates responsibilities |
| `IsALicensingAgreement` | Grants license to use IP/technology |
| `IsAResearchAndDevtAgreement` | Joint R&D activities |
| `IsAManufacturingAgreement` | Joint manufacturing |
| `IsAMarketingAgreement` | Joint marketing/distribution |
| `IsASupplyAgreement` | Supply chain agreement |
| `IsAnOEM` | OEM/VAR agreement |
| `IsAFundingAgreement` | Non-equity funding arrangement |

## Limitations

1. **Must query by ticker**: Need a list of companies first
2. **Multiple rows per alliance**: Same alliance appears for each participant
3. **Rate limits**: Batch queries to avoid API limits
4. **Text fields**: Synopsis fields may be lengthy

## Related SDC Datasets

- **M&A**: `TR.MnA*` fields - see `mna.md`
- **Private Equity**: `TR.PEInvest*` fields - see `private-equity.md`
- **Syndicated Loans**: `TR.LN*` fields - see `syndicated-loans.md`
