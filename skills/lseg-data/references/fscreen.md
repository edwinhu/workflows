# FSCREEN - Fund Screening

## Contents

- [Overview](#overview)
- [Accessing FSCREEN](#accessing-fscreen)
- [Available Field Categories](#available-field-categories)
- [Fees and Expenses](#fees-and-expenses)
- [Performance and Returns](#performance-and-returns)
- [Company and Manager Info](#company-and-manager-info)
- [Holdings](#holdings)
- [Fund Classification](#fund-classification)
- [Fund Identifiers](#fund-identifiers)
- [Sample Templates](#sample-templates)

## Overview

FSCREEN (Fund Screening) is Refinitiv Workspace’s tool for screening mutual funds, ETFs, and other fund vehicles. It provides access to 7,400+ US ETFs/funds with extensive field coverage for fees, performance, holdings, and company information.

**URL:** `https://workspace.refinitiv.com/web/Apps/FundReporting/`

## Accessing FSCREEN

1. Navigate to Refinitiv Workspace
2. Use the app launcher or search for “FSCREEN”
3. Default view shows US ETFs (Asset Universe = Exchange Traded Funds, Domicile = USA)

### Adding Columns

- Click the “Add Column” field in the header
- Type to search for fields (e.g., “expense”, “return”, “holding”)
- Click a field to add it to the view

### Using Templates

The “Company Information” dropdown provides pre-built templates:
- Company Information
- Cumulative Month End Performances
- Fund Charges
- Islamic Funds
- Quantitative Analysis - 3 Yr
- Static Fund Information

## Available Field Categories

### Fees and Expenses

#### Expense Ratios (%)

| Field | Description |
|-------|-------------|
| Total Expense (Calculated %) | Overall calculated expense ratio |
| Total Net Expenses (%) | Net expense ratio after waivers |
| Prospectus Gross Expense Ratio | Gross expense ratio from prospectus |
| Prospectus Net Acquired Fund Expense Ratio | Net acquired fund expenses |
| Published Expenses (%) | Published expense ratio |

#### Expense Breakdowns (%)

| Field | Description |
|-------|-------------|
| 12b-1 Expense (%) | Distribution/marketing fees |
| Non-12B-1 Expense (%) | Non-distribution expenses |
| Management Expense (%) | Investment management fees |
| Non-Management Expense (%) | Non-management related expenses |
| Administrator Expenses (%) | Fund administration costs |
| Advisor Expenses (%) | Investment advisor fees |
| Sub-Advisor Expenses (%) | Sub-advisor fees |
| Sub-Administrator Expenses (%) | Sub-administration costs |
| Custodian Expenses (%) | Custody fees |
| Custodian and Transfer Agent Expenses (%) | Combined custody/transfer |
| Transfer Agent Expenses (%) | Transfer agent fees |
| Distribution Expense (%) | Distribution costs |
| Audit Expenses (%) | Audit fees |
| Audit and Legal Expenses (%) | Combined audit/legal |
| Legal Expenses (%) | Legal fees |
| Tax Expenses (%) | Tax-related expenses |
| Foreign Tax Expenses (%) | Foreign tax costs |
| Investment Expenses (%) | Investment-related expenses |
| Accounting Service Expenses (%) | Accounting costs |
| Postage and Printing Expenses (%) | Administrative costs |
| Misc. Expenses (%) | Miscellaneous expenses |
| Fund of Fund Direct Expenses (%) | Direct FoF expenses |
| Fund of Fund Indirect Expenses (%) | Indirect FoF expenses |

#### Expense Values (Currency)

All percentage fields above also have currency value equivalents:
- `[Field Name] (currency value)` - e.g., “12b-1 Expense (Currency Value)”

### Performance and Returns

#### Total Returns

| Field | Description |
|-------|-------------|
| Total Return | Current total return |
| Total Return 3 years | 3-year total return |
| Total Return 5 years | 5-year total return |
| Total Return 10 years | 10-year total return |
| Total Return Overall | Since inception return |

#### Consistent Returns

| Field | Description |
|-------|-------------|
| Consistent Return 3 years | 3-year consistency measure |
| Consistent Return 5 years | 5-year consistency measure |
| Consistent Return 10 years | 10-year consistency measure |
| Consistent Return Overall | Overall consistency measure |

#### Risk-Adjusted Returns

| Field | Description |
|-------|-------------|
| Return/Risk Ratio for 1 Year to Last Month End | 1-year risk-adjusted return |
| Return/Risk Ratio for 3 Years to Last Month End | 3-year risk-adjusted return |
| Return/Risk Ratio for 5 Years to Last Month End | 5-year risk-adjusted return |
| Return/Risk Ratio for 10 Years to Last Month End | 10-year risk-adjusted return |

#### Absolute Return Classification

| Field | Description |
|-------|-------------|
| Absolute Return-High | High absolute return category |
| Absolute Return-Med | Medium absolute return category |
| Absolute Return-Low | Low absolute return category |

#### Return Profile

| Field | Description |
|-------|-------------|
| Return Profile Client looking for Capital Growth | Growth-oriented profile |
| Return Profile Client looking for Income | Income-oriented profile |
| Return Profile Client looking for Preservation | Capital preservation profile |
| Return Profile Hedging | Hedging profile |
| Return Profile Other EMT v1 | Other EMT classification |
| Return Profile Pension Scheme Germany | German pension scheme profile |
| Option or Leveraged Return Profile | Options/leverage indicator |

#### Risk Ratings

| Field | Description |
|-------|-------------|
| TW Risk Return Rating | Thomson/Refinitiv risk rating |

### Company and Manager Info

#### Fund Manager

| Field | Description |
|-------|-------------|
| Fund Manager Name | Name of fund manager |
| Fund Manager Start Date | Manager tenure start |
| Fund Manager Benchmark | Manager’s benchmark |
| Fund Manager Benchmark Code | Benchmark identifier |
| Manager of Manager Funds | MoM fund indicator |

#### Administrator

| Field | Description |
|-------|-------------|
| Administrator Name | Fund administrator |
| Administrator Email Address | Admin contact email |
| Administrator Number | Admin contact number |

#### Fund Identification

| Field | Description |
|-------|-------------|
| Asset Name | Fund name |
| Lipper RIC | Lipper identifier |
| Fund TNA (Mil) | Total net assets in millions |

### Holdings

| Field | Description |
|-------|-------------|
| Top Holdings | List of top holdings |
| Global Holdings Based Classification | Holdings-based classification |
| Minimum Recommending Holding Period | Recommended minimum hold |
| Fund Size held by Primary | Size held by primary share class |

### Fund Classification

#### Fund Types

| Field | Description |
|-------|-------------|
| Exchange Traded Fund (ETF) | ETF indicator |
| Closed End Fund | Closed-end fund indicator |
| Infrastructure Fund | Infrastructure fund type |
| Institutional Fund | Institutional share class |
| Insurance Funds | Insurance-linked fund |
| Linked Fund | Linked fund indicator |
| Private Fund | Private fund indicator |
| Provident Fund | Provident fund type |
| THAI - Long Term Equity Fund | Thai LTF classification |
| Hong Kong Pension Funds | HK pension fund type |
| Gilt-Edged Fund | UK gilt fund |
| Double Decker Fund | Double decker structure |
| Austrian Fund Type | Austrian fund classification |

#### Mutual Fund Classification

| Field | Description |
|-------|-------------|
| US Mutual Fund Classification | US MF classification |
| US Mutual Fund Objective | Investment objective |
| Tadawul Fund Category | Saudi fund category |
| Lipper Hedge Fund Status | Hedge fund status |

### Fund Identifiers

| Field | Description |
|-------|-------------|
| Lipper RIC | Lipper Reuters Instrument Code |
| MFund ID | MFund identifier |
| MFund Family ID | MFund family identifier |
| US Fund No | US fund number |
| Israel Fund ID | Israeli fund identifier |
| Canada FunData Key | Canadian fund key |
| FundServBE | FundServ Belgium |
| FundServDM | FundServ Denmark |
| FundServDO | FundServ Dominican Republic |
| FundServFE | FundServ Finland |
| FundServGEN | FundServ General |
| FundServIS | FundServ Iceland |
| FundServLL | FundServ Luxembourg |
| FundServNL | FundServ Netherlands |
| FundServVS | FundServ Various |

### Fund Events

| Field | Description |
|-------|-------------|
| Fund changes name from | Previous fund name |
| Fund Domicile changes from | Previous domicile |
| Fund is transferred from... | Transfer source |
| Fund merges with...(old fund) | Merger predecessor |
| Fund Mgr Benchmark is... | Benchmark change |
| Fund Objective changed | Objective change date |
| Fund relaunched, original date | Relaunch information |

## Sample Templates

### Company Information Template

Typical columns:
- Lipper RIC
- Asset Name
- Administrator Name
- Administrator Email Address
- Administrator Number

### Fund Charges Template

Typical columns:
- Total Expense (Calculated %)
- 12b-1 Expense (%)
- Management Expense (%)
- Prospectus Gross Expense Ratio

### Cumulative Month End Performances Template

Typical columns:
- Total Return 3 years
- Total Return 5 years
- Total Return 10 years
- Consistent Return metrics

### Quantitative Analysis - 3 Yr Template

Typical columns:
- Return/Risk Ratio fields
- Consistent Return 3 years
- Risk ratings

## API Field Codes

Internal field codes for the L3 API (`/Apps/FundReporting/{version}/l3`). These codes are used in the `dataPoints` array of POST requests.

### Identifiers

| Display Name | API Code |
|--------------|----------|
| Lipper ID | `LIPPERID` |
| Asset Name | `NAME` |

### Company Information

| Entity | Name | Email | Phone | Website |
|--------|------|-------|-------|---------|
| Administrator | `ADMINISTRATOR_NAME` | `ADMINISTRATOR_EMAIL` | `ADMINISTRATOR_PHONENUMBER` | `ADMINISTRATOR_WEBSITE` |
| Custodian | `CUSTODIAN_NAME` | `CUSTODIAN_EMAIL` | `CUSTODIAN_PHONENUMBER` | `CUSTODIAN_WEBSITE` |
| Fund Mgmt Company | `FUNDMGMTCMPY_NAME` | `FUNDMGMTCMPY_EMAIL` | `FUNDMGMTCMPY_PHONENUMBER` | `FUNDMGMTCMPY_WEBSITE` |
| Investment Advisor | `INVSTADV_NAME` | `INVSTADV_EMAIL` | `INVSTADV_PHONENUMBER` | `INVSTADV_WEBSITE` |
| Promoter | `PROMOTER_NAME` | `PROMOTER_EMAIL` | `PROMOTER_PHONENUMBER` | `PROMOTER_WEBSITE` |
| Sub-Administrator | `SUBADMIN_NAME` | `SUBADMIN_EMAIL` | `SUBADMIN_PHONENUMBER` | `SUBADMIN_WEBSITE` |
| Transfer Agent | `TRANAGNT_NAME` | - | - | - |

### Fund Charges

| Display Name | API Code |
|--------------|----------|
| Actual Annual Charge | `ANNUAL_CHARGE_ACTUAL` |
| Maximum Annual Charge | `ANNUAL_CHARGE_MAX` |
| Minimum Annual Charge | `ANNUAL_CHARGE_MIN` |
| Actual Initial Charge | `INITIAL_CHARGE_ACTUAL` |
| Maximum Initial Charge | `INITIAL_CHARGE_MAX` |
| Minimum Initial Charge | `INITIAL_CHARGE_MIN` |
| Actual Redemption Charge | `REDEMPTION_CHARGE_ACTUAL` |
| Maximum Redemption Charge | `REDEMPTION_CHARGE_MAX` |
| Minimum Redemption Charge | `REDEMPTION_CHARGE_MIN` |

**Pattern:** `{TYPE}_CHARGE_{VARIANT}` where TYPE = `ANNUAL`, `INITIAL`, `REDEMPTION` and VARIANT = `ACTUAL`, `MAX`, `MIN`

### Expenses

| Display Name | API Code |
|--------------|----------|
| Total Expense (Calculated %) | `Total Exp (Calc) %` |
| Sub-Advisor Expenses (%) | `EXP_ADV_SUB` |

**Note:** Expense codes use inconsistent naming - some SNAKE_CASE, others display-style strings.

### Performance (Month End)

| Display Name | API Code |
|--------------|----------|
| Year-to-Month End Performance | `PERF_YTMEJ[currency=USD]` |
| 1 Month Performance | `PERF_1MMEJ[currency=USD]` |
| 3 Month Performance | `PERF_3MMEJ[currency=USD]` |
| 6 Month Performance | `PERF_6MMEJ[currency=USD]` |
| 1 Year Performance | `PERF_1YMEJ[currency=USD]` |
| 3 Year Performance | `PERF_3YMEJ[currency=USD]` |
| 5 Year Performance | `PERF_5YMEJ[currency=USD]` |
| Inception Performance | `PERF_IMEJ[currency=USD]` |

**Pattern:** `PERF_{period}MEJ[currency=USD]` where period = `YT`, `1M/3M/6M`, `1Y/3Y/5Y`, or `I`

### Returns

| Display Name | API Code |
|--------------|----------|
| Total Return 3 years | `LL3YTR[universe=35381]` |

**Pattern:** `LL{N}YTR[universe=35381]` where N = years

### Holdings & Fund Info

| Display Name | API Code |
|--------------|----------|
| Top Holdings | `CTOPHOLDCAL` |
| Fund TNA (Mil) | `FUNDTNA[currency=USD]` |

## Tips

1. **Search is your friend**: Use the “Add Column” search to discover fields
2. **Templates for quick setup**: Start with a sample template, then customize
3. **Export data**: Use “Generate Report” to export screening results
4. **Save custom views**: Create personal templates for frequently-used column sets
