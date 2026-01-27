# Fund Details API

## Overview

The Fund Details app provides detailed information about individual funds, including derived holdings with full constituent data.

**URL:** `https://workspace.refinitiv.com/web/Apps/FundDetails/`

**API Endpoint:** `/Apps/FundDetails/{version}/loadData`

## Derived Holdings

Full holdings data with individual security positions, weights, and share counts.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=DHOL~true~&s={LipperRIC}&lang=en-US
```

**Parameters:**
- `requests=DHOL~true~` - Request derived holdings
- `s` - Lipper RIC (e.g., `LP40061149`)
- `lang` - Language code (e.g., `en-US`)

### Response Structure

```json
{
  “missingAssetIdentifiers”: null,
  “isError”: false,
  “errorMessage”: “”,
  “duration”: “00:00:01.195”,
  “results”: [{
    “availableDates”: [
      “2025-12-31T00:00:00”,
      “2025-11-30T00:00:00”,
      “2025-10-31T00:00:00”
    ],
    “date”: “2025-12-31T00:00:00”,
    “groups”: [{
      “id”: “...”,
      “name”: “Full Holdings”,
      “items”: [
        {
          “ric”: “NVDA.OQ”,
          “name”: “NVIDIA CORP ORD”,
          “domicile”: “UNITED STATES”,
          “percent”: 9.045,
          “shares”: 197497993,
          “sharesChange”: -9570500
        },
        {
          “ric”: “AAPL.OQ”,
          “name”: “APPLE INC ORD”,
          “domicile”: “UNITED STATES”,
          “percent”: 8.017,
          “shares”: 120094732,
          “sharesChange”: -6366442
        }
      ]
    }]
  }]
}
```

### Holding Fields

| Field | Type | Description |
|-------|------|-------------|
| `ric` | string | Reuters Instrument Code (e.g., `NVDA.OQ`, `AAPL.OQ`) |
| `name` | string | Security name |
| `domicile` | string | Country of domicile |
| `percent` | number | Weight in portfolio (%) |
| `shares` | number | Number of shares held |
| `sharesChange` | number | Change in shares vs prior period |

### Available Dates

The `availableDates` array contains monthly snapshots going back several years. To fetch holdings for a specific date, use:

```
GET /Apps/FundDetails/{version}/loadData?requests=DHOL~true~{date}~&s={LipperRIC}
```

Where `{date}` is in format `YYYY-MM-DD` (e.g., `DHOL~true~2024-12-31~`).

## Request Types

The `loadData` endpoint supports multiple request types via the `requests` parameter:

| Request Code | Description |
|--------------|-------------|
| `A` | Basic fund info |
| `A\|LP` | Fund info with Lipper data |
| `BEN` | Benchmarks |
| `CLA` | Classifications |
| `DHOL~true~` | Derived holdings (full) |
| `FEE` | Fees and charges |
| `INC` | Income and distribution |
| `KEY` | Key attributes |
| `MD` | Market data (NAV, price, market cap) |
| `PFM` | Performance vs benchmark |
| `TTH` | Top ten holdings |
| `TNA~{start}~{end}` | Total Net Assets time series |

---

## KEY - Key Attributes

Fund characteristics and structure information.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=KEY&s={LipperRIC}&lang=en-US
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `assetStatus` | string | Fund status (e.g., “Active”) |
| `domicile` | string | Country of domicile (e.g., “USA”) |
| `launchDate` | datetime | Fund launch date |
| `manager` | string | Fund manager name |
| `fundCurrency` | string | Base currency (e.g., “US Dollar”) |
| `legalStructureName` | string | Legal structure (e.g., “US - Exchange-Traded Open-end Funds”) |
| `shareTna` | number | Share class TNA in millions |
| `shareTnaDate` | datetime | TNA as-of date |
| `shareTnaCurrencyCode` | string | TNA currency |
| `fundTna` | number | Fund TNA in millions |
| `indexReplicationMethod` | string | Replication method (e.g., “Full”) |
| `managementApproach` | string | Active/Passive |
| `indexTracking` | string | Yes/No |
| `indexPure` | string | Pure index fund indicator |
| `valuationFrequency` | string | Pricing frequency (e.g., “Pricing Daily, Mon-Fri”) |

---

## MD - Market Data

Current NAV, price, and market statistics.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=MD&s={LipperRIC}&lang=en-US
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `navPrice` | number | Current NAV |
| `navPriceDate` | datetime | NAV date |
| `navPriceCurrency` | string | NAV currency |
| `outstanding` | number | Shares outstanding |
| `outstandingDate` | datetime | Outstanding shares date |
| `marketCap` | number | Market capitalization |
| `marketCapCurrency` | string | Market cap currency |
| `iNAV` | string | Intraday NAV RIC (e.g., “QQQiv.OQ”) |
| `exDividend` | number | Ex-dividend amount |
| `exDividendDate` | datetime | Ex-dividend date |
| `RT_CF_LAST` | number | Real-time last price |
| `RT_CF_TIME` | datetime | Real-time price timestamp |
| `RT_HST_CLOSE` | number | Historical close |
| `RT_HSTCLSDATE` | datetime | Historical close date |
| `RT_CF_HIGH` | number | Daily high |
| `RT_CF_LOW` | number | Daily low |
| `RT_CF_OPEN` | number | Daily open |
| `RT_52W_HIGH` | number | 52-week high |
| `RT_52W_LOW` | number | 52-week low |

---

## BEN - Benchmarks

Fund benchmarks with real-time pricing.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=BEN&s={LipperRIC}&srequired={LipperRIC}&lang=en-US
```

### Response Structure

```json
{
  “results”: [{
    “benchmarks”: [
      {
        “benchmarkType”: “Fund Manager”,
        “benchmarkTypeAbbr”: “FM”,
        “name”: “NASDAQ 100 TR”,
        “ric”: “.XNDX”,
        “lipperId”: 11032760,
        “RT_CF_LAST”: 31281.313,
        “RT_CURRENCY”: “USD”
      },
      {
        “benchmarkType”: “Technical Indicator”,
        “benchmarkTypeAbbr”: “TI”,
        “name”: “Russell 1000 Growth TR”,
        “ric”: “.RLGTRI”,
        “lipperId”: 11000689
      },
      {
        “benchmarkType”: “Risk Free Index”,
        “benchmarkTypeAbbr”: “RFI”,
        “name”: “US 3-Month Treasury Bill T...”
      },
      {
        “benchmarkType”: “Lipper Global Classification”,
        “benchmarkTypeAbbr”: “LGC”,
        “name”: “Lipper Global Equity US”
      }
    ]
  }]
}
```

### Benchmark Types

| Abbreviation | Type | Description |
|--------------|------|-------------|
| `FM` | Fund Manager | Primary benchmark set by fund manager |
| `TI` | Technical Indicator | Secondary/style benchmark |
| `RFI` | Risk Free Index | Risk-free rate benchmark |
| `LGC` | Lipper Global Classification | Peer group benchmark |

---

## PFM - Performance

Fund performance vs benchmark with tracking error.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=PFM&s={LipperRIC}&srequired={LipperRIC}&lang=en-US
```

### Response Structure

```json
{
  “results”: [{
    “asset”: {
      “assetIdentifier”: “LP40061149”,
      “name”: “Invesco QQQ Trust, Series 1”,
      “performance1Month”: -0.688,
      “performance3Month”: 2.419,
      “performance6Month”: 11.578,
      “performanceYTD”: 20.768,
      “performance1Year”: 20.768,
      “performance3Year”: 32.869,
      “performance5Year”: 15.049,
      “trackingError1Year”: 0.649,
      “trackingError3Year”: 0.966,
      “trackingError5Year”: 0.922
    },
    “benchmark”: {
      “ric”: “.XNDX”,
      “name”: “NASDAQ 100 TR”,
      “typeAbbreviation”: “FM”,
      “performance1Month”: -0.670,
      “performance3Month”: 2.473,
      “performance1Year”: 21.016,
      “performance3Year”: 33.167,
      “performance5Year”: 15.285
    }
  }]
}
```

### Performance Fields

| Field | Description |
|-------|-------------|
| `performance1Month` | 1-month return (%) |
| `performance3Month` | 3-month return (%) |
| `performance6Month` | 6-month return (%) |
| `performanceYTD` | Year-to-date return (%) |
| `performance1Year` | 1-year return (%) |
| `performance3Year` | 3-year annualized return (%) |
| `performance5Year` | 5-year annualized return (%) |
| `trackingError1Year` | 1-year tracking error vs benchmark |
| `trackingError3Year` | 3-year tracking error |
| `trackingError5Year` | 5-year tracking error |

---

## TTH - Top Ten Holdings

Summary of largest holdings (use DHOL for full holdings).

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=TTH&s={LipperRIC}&srequired={LipperRIC}&lang=en-US
```

### Response Structure

```json
{
  “results”: [{
    “holdings”: [
      {“name”: “NVIDIA CORP ORD”, “ric”: “NVDA.OQ”, “percent”: 9.04, “rank”: 1},
      {“name”: “APPLE INC ORD”, “ric”: “AAPL.OQ”, “percent”: 8.02, “rank”: 2},
      {“name”: “MICROSOFT CORP ORD”, “ric”: “MSFT.OQ”, “percent”: 7.17, “rank”: 3}
    ],
    “holdingsDate”: “2025-12-31T00:00:00”
  }]
}
```

---

## FEE - Fees and Charges

Fee structure and expense ratios.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=FEE&s={LipperRIC}&srequired={LipperRIC}&lang=en-US
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `initialChargeCurrent` | number | Current initial charge (%) |
| `initialChargeMaximum` | number | Maximum initial charge (%) |
| `annualChargeCurrent` | number | Current annual charge (%) |
| `redemptionChargeCurrent` | number | Current redemption charge (%) |
| `redemptionChargeMaximum` | number | Maximum redemption charge (%) |
| `ter` | number | Total Expense Ratio (%) |
| `terDate` | datetime | TER as-of date |
| `minimumInvestmentInitial` | number | Minimum initial investment |
| `minimumInvestmentRegular` | number | Minimum regular investment |
| `minimumInvestmentCurrency` | string | Investment currency |

---

## INC - Income and Distribution

Dividend and yield information.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=INC&s={LipperRIC}&srequired={LipperRIC}&lang=en-US
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `incomeDistribution` | string | Distribution policy (e.g., “Paid”) |
| `incomeOperation` | string | Income operation (e.g., “Paid, Reinvested”) |
| `dividendFrequency` | string | Distribution frequency |
| `dividendPaymentMonths` | string | Payment months (e.g., “March,June,September,December”) |
| `projectedYield` | number | Projected yield (%) |
| `projectedYieldEndDate` | datetime | Projected yield date |
| `dividendPaymentDate` | datetime | Last payment date |
| `dividendXDDate` | datetime | Ex-dividend date |
| `dividendPayment` | number | Last dividend amount |
| `dividendCurrencyCode` | string | Dividend currency |
| `day30regulatoryYield` | number | 30-day SEC yield (%) |
| `annualizedDistributionYield` | number | Annualized distribution yield (%) |

---

## CLA - Classifications

Fund classification schemes.

### Request

```
GET /Apps/FundDetails/{version}/loadData?requests=CLA&s={LipperRIC}&srequired={LipperRIC}&lang=en-US
```

### Response Structure

```json
{
  “results”: [{
    “classifications”: [
      {
        “classSchemeCode”: “EUSLACG1”,
        “classSchemeName”: “Global Holdings Based Classification”,
        “className”: “Equity United States Large-Cap Growth”
      },
      {
        “classSchemeCode”: “LCGE”,
        “classSchemeName”: “US Mutual Fund Classification”,
        “className”: “Large-Cap Growth Funds”
      },
      {
        “classSchemeCode”: “G”,
        “classSchemeName”: “US Mutual Fund Objective”,
        “className”: “Growth Funds”
      }
    ],
    “assetUniverse”: “Exchange Traded Funds”,
    “assetType”: “Equity”,
    “geographicalFocus”: “United States of America”,
    “lipperGlobal”: “Equity US”
  }]
}
```

---

## Example: Fetch QQQ Holdings

```javascript
// Fetch derived holdings for Invesco QQQ Trust
fetch(“https://workspace.refinitiv.com/Apps/FundDetails/1.10.457/loadData?requests=DHOL~true~&s=LP40061149&lang=en-US”, {
  credentials: “include”
})
.then(r => r.json())
.then(data => {
  const holdings = data.results[0].groups[0].items;
  console.log(`Found ${holdings.length} holdings`);

  // Top 10 by weight
  holdings
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 10)
    .forEach(h => {
      console.log(`${h.ric}: ${h.name} - ${h.percent.toFixed(2)}%`);
    });
});
```

## Use Cases

1. **ETF Constituent Analysis** - Get full holdings of any ETF/fund with RICs for further analysis
2. **Portfolio Overlap** - Compare holdings across multiple funds
3. **Historical Holdings** - Track position changes over time using `availableDates`
4. **Weight Changes** - Monitor rebalancing via `sharesChange` field

## Programmatic Access

### Two Separate APIs

Fund data in Refinitiv Workspace comes from **two completely separate APIs**:

| API | Package | Endpoint | Data Source |
|-----|---------|----------|-------------|
| Data Platform | `refinitiv.data` / `lseg.data` | `/data/datagrid/` | TR.* fields |
| Fund Details App | Browser only | `/Apps/FundDetails/loadData` | Lipper database |

The Fund Details API uses request codes (`KEY`, `MD`, `BEN`, `DHOL`, etc.) and provides detailed Lipper data (full holdings with RICs, expense breakdowns, ESG scores). This data is **not exposed via TR.\* fields**.

### RDP Lipper Funds API (Separate Product)

LSEG offers a dedicated **Lipper Funds API** on RDP with full fund coverage:
- 393,000+ active share classes across 80+ markets
- Full holdings, expense breakdowns, classifications
- Endpoint: `/data/funds/v1/...`
- **Requires separate subscription** (not included in standard RDP access)

See: [Lipper Funds API Developer Portal](https://developers.lseg.com/en/api-catalog/refinitiv-data-platform/lipper-funds-API)

### Access Methods Summary

| Method | Access | Coverage |
|--------|--------|----------|
| `refinitiv.data` (TR.* fields) | ✅ Have | Basic fund data only |
| Fund Details Browser API | ✅ Have (via Workspace) | Full Lipper data |
| RDP Lipper Funds API | ❌ Need subscription | Full Lipper data |

### LSEG vs Refinitiv Data Libraries

**CRITICAL:** `lseg.data` and `refinitiv.data` are **different packages** with different entitlements.

| Package | Version | Fund Fields | Install |
|---------|---------|-------------|---------|
| `refinitiv.data` (rd) | 1.6.2 | ✅ **WORKS** | `pip install refinitiv-data` |
| `lseg.data` (ld) | 2.1.1 | ❌ Access denied | `pip install lseg-data` |

**Working example with `refinitiv.data`:**
```python
import refinitiv.data as rd

rd.open_session()
df = rd.get_data(
    universe=[‘IVV’],  # iShares Core S&P 500 ETF
    fields=[
        ‘TR.CUSIP’,
        ‘TR.FundLaunchDate’,
        ‘TR.FundNAV’,
        ‘TR.FundTotalNetAsset’,
        ‘TR.FundCompany’,
        ‘TR.FundTrackingError1Year’,
        ‘TR.FundTrackingError5Year’,
        ‘TR.FundTrackingError10Year’,
    ]
)
print(df)
#   Instrument      CUSIP Launch Date         NAV             Fund Company  Tracking Error 1Y  ...
# 0        IVV  464287200  2000-05-15  695.787139  BlackRock Fund Advisors           0.001317  ...
rd.close_session()
```

**Same code with `lseg.data` fails:**
```python
import lseg.data as ld
ld.open_session()
df = ld.get_data(universe=[‘IVV’], fields=[‘TR.FundNAV’, ...])
# Result: LDError: The access to field(s) denied.
```

### Available Fund Fields (via refinitiv.data)

| Field | Description | Example (QQQ) |
|-------|-------------|---------------|
| `TR.CommonName` | Fund name | Invesco QQQ Trust Series 1 |
| `TR.CUSIP` | CUSIP identifier | 46090E103 |
| `TR.ISIN` | ISIN identifier | US46090E1038 |
| `TR.FundLaunchDate` | Fund inception date | 1999-03-10 |
| `TR.FundCompany` | Fund company/advisor | Invesco Capital Management LLC |
| `TR.FundLegalStructure` | Legal structure | US - Exchange-Traded Open-end Funds |
| `TR.FundNAV` | Net Asset Value | 625.49 |
| `TR.FundTotalNetAsset` | Total Net Assets | (works for some funds) |
| `TR.FundTER` | Total Expense Ratio (%) | 0.2 |
| `TR.SharesOutstanding` | Shares outstanding | 654,350,000 |
| `TR.CompanyMarketCap` | Market capitalization | 409,269,751,000 |
| `TR.TotalReturn1Mo` | 1-month return | 0.25% |
| `TR.TotalReturn3Mo` | 3-month return | 1.48% |
| `TR.TotalReturnYTD` | YTD return | 1.82% |
| `TR.TotalReturn1Yr` | 1-year return | 18.69% |
| `TR.FundTrackingError1Year` | 1-year tracking error | 0.65 |
| `TR.FundTrackingError3Year` | 3-year tracking error | 0.97 |
| `TR.FundTrackingError5Year` | 5-year tracking error | 0.92 |
| `TR.FundBenchmarkName` | Benchmark name | NASDAQ 100 TR |
| `TR.FundBenchmarkType` | Benchmark type | Fund Manager |
| `TR.FundBenchmarkInstrumentCode` | Benchmark Lipper ID | 11032760 |
| `TR.FundBenchmarkInstrumentRIC` | Benchmark RIC | .XNDX |
| `TR.FundTrackingError10Year` | 10-year tracking error | 1.07 |
| `TR.FundObjective` | Investment objective | (full text) |
| `TR.DividendYield` | Dividend yield | 0.45% |

### Fields NOT Available via refinitiv.data

These fields do not resolve - use the Fund Details browser API instead:

| Category | Fields Attempted |
|----------|------------------|
| Holdings | `TR.FundNumberOfHoldings`, `TR.FundTopHolding*`, `TR.FundTop10HoldingsWeight` |
| Expense Breakdown | `TR.FundExpenseRatio`, `TR.FundManagementFee`, `TR.Fund12b1Fee` |
| Lipper | `TR.LipperID`, `TR.LipperRIC`, `TR.LipperClassification`, `TR.LipperRating` |
| ETF-specific | `TR.ETFExpenseRatio`, `TR.ETFNav`, `TR.ETFPremiumDiscount` |

### refinitiv.data vs Fund Details Browser API

| Data | refinitiv.data | Fund Details API |
|------|----------------|------------------|
| Basic Info (name, CUSIP, launch date) | ✅ | ✅ |
| NAV, Market Cap | ✅ | ✅ |
| TER/Expense Ratio | ✅ `TR.FundTER` | ✅ |
| Returns (1M, 3M, YTD, 1Y) | ✅ | ✅ |
| Tracking Error | ✅ | ✅ |
| Benchmark Name + RIC | ✅ `.XNDX` | ✅ |
| Fund Objective | ✅ | ✅ |
| Dividend Yield | ✅ | ✅ |
| **Full Holdings List** | ❌ | ✅ (e.g., 103 for QQQ) |
| **Holdings with RICs** | ❌ | ✅ (NVDA.OQ, AAPL.OQ, etc.) |
| **Holdings Weights** | ❌ | ✅ (% for each holding) |
| **Holdings Share Counts** | ❌ | ✅ |
| **Expense Breakdowns** | ❌ | ✅ (Management, 12b-1, etc.) |
| **ESG Scores** | ❌ | ✅ |
| **Lipper Classification** | ❌ | ✅ |
| **Historical Holdings** | ❌ | ✅ (monthly snapshots) |

**Recommendation:** Use `refinitiv.data` for basic fund metrics and screening. Use the Fund Details browser API (or browser automation) for full holdings data and detailed breakdowns.

### Installation Note

`refinitiv-data` requires `scipy<1.13` which conflicts with newer Python versions. Use Python 3.11:

```toml
# pixi.toml
[dependencies]
python = ">=3.11,<3.12"
scipy = ">=1.10,<1.13”

[pypi-dependencies]
refinitiv-data = “*”
```

### Browser Automation Approach

The Fund Details API requires Workspace session authentication. Use browser automation to fetch data:

```javascript
// Run in browser console while logged into Workspace
async function fetchFundDetails(lipperRic) {
  const baseUrl = “https://workspace.refinitiv.com/Apps/FundDetails/1.10.457/loadData”;
  const requests = [‘KEY’, ‘MD’, ‘BEN’, ‘PFM’, ‘TTH’, ‘FEE’, ‘INC’, ‘CLA’, ‘DHOL~true~’];
  const result = { lipperRic, data: {} };

  for (const req of requests) {
    const url = `${baseUrl}?requests=${req}&s=${lipperRic}&srequired=${lipperRic}&lang=en-US`;
    const response = await fetch(url, { credentials: “include” });
    const json = await response.json();
    result.data[req.replace(‘~true~’, ‘’)] = json.results?.[0] || json;
  }

  // Download as JSON
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: ‘application/json’ });
  const a = document.createElement(‘a’);
  a.href = URL.createObjectURL(blob);
  a.download = `fund_data_${lipperRic}.json`;
  a.click();
  return result;
}

// Usage: fetchFundDetails(“LP40061149”);
```

### Finding Lipper RICs

Use FSCREEN to find Lipper RICs for funds/ETFs, then use those RICs with this API.

## When to Use LSEG Lipper vs WRDS

**Recommendation:** Use LSEG Lipper for **fund characteristics only**, not for holdings or NAV/performance data.

| Data Type | Recommended Source | Rationale |
|-----------|-------------------|-----------|
| **Fund Characteristics** | LSEG Lipper | Classifications, benchmarks, expense ratios, fund structure |
| **Holdings** | WRDS Thomson S12 | SEC filing-based, standardized, academic standard |
| **NAV & Returns** | WRDS CRSP | Primary academic source, Lipper is an underlying data source for CRSP |
| **Performance Analysis** | WRDS CRSP + MFLINKS | Links CRSP returns to S12 holdings |

### Data Source Comparison

| Source | Coverage | Access | Best For |
|--------|----------|--------|----------|
| **LSEG Lipper** (Workspace) | Fund characteristics, classifications, benchmarks | Workspace browser, `refinitiv.data` | Fund screening, peer grouping |
| **WRDS CRSP** | NAV, returns, TNA, fund characteristics | WRDS PostgreSQL | Performance analysis, returns research |
| **WRDS Thomson S12** | Portfolio holdings (SEC filings) | WRDS PostgreSQL | Holdings-based research |
| **WRDS MFLINKS** | Linking tables | WRDS PostgreSQL | Merging CRSP with S12 |

### Why Not Use Lipper for Holdings/NAV?

1. **Holdings**: Lipper holdings are fund company-reported, not SEC filing-based. S12 uses standardized 13F/N-CSR filings.
2. **NAV/Returns**: CRSP is the academic standard and actually uses Lipper as an underlying source. Use CRSP for consistency with published research.
3. **Reproducibility**: WRDS provides stable, versioned datasets. Lipper data in Workspace can change.

### WRDS Tables Reference

```sql
-- NAV and Returns (CRSP)
SELECT * FROM crsp.fund_summary2 WHERE crsp_fundno = ...;
SELECT * FROM crsp.monthly_nav WHERE crsp_fundno = ...;

-- Holdings (Thomson S12)
SELECT * FROM tfn.s12 WHERE fdate = ...;

-- Link CRSP to S12
SELECT * FROM mfl.mflink1 WHERE crsp_fundno = ...;
```

## Notes

- Authentication requires active Refinitiv Workspace session (cookies)
- Holdings data is typically updated monthly
- The `ric` field can be used directly with `ld.get_data()` for further analysis
- Large funds (e.g., QQQ) may have 100+ holdings
