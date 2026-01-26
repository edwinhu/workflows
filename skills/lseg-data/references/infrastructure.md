# Infrastructure / Project Finance Data (SDC Platinum)

Access infrastructure and project finance deal data via the LSEG Data Library using `TR.PJF*` fields.

## Overview

Infrastructure/Project Finance data comes from SDC Platinum. Queries return **multiple rows per company** (one per project where the company is a sponsor, developer, or participant).

## Quick Start

```python
import lseg.data as ld

ld.open_session()

df = ld.get_data(
    universe=[‘NEE.N’, ‘SO.N’, ‘DUK.N’, ‘D.N’],  # Utility companies
    fields=[
        ‘TR.PJFAnnouncementDate’,
        ‘TR.PJFProjectName’,
        ‘TR.PJFProjectNation’,
        ‘TR.PJFProjectStatus’,
        ‘TR.PJFTotalProjectCost’,
        ‘TR.PJFFinancingAmt’,
        ‘TR.PJFIndSector’,
    ]
)
# Returns multiple rows per company (one per infrastructure project)

ld.close_session()
```

## Available Fields

### Project Identification

| Field | Description |
|-------|-------------|
| `TR.PJFDealId` | SDC deal identifier |
| `TR.PJFSdcDealNumber` | SDC deal number |
| `TR.PJFAnnouncementDate` | Project announcement date |

### Project Details

| Field | Description |
|-------|-------------|
| `TR.PJFProjectName` | Project name |
| `TR.PJFProjectNation` | Project country |
| `TR.PJFProjectLocation` | Project location |
| `TR.PJFProjectStatus` | Status (Operational, Under Construction, etc.) |
| `TR.PJFProjectType` | Project type |
| `TR.PJFProjectSynopsis` | Project description |
| `TR.PJFIsProjectMultinational` | Multinational flag |

### Industry Classification

| Field | Description |
|-------|-------------|
| `TR.PJFIndSector` | Industry sector (Power, Oil And Gas, etc.) |
| `TR.PJFIndSubSector` | Industry sub-sector (Gas Pipeline, Solar, etc.) |

### Financials

| Field | Description |
|-------|-------------|
| `TR.PJFTotalProjectCost` | Total project cost |
| `TR.PJFFinancingAmt` | Financing amount |
| `TR.PJFFinancingCategory` | Financing category |
| `TR.PJFFinancingSubCategory` | Financing sub-category |
| `TR.PJFFinancingStatus` | Financing status |
| `TR.PJFFinancedDate` | Date financing closed |

### Sponsors

| Field | Description |
|-------|-------------|
| `TR.PJFSponsorShortName` | Sponsor/developer name |
| `TR.PJFSponsorCurrSharePct` | Sponsor ownership percentage |
| `TR.PJFSponsorPubStatus` | Sponsor public/private status |
| `TR.PJFSponsorFinancialAdvisor` | Sponsor’s financial advisor |
| `TR.PJFSponsorLegalAdvisor` | Sponsor’s legal advisor |

### Advisors

| Field | Description |
|-------|-------------|
| `TR.PJFFinancialAdvisor` | Project financial advisor |
| `TR.PJFFinancialAdvisorRole` | Advisor role |
| `TR.PJFLegalAdvisorCode` | Legal advisor |
| `TR.PJFLegalAdvisorRole` | Legal advisor role |

### Offtake Contracts

| Field | Description |
|-------|-------------|
| `TR.PJFOfftakerShortName` | Offtaker name |
| `TR.PJFOfftakerPubStatus` | Offtaker public/private status |
| `TR.PJFOfftakeContractType` | Contract type (PPA, etc.) |
| `TR.PJFOfftakeContractSigningDate` | Contract signing date |
| `TR.PJFOfftakeDuration` | Contract duration |
| `TR.PJFOfftakeOutputTaken` | Output percentage taken |
| `TR.PJFIsOfftakeContractExtendible` | Extendible flag |

### Construction & Operations

| Field | Description |
|-------|-------------|
| `TR.PJFConstStartDate` | Construction start date |
| `TR.PJFConstEndDate` | Construction end date |
| `TR.PJFConstructionSupplyShortName` | EPC contractor name |
| `TR.PJFConstructionSupplyContractType` | EPC contract type |
| `TR.PJFConstructionSupplyContractValue` | EPC contract value |
| `TR.PJFOpsAndMainContractorShortName` | O&M contractor name |
| `TR.PJFOpsAndMainContractType` | O&M contract type |
| `TR.PJFOpsAndMainContractValue` | O&M contract value |

### Government Support

| Field | Description |
|-------|-------------|
| `TR.PJFGovtLevelOfSupport` | Government support level |
| `TR.PJFGovtSupportType` | Type of government support |
| `TR.PJFIsPvtFinanceInitiative` | Private Finance Initiative flag |
| `TR.PJFIsPrivatization` | Privatization flag |

### Related Financing

| Field | Description |
|-------|-------------|
| `TR.PJFRelLNAnnouncementDate` | Related loan announcement date |
| `TR.PJFRelLNTotalFacilityAmount` | Related loan facility amount |
| `TR.PJFRelLNTrancheAmount` | Related loan tranche amount |
| `TR.PJFRelLNLeadManager` | Lead arranger |
| `TR.PJFRelDebtNIIssueDate` | Related bond issue date |
| `TR.PJFRelDebtNIPrincipalAmtThisMkt` | Related bond principal amount |
| `TR.PJFRelDebtNIRatingsMoodysDebt` | Moody’s bond rating |
| `TR.PJFRelDebtNIRatingsSPDebt` | S&P bond rating |
| `TR.PJFRelEquityNIIssueDate` | Related equity issue date |
| `TR.PJFRelEquityNIPrincipalAmtThisMkt` | Related equity amount |

### Project Risk

| Field | Description |
|-------|-------------|
| `TR.PJFHasProjectDefaulted` | Default flag |
| `TR.PJFIsProjectUnderLitigation` | Litigation flag |
| `TR.PJFIsProjectRefinanced` | Refinanced flag |
| `TR.PJFIsActProjectFinanced` | Project finance flag |

## Common Industry Sectors

| Sector | Sub-sectors |
|--------|-------------|
| Power | Gas, Coal, Nuclear, Solar, Wind, Hydro, Biomass |
| Oil And Gas | Gas Pipeline, Oil Pipeline, LNG, Refinery |
| Transportation | Road, Rail, Airport, Port, Bridge |
| Water | Water Treatment, Desalination |
| Social Infrastructure | Hospital, School, Prison |
| Telecommunications | Fiber, Satellite |

## Example Output

| Instrument | Project Name | Nation | Status | Cost | Sector |
|------------|--------------|--------|--------|------|--------|
| NEE.N | Mamonal Power Project | Colombia | Operational | $44.2B | Power |
| NEE.N | Florida Gas Phase III | United States | Operational | $900M | Oil And Gas |
| SO.N | Vogtle Nuclear Units 3&4 | United States | Under Construction | $25B | Power |
| DUK.N | Piedmont Natural Gas | United States | Operational | $4.9B | Oil And Gas |

## Practical Workflow

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Get utility and energy companies
energy_companies = ld.get_data(
    universe=’SCREEN(U(IN(Equity(active,public,primary))),IN(TR.TRBCEconSectorCode,”50”),IN(TR.HQCountryCode,”US”),CURN=USD)’,
    fields=[‘TR.CommonName’]
)
rics = energy_companies[‘Instrument’].tolist()

# Query infrastructure projects in batches
batch_size = 50
all_projects = []

for i in range(0, len(rics), batch_size):
    batch = rics[i:i+batch_size]
    df = ld.get_data(
        universe=batch,
        fields=[
            ‘TR.PJFAnnouncementDate’,
            ‘TR.PJFProjectName’,
            ‘TR.PJFProjectStatus’,
            ‘TR.PJFTotalProjectCost’,
            ‘TR.PJFIndSector’,
        ]
    )
    df = df.dropna(subset=[‘Project Name’])
    all_projects.append(df)

projects_df = pd.concat(all_projects, ignore_index=True)

ld.close_session()
```

## Data Characteristics

- **Multiple rows per company**: Each project gets its own row
- **Sponsor relationships**: Companies appear as sponsors, developers, offtakers, or contractors
- **Global coverage**: Projects from around the world
- **Historical depth**: Data going back to 1990s
- **Cross-references**: Links to related loans, bonds, and equity issuances

## Limitations

1. **Must query by ticker**: Need a list of target companies first
2. **No direct SCREEN**: `SCREEN(U(IN(DEALS)))` only works in Workspace
3. **Rate limits**: Batch queries to avoid API limits
4. **Large result sets**: Utility companies can have hundreds of projects

## Related SDC Datasets

- **Syndicated Loans**: `TR.LN*` fields - see `syndicated-loans.md`
- **Corporate Governance**: `TR.SACT*`, `TR.PP*` - see `corporate-governance.md`
