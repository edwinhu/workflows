# Corporate Governance Data (SDC Platinum)

Access shareholder activism campaigns and poison pills data via the LSEG Data Library.

## Overview

Corporate governance data comes from SDC Platinum (now integrated into LSEG). Unlike fundamentals which return one row per company, corporate governance queries return **multiple rows per company** (one per campaign or pill).

## Shareholder Activism (TR.SACT*)

Query activist campaigns, proxy fights, and dissident information.

### Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘XOM’, ‘AAPL.O’, ‘DIS’],
    fields=[
        ‘TR.SACTAnnouncementDate’,
        ‘TR.SACTTargetName’,
        ‘TR.SACTLeadDissident’,
        ‘TR.SACTCampaignEndDate’,
        ‘TR.SACTDescOfProxyFight’,
        ‘TR.SACTDescFightOutcome’,
    ]
)
# Returns multiple rows per company (one per activism campaign)

ld.close_session()
```

### Available Fields

| Field | Description |
|-------|-------------|
| **Deal Details** | |
| `TR.SACTAnnouncementDate` | Campaign announcement date |
| `TR.SACTCampaignEndDate` | Campaign end date |
| `TR.SACTCampaignSettledDate` | Campaign settlement date |
| `TR.SACTDescOfProxyFight` | Description of the proxy fight/campaign |
| `TR.SACTDescFightOutcome` | Description of campaign outcome |
| `TR.SACTProxyFightSettled` | Whether proxy fight was settled |
| `TR.SACTRelatedMnADealNum` | Related M&A deal number |
| `TR.SACTSourceType` | Data source type |
| `TR.SACTDealId` | SDC deal identifier |
| `TR.SACTSdcDealNumber` | SDC deal number |
| **Target Company** | |
| `TR.SACTTargetName` | Target company name |
| `TR.SACTTargetTicker` | Target ticker symbol |
| `TR.SACTTargetCusip` | Target CUSIP |
| `TR.SACTTargetSIC` | Target SIC code |
| `TR.SACTTargetNation` | Target country |
| `TR.SACTTargetEntityId` | Target entity ID |
| **Target Advisors** | |
| `TR.SACTTargetFinAdvisor` | Target financial advisor |
| `TR.SACTTargetLegalCounsel` | Target legal counsel |
| `TR.SACTTargetProxySolicitor` | Target proxy solicitor |
| **Dissident Information** | |
| `TR.SACTLeadDissident` | Lead dissident/activist name |
| `TR.SACTDissidentGroup` | Dissident group name |
| `TR.SACTDissidentGroupOrgType` | Dissident organization type |
| `TR.SACTDissidentCusip` | Dissident CUSIP |
| **Dissident Advisors** | |
| `TR.SACTDissidentFinAdvisor` | Dissident financial advisor |
| `TR.SACTDissidentLegalCounsel` | Dissident legal counsel |
| `TR.SACTDissidentProxySolicitor` | Dissident proxy solicitor |

### Example Output

| Instrument | Campaign Announcement Date | Dissident Group | Campaign End Date |
|------------|---------------------------|-----------------|-------------------|
| XOM | 2020-07-12 | Engine No 1 LP | NaT |
| XOM | 2019-05-09 | Arjuna Capital | 2020-03-01 |
| AAPL.O | 2013-02-07 | Greenlight Capital LLC | 2013-05-07 |
| AAPL.O | 2013-08-13 | Icahn Partners LP | NaT |
| DIS | 2022-08-19 | Third Point LLC | 2023-01-11 |

## Poison Pills (TR.PP*)

Query shareholder rights plans (poison pills) adopted by companies.

### Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘AAPL.O’, ‘DIS’, ‘XOM’],
    fields=[
        ‘TR.PPIssuerName’,
        ‘TR.PPPillAdoptionDate’,
        ‘TR.PPPillStatus’,
        ‘TR.PPPillType’,
        ‘TR.PPExpirationDate’,
        ‘TR.PPTriggerPercent’,
    ]
)

ld.close_session()
```

### Available Fields

| Field | Description |
|-------|-------------|
| **Issuer Information** | |
| `TR.PPIssuerName` | Issuer company name |
| `TR.PPIssuerTicker` | Issuer ticker |
| `TR.PPIssuerCusip` | Issuer CUSIP |
| `TR.PPIssuerSIC` | Issuer SIC code |
| `TR.PPIssuerNation` | Issuer country |
| **Pill Details** | |
| `TR.PPPillAdoptionDate` | Date pill was adopted |
| `TR.PPPillStatus` | Current status (In force, Expired, Redeemed) |
| `TR.PPPillType` | Pill type (Flip-in, Flip-over, etc.) |
| `TR.PPExpirationDate` | Pill expiration date |
| `TR.PPTriggerPercent` | Ownership trigger percentage |
| `TR.PPFlipInTrigger` | Flip-in trigger details |
| `TR.PPFlipOverTrigger` | Flip-over trigger details |
| **Identifiers** | |
| `TR.PPDealId` | SDC deal identifier |
| `TR.PPSdcDealNumber` | SDC deal number |

### Example Output

| Instrument | Issuer Short Name | Pill Adoption Date | Pill Status | Pill Type | Expiration Date |
|------------|-------------------|-------------------|-------------|-----------|-----------------|
| AAPL.O | Apple Computer Inc | 1989-04-19 | Expired | Flip-in/Flip-over | 1999-04-19 |
| AAPL.O | Apple Inc | 2025-11-05 | In force | Flip-in/Flip-over | 2025-11-05 |
| DIS | Walt Disney Co | 1989-06-21 | Redeemed | Flip-in/Flip-over | 1999-06-30 |

## Limitations

1. **No broad universe screening**: You cannot query “all US companies with activism” via the Python API. The `SCREEN(U(IN(DEALS)))` syntax only works in the internal Workspace application, not via `ld.get_data()`.

2. **Must query by ticker**: You need a list of target tickers/RICs first, then query their corporate governance data.

3. **Multiple rows per company**: Unlike fundamentals, these queries return one row per campaign/pill, not one row per company.

## Practical Workflow: SCREEN to Corporate Governance

You can use SCREEN or index constituents to get a universe of RICs, then pass those to corporate governance queries.

### Method 1: Index Constituents

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get S&P 500 constituents (503 companies)
sp500 = ld.get_data(
    universe=‘0#.SPX’,
    fields=[‘TR.CommonName’]
)
tickers = sp500[‘Instrument’].tolist()

# Query activism data for those tickers (batch to avoid rate limits)
batch_size = 100
all_activism = []

for i in range(0, len(tickers), batch_size):
    batch = tickers[i:i+batch_size]
    df = ld.get_data(
        universe=batch,
        fields=[‘TR.SACTAnnouncementDate’, ‘TR.SACTLeadDissident’]
    )
    all_activism.append(df)

activism_df = pd.concat(all_activism, ignore_index=True)
# Filter to rows with actual data
activism_df = activism_df.dropna(subset=[‘Campaign Announcement Date’])

ld.close_session()
```

### Method 2: SCREEN for Custom Universe

```python
import lseg.data as ld

ld.open_session()

# Screen for US large caps (market cap > $100B)
screen_result = ld.get_data(
    universe=’SCREEN(U(IN(Equity(active,public,primary))),IN(TR.HQCountryCode,”US”),TR.CompanyMarketCapitalization>100000000000,CURN=USD)’,
    fields=[‘TR.CommonName’, ‘TR.CompanyMarketCapitalization’]
)
# Returns ~108 companies

# Extract RICs
rics = screen_result[‘Instrument’].tolist()

# Query activism for those RICs
activism_df = ld.get_data(
    universe=rics,
    fields=[‘TR.SACTAnnouncementDate’, ‘TR.SACTLeadDissident’, ‘TR.SACTDescOfProxyFight’]
)

ld.close_session()
```

### Common Index Chains

| Index | Chain RIC | Approx. Count |
|-------|-----------|---------------|
| S&P 500 | `0#.SPX` | 503 |
| Russell 1000 | `0#.RUI` | 1009 |
| Russell 2000 | `0#.RUT` | 2000 |
| NASDAQ 100 | `0#.NDX` | 100 |
| Dow Jones | `0#.DJI` | 30 |

## Field Name Aliases

Many fields have multiple valid names:

| Canonical | Aliases |
|-----------|---------|
| `TR.SACTAnnouncementDate` | `TR.SACTAnnDate` |
| `TR.SACTTargetName` | `TR.SACTTarget`, `TR.SACTTarShortName` |
| `TR.SACTCampaignEndDate` | `TR.SACTEndDate` |
| `TR.SACTCampaignSettledDate` | `TR.SACTSettledDate` |
| `TR.PPPillAdoptionDate` | `TR.PPAdoptionDate` |
| `TR.PPPillStatus` | `TR.PPStatus` |
