# ESG Module

Environmental, Social, and Governance scores and metrics from LSEG's ESG database.

## Contents

- [Overview](#overview)
- [Key Fields](#key-fields)
- [Parameters](#parameters)
- [Code Examples](#code-examples)
- [Notes and Gotchas](#notes-and-gotchas)
- [See Also](#see-also)

## Overview

LSEG ESG scores provide comprehensive sustainability data covering 12,500+ companies globally. Scores are calculated from 630+ data points across 10 categories, updated weekly.

### Coverage
- **Companies**: 12,500+ globally
- **History**: From 2002 (varies by company)
- **Update frequency**: Weekly
- **Methodology**: 630+ metrics across 10 categories

### Score Structure

```
ESG Score (0-100)
├── Environmental Pillar (0-100)
│   ├── Resource Use
│   ├── Emissions
│   └── Innovation
├── Social Pillar (0-100)
│   ├── Workforce
│   ├── Human Rights
│   ├── Community
│   └── Product Responsibility
└── Governance Pillar (0-100)
    ├── Management
    ├── Shareholders
    └── CSR Strategy
```

## Key Fields

### Overall Scores

| Field | Description | Range |
|-------|-------------|-------|
| `TR.TRESGScore` | Overall ESG score | 0-100 |
| `TR.TRESGCombinedScore` | ESG + Controversies combined | 0-100 |
| `TR.TRESGCControversiesScore` | Controversies score | 0-100 |

### Pillar Scores

| Field | Description | Range |
|-------|-------------|-------|
| `TR.EnvironmentPillarScore` | Environmental pillar score | 0-100 |
| `TR.SocialPillarScore` | Social pillar score | 0-100 |
| `TR.GovernancePillarScore` | Governance pillar score | 0-100 |

### Category Scores (Environmental)

| Field | Description | Range |
|-------|-------------|-------|
| `TR.ResourceUseScore` | Resource efficiency | 0-100 |
| `TR.EmissionsScore` | Emissions management | 0-100 |
| `TR.EnvironmentalInnovationScore` | Green innovation | 0-100 |

### Category Scores (Social)

| Field | Description | Range |
|-------|-------------|-------|
| `TR.WorkforceScore` | Workforce management | 0-100 |
| `TR.HumanRightsScore` | Human rights practices | 0-100 |
| `TR.CommunityScore` | Community relations | 0-100 |
| `TR.ProductResponsibilityScore` | Product quality/safety | 0-100 |

### Category Scores (Governance)

| Field | Description | Range |
|-------|-------------|-------|
| `TR.ManagementScore` | Management quality | 0-100 |
| `TR.ShareholdersScore` | Shareholder rights | 0-100 |
| `TR.CSRStrategyScore` | CSR strategy score | 0-100 |

### Controversies

| Field | Description | Range |
|-------|-------------|-------|
| `TR.TRESGCControversiesScore` | Overall controversies score | 0-100 |
| `TR.ControversiesCount` | Number of controversies | Count |
| `TR.RecentControversies` | Recent controversy flag | Boolean |

### Carbon & Climate

| Field | Description | Units |
|-------|-------------|-------|
| `TR.CO2DirectScope1` | Scope 1 emissions | Tonnes CO2 |
| `TR.CO2IndirectScope2` | Scope 2 emissions | Tonnes CO2 |
| `TR.CO2IndirectScope3` | Scope 3 emissions | Tonnes CO2 |
| `TR.TotalCO2Equiv` | Total CO2 equivalent | Tonnes CO2 |
| `TR.CO2IntensityRevenue` | CO2 per revenue | Tonnes/USD M |
| `TR.CarbonReductionTarget` | Has reduction target | Boolean |

### Governance Metrics

| Field | Description | Units |
|-------|-------------|-------|
| `TR.BoardSize` | Board size | Count |
| `TR.IndependentBoardMembers` | Independent directors | Count |
| `TR.WomenOnBoard` | Women on board | Percent |
| `TR.CEOBoardMember` | CEO on board | Boolean |
| `TR.BoardMeetingAttendanceAvg` | Board meeting attendance | Percent |

## Parameters

| Parameter | Description | Values |
|-----------|-------------|--------|
| `SDate` | Start date | Date or `FY-N` |
| `EDate` | End date | Date or `FY0` |
| `Period` | Period type | `FY` (annual) |

## Code Examples

### Basic ESG Snapshot

```python
import lseg.data as ld

ld.open_session()

# Current ESG scores for major companies
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O', 'XOM', 'CVX'],
    fields=[
        'TR.CompanyName',
        'TR.TRESGScore',
        'TR.EnvironmentPillarScore',
        'TR.SocialPillarScore',
        'TR.GovernancePillarScore'
    ]
)

ld.close_session()
print(df)
```

### ESG Score History

```python
import lseg.data as ld

ld.open_session()

# 5-year ESG score history
df = ld.get_data(
    universe='AAPL.O',
    fields=[
        'TR.TRESGScore',
        'TR.TRESGScore.date',
        'TR.EnvironmentPillarScore',
        'TR.SocialPillarScore',
        'TR.GovernancePillarScore'
    ],
    parameters={
        'SDate': 'FY-4',
        'EDate': 'FY0',
        'Period': 'FY'
    }
)

ld.close_session()
print(df)
```

### Detailed Category Breakdown

```python
import lseg.data as ld

ld.open_session()

# Full category breakdown
df = ld.get_data(
    universe=['AAPL.O', 'XOM'],
    fields=[
        'TR.CompanyName',
        # Environmental categories
        'TR.ResourceUseScore',
        'TR.EmissionsScore',
        'TR.EnvironmentalInnovationScore',
        # Social categories
        'TR.WorkforceScore',
        'TR.HumanRightsScore',
        'TR.CommunityScore',
        'TR.ProductResponsibilityScore',
        # Governance categories
        'TR.ManagementScore',
        'TR.ShareholdersScore',
        'TR.CSRStrategyScore'
    ]
)

ld.close_session()
print(df)
```

### Carbon Emissions Data

```python
import lseg.data as ld

ld.open_session()

# Carbon footprint data
df = ld.get_data(
    universe=['XOM', 'CVX', 'BP.L', 'SHEL.L', 'TTE.PA'],
    fields=[
        'TR.CompanyName',
        'TR.CO2DirectScope1',
        'TR.CO2IndirectScope2',
        'TR.CO2IndirectScope3',
        'TR.TotalCO2Equiv',
        'TR.CO2IntensityRevenue',
        'TR.CarbonReductionTarget'
    ]
)

ld.close_session()
print(df)
```

### Governance Metrics

```python
import lseg.data as ld

ld.open_session()

# Board composition and governance
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'GOOGL.O', 'META.O'],
    fields=[
        'TR.CompanyName',
        'TR.GovernancePillarScore',
        'TR.BoardSize',
        'TR.IndependentBoardMembers',
        'TR.WomenOnBoard',
        'TR.CEOBoardMember',
        'TR.BoardMeetingAttendanceAvg'
    ]
)

ld.close_session()
print(df)
```

### Controversies Analysis

```python
import lseg.data as ld

ld.open_session()

# Controversies screening
df = ld.get_data(
    universe=['AAPL.O', 'MSFT.O', 'META.O', 'GOOGL.O', 'AMZN.O'],
    fields=[
        'TR.CompanyName',
        'TR.TRESGScore',
        'TR.TRESGCombinedScore',  # Includes controversies
        'TR.TRESGCControversiesScore',
        'TR.ControversiesCount'
    ]
)

# Companies with controversies impact
df['Controversy_Impact'] = df['TR.TRESGScore'] - df['TR.TRESGCombinedScore']

ld.close_session()
print(df)
```

### ESG Screening for Portfolio

```python
import lseg.data as ld
import pandas as pd

ld.open_session()

# Screen S&P 500 for ESG criteria
# First get S&P 500 constituents
constituents = ld.get_data(
    universe='0#.SPX',
    fields=['TR.RIC']
)

# Then get ESG scores (chunk if needed)
df = ld.get_data(
    universe=constituents['TR.RIC'].tolist()[:100],  # First 100
    fields=[
        'TR.CompanyName',
        'TR.TRESGScore',
        'TR.EnvironmentPillarScore',
        'TR.TRESGCControversiesScore'
    ]
)

# Apply screening criteria
screened = df[
    (df['TR.TRESGScore'] >= 50) &
    (df['TR.EnvironmentPillarScore'] >= 40) &
    (df['TR.TRESGCControversiesScore'] >= 50)
]

ld.close_session()
print(f"Passed screening: {len(screened)} of {len(df)}")
```

### Compare ESG Across Sectors

```python
import lseg.data as ld

ld.open_session()

# Compare tech vs energy
tech = ['AAPL.O', 'MSFT.O', 'GOOGL.O']
energy = ['XOM', 'CVX', 'COP']

df = ld.get_data(
    universe=tech + energy,
    fields=[
        'TR.CompanyName',
        'TR.TRBCEconomicSector',  # Sector classification
        'TR.TRESGScore',
        'TR.EnvironmentPillarScore',
        'TR.SocialPillarScore',
        'TR.GovernancePillarScore'
    ]
)

# Group by sector
sector_avg = df.groupby('TR.TRBCEconomicSector').mean(numeric_only=True)

ld.close_session()
print(sector_avg)
```

## Notes and Gotchas

### 1. Score Interpretation

| Score Range | Interpretation |
|-------------|----------------|
| 75-100 | Excellent - top quartile |
| 50-75 | Good - above average |
| 25-50 | Satisfactory - average |
| 0-25 | Poor - below average |

Scores are relative to industry peers.

### 2. Controversies Impact

The `TRESGCombinedScore` reduces the ESG score based on controversies:
```python
# Combined = ESG Score adjusted for controversies
# If Combined << ESG Score, significant controversies exist
impact = df['TR.TRESGScore'] - df['TR.TRESGCombinedScore']
```

### 3. Coverage Gaps

Not all companies have ESG coverage:
```python
# Check for missing scores
df = df.dropna(subset=['TR.TRESGScore'])
print(f"Companies with ESG coverage: {len(df)}")
```

### 4. Update Timing

- ESG scores updated weekly
- Carbon data often annual (from sustainability reports)
- Controversies updated as events occur

### 5. Industry Relativity

Scores are industry-relative. An energy company with score 60 may have absolute emissions higher than a tech company with score 40. For absolute metrics, use:
```python
fields = ['TR.TotalCO2Equiv']  # Absolute emissions
```

### 6. Historical Methodology Changes

LSEG has updated ESG methodology over time. Historical comparisons should note:
- 2020: Updated category weights
- 2019: Expanded coverage
- Older scores may not be directly comparable

## See Also

- [SKILL.md](../SKILL.md) - Core API patterns
- [fundamentals.md](fundamentals.md) - Financial fundamentals
- [WRDS_COMPARISON.md](../WRDS_COMPARISON.md) - MSCI ESG comparison
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) - Common issues
