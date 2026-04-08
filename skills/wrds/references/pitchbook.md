# PitchBook on WRDS

## Contents

- [Overview](#overview)
- [Schema Architecture](#schema-architecture)
- [Row Counts and Coverage](#row-counts-and-coverage)
- [ID Formats](#id-formats)
- [CRITICAL: Quirks and Gotchas](#critical-quirks-and-gotchas)
- [Key Tables](#key-tables)
- [Relation Tables](#relation-tables)
- [Canonical Query Patterns](#canonical-query-patterns)
- [Linking to Other Datasets](#linking-to-other-datasets)
- [Fund Formation Use Case](#fund-formation-use-case)

## Overview

PitchBook covers private market activity: VC/PE deals, fund formation, LP commitments, and fund-level performance. On WRDS, data is current as of ~March 2026 (`lastupdated` max = 2026-03-25). Best use cases:

- **PE deal activity** (Buyout/LBO, Growth/Expansion, add-ons) — complement to SDC M&A
- **VC deal activity** (rounds, valuations, investor syndicate composition)
- **Fund formation** (fund vintage, size, close dates) — complement to Form D 3C.1/3C.7
- **Fund performance** (IRR, TVPI, DPI by vintage/strategy via `wrds_fund_returns`)
- **LP commitments** to funds (`fundlpcommitmentrelation`)

## Schema Architecture

| Schema | Description | Use |
|--------|-------------|-----|
| `pitchbk` | **Views** pointing to the schemas below. Zero storage. | Convenience access |
| `pitchbk_companies_deals` | **Primary schema.** 10.3M companies + 2.97M deals globally. | Deal / company analysis |
| `pitchbk_investors_funds_lps` | Investors, funds, limited partners. | Fund formation, LP research |
| `pitchbk_fund_returns` | Fund-level IRR, DPI, TVPI, RVPI. Includes `wrds_fund_returns` convenience table. | Performance analysis |
| `pitchbk_people` | 4.9M people with job histories, board seats, education. | Executive / board research |
| `pitchbk_common` | Single-row `pitchbk_qvards` codebook (194 columns). | Field definitions |
| `pitchbk_vc_na` / `pitchbk_pe_na` / `pitchbk_other_na` | VC / PE / other deals, North America subsets. | Targeted NA pulls |
| `pitchbk_vc_row` / `pitchbk_pe_row` / `pitchbk_other_row` | Same, rest of world. | |
| `pitchbk_*_old` | Previous-vintage snapshots of every schema. | Point-in-time / change diff |

**Key insight:** `pitchbk_companies_deals` is the comprehensive global table. The segmented schemas (`vc_na`, `pe_na`, etc.) are subsets — useful for targeted pulls but don't contain all columns.

## Row Counts and Coverage

| Table | Rows | Date range |
|-------|------|------------|
| `pitchbk_companies_deals.company` | 10,281,907 | lastupdated: 2025-09-26 to 2026-03-25 |
| `pitchbk_companies_deals.deal` | 2,971,688 | dealdate: 1820–2030 (filter!); announceddate: 1951–2026 |
| `pitchbk_companies_deals.dealinvestorrelation` | 3,497,494 | — |
| `pitchbk_companies_deals.companyinvestorrelation` | 3,270,352 | — |
| `pitchbk_investors_funds_lps.investor` | 638,167 | — |
| `pitchbk_investors_funds_lps.fund` | 161,277 | closedate: 1959–2026 |
| `pitchbk_investors_funds_lps.limitedpartner` | 62,960 | — |
| `pitchbk_fund_returns.wrds_fund_returns` | 664,095 | asofyear: 1982–2026 |
| `pitchbk_fund_returns.fundreturnrelation` | 532,884 | — |
| `pitchbk_people.person` | 4,858,235 | — |

**Segmented schema counts (NA only):**

| Schema | Companies | Deals |
|--------|-----------|-------|
| `pitchbk_vc_na` | 199,593 | 500,943 |
| `pitchbk_pe_na` | 129,905 | 188,114 |
| `pitchbk_other_na` | 437,448 | 632,666 |

## ID Formats

| Entity | Format | Example |
|--------|--------|---------|
| Company | `NNNNNN-NN` | `100001-08` |
| Deal | `NNNNNN-NNT` | `100030-96T` |
| Investor | `NNNNNN-NN` (same format, different space) | `100002-16` |
| Fund | `NNNNN-NNF` | `10913-68F` |
| Person | `NNNNNN-NNP` | `100000-00P` |

**Warning:** `companyid` and `investorid` share the same `NNNNNN-NN` format but are separate ID spaces. Never join company to investor on raw ID equality.

## CRITICAL: Quirks and Gotchas

### 1. `dealsize` is in **USD millions** — not dollars

```python
# CORRECT: $2.5B deal
deal['dealsize'] == 2500.0   # means $2,500M = $2.5B

# WRONG: do NOT divide by 1e6
deal['dealsize'] / 1e6       # would give $0.0025 — meaningless
```

Same convention applies to: `fundsize`, `aum`, `drypowder`, `totalraised`, `premoneyvaluation`, `postvaluation`, `nav`, `contributed`, `distributed`, all financial columns on company/deal tables.

### 2. `dealdate` has extreme outliers — always filter

```sql
AND d.dealdate BETWEEN '1950-01-01' AND CURRENT_DATE
```

Raw range: 1820-01-01 to 2030-12-31. Future dates = pending/forward-dated deals. The 1820 entries are data errors.

### 3. `pitchbk.*` = views, zero storage

Querying `pitchbk.deal` is identical to `pitchbk_companies_deals.deal`. Use whichever is more readable.

### 4. High null rates on financial data

Most financial metrics are only populated for funded companies:

| Column | Null rate |
|--------|-----------|
| `dealsize` | 57% |
| `premoneyvaluation` | 91% |
| `postvaluation` | 82% |
| `company.totalraised` | 96% |
| `company.cikcode` | 99% |
| `company.revenue` | 76% |

### 5. `companysimilarrelation` is 70 GB — avoid full scans

### 6. Fund returns are panel data with stale terminal entries

Liquidated funds repeat the same terminal IRR/TVPI/DPI across every subsequent reporting period. For cross-sectional analysis, take the latest observation per fund or restrict to `fundstatus IN ('Liquidated', 'Closed')` with a max `asofyear` per fund.

### 7. Use `wrds_fund_returns` not `fundreturnrelation`

`wrds_fund_returns` (664K rows) adds `fundname` denormalized from the fund table and has ~25% more rows than raw `fundreturnrelation` (533K). Always start here.

### 8. CIK crosswalk: use `companycikcoderelation`, not `company.cikcode`

`company.cikcode` can hold multiple semicolon-delimited CIKs in a single varchar. `companycikcoderelation` is the normalized one-row-per-CIK table.

### 9. Boolean flags are `varchar(3)` "Yes"/"No"

`isleadinvestor`, `addon`, `sbicfund`, `pik`, `convertible`, etc. are all stored as "Yes"/"No" strings, not booleans.

```sql
WHERE di.isleadinvestor = 'Yes'   -- correct
WHERE di.isleadinvestor = true    -- WRONG
```

### 10. `_old` schemas are previous-vintage snapshots

Use `pitchbk_companies_deals_old.*` to reconstruct prior state or detect changes.

### 11. `hqglobalregion` uses **"Americas"**, not "North America"

```sql
-- CORRECT
WHERE c.hqglobalregion = 'Americas'

-- WRONG — returns 0 rows
WHERE c.hqglobalregion = 'North America'
```

Valid values: `'Americas'`, `'Europe'`, `'Asia'`, `'Oceania'`, `'Middle East'`, `'Africa'`. "Americas" covers the US, Canada, and Latin America combined — there is no continent-level US/Canada split in this field.

### 12. PitchBook debt is private credit — no 144A/registered distinction

PitchBook `deal` table debt types (`'Debt - General'`, `'Debt Refinancing'`, etc.) are predominantly **private credit** (term loans, revolvers, mezzanine). The main `deal` table has **no field** distinguishing 144A from registered offerings.

The `dealbondrelation` table has a `marketplace` field with values like `"144A"` and `"RegS"`, but coverage is sparse — it only captures bonds associated with PitchBook-tracked deals, not the broader public bond market.

**For 144A/registered debt analysis, use:**
- **Mergent FISD** (`fisd.fisd_issue`, `rule_144a` flag) — corporate bonds
- **SDC NI** (`sdc.wrds_ni_details`, `market = 'EURO/144A'`) — global issuance including structured products

## Key Tables

### `pitchbk_companies_deals.deal` — Key Columns

| Column | Type | Notes |
|--------|------|-------|
| `dealid` | varchar(10) | Primary key (ends in T) |
| `companyid` | varchar(10) | FK to company |
| `companyname` | varchar(156) | Denormalized |
| `dealdate` | date | Effective/close date (has outliers — filter) |
| `announceddate` | date | Press release date |
| `dealsize` | double | **USD millions** |
| `nativeamountofdeal` | double | Local currency amount |
| `nativecurrencyofdeal` | varchar(41) | e.g. "US Dollars (USD)" |
| `dealstatus` | varchar(21) | "Completed", "Pending", "Rumored", "Cancelled" |
| `dealsizestatus` | varchar(9) | "Exact", "Estimated", "Unknown" |
| `dealtype` | varchar(42) | Primary classification (never null) |
| `dealtype2`, `dealtype3` | varchar | Secondary/tertiary |
| `dealclass` | varchar(17) | "Venture Capital", "Private Equity", "Corporate", "Debt", "Other", "Public Investment" |
| `vcround` | varchar(10) | "Series A", "Series B", etc. |
| `percentacquired` | double | % ownership acquired |
| `addon` | varchar(3) | "Yes"/"No" — add-on acquisition? |
| `addonplatform` | varchar(86) | Platform company name |
| `premoneyvaluation`, `postvaluation` | double | USD millions |
| `investors` | double | Count of investors in round |
| `exitscope` | varchar(7) | "Full" or "Partial" |

**Top deal types by volume:**

| dealtype | dealclass | Count |
|----------|-----------|-------|
| Merger/Acquisition | Corporate | 513,218 |
| Accelerator/Incubator | Other | 332,739 |
| Early Stage VC | Venture Capital | 248,455 |
| Buyout/LBO | Private Equity | 221,509 |
| Later Stage VC | Venture Capital | 185,005 |
| Seed Round | Venture Capital | 163,691 |
| Debt - General | Debt | 143,820 |
| IPO | Public Investment | 91,083 |
| PE Growth/Expansion | Private Equity | 86,337 |
| PIPE | Corporate | 51,116 |

### `pitchbk_investors_funds_lps.fund` — Key Columns

| Column | Type | Notes |
|--------|------|-------|
| `fundid` | varchar(9) | Primary key (ends in F) |
| `fundname` | varchar(121) | |
| `investor` | varchar(191) | GP name (denormalized) |
| `vintage` | double | Vintage year |
| `fundstatus` | varchar(14) | "Closed", "Liquidated", "Fully Invested", "Raising", "In Registration" |
| `fundsize` | double | **USD millions** |
| `fundcategory` | varchar(31) | "Venture Capital", "Private Equity", "Debt", "Real Assets - Real Estate" |
| `fundtype` | varchar(41) | e.g. "Buyout", "Venture - General", "Direct Lending" |
| `sbicfund` | varchar(3) | "Yes"/"No" — SBIC license |
| `closedate` | date | Final close |
| `opendate` | date | First close |
| `fundsizegroup` | varchar(11) | e.g. "250M - 499M", "1B - 4.99B" |

**Top fund types:**

| fundtype | fundcategory | Count |
|----------|-------------|-------|
| Venture - General | Venture Capital | 40,998 |
| Hedge Fund | Other | 31,525 |
| Buyout | Private Equity | 26,301 |
| Venture Capital - Early Stage | Venture Capital | 14,278 |
| Direct Lending | Debt | 2,091 |

### `pitchbk_fund_returns.wrds_fund_returns` — Key Columns

| Column | Notes |
|--------|-------|
| `fundid`, `fundname` | Fund identifier + denormalized name |
| `asofyear` | Reporting year |
| `asofquarter` | "1Q"–"4Q" or NULL (annual-only reporters) |
| `irr` | Net IRR, percent (e.g. 9.21 = 9.21%) |
| `dpi` | Distributions to paid-in |
| `tvpi` | Total value to paid-in |
| `rvpi` | Residual value to paid-in |
| `nav` | Net asset value, USD millions |
| `contributed` | Capital called, USD millions |
| `distributed` | Distributions, USD millions |
| `quartile` | "1 (Top)", "2 (Upper-Mid)", "3 (Lower-Mid)", "4 (Bottom)" |
| `sources` | LP data source |

Non-null rates: IRR 48%, TVPI 55%, DPI 56%, NAV 58%. IRR distribution: p25=2.3%, median=9.5%, p75=17.0%.

### `pitchbk_companies_deals.company` — Key Columns

| Column | Notes |
|--------|-------|
| `companyid`, `companyname` | |
| `businessstatus` | "Generating Revenue", "Out of Business", "Profitable", "Startup", etc. (52% null) |
| `ownershipstatus` | "Privately Held (backing)", "Acquired/Merged", "Publicly Held", etc. |
| `companyfinancingstatus` | "Corporation", "Venture Capital-Backed", "Private Equity-Backed", etc. |
| `yearfounded` | 15% null |
| `hqcountry`, `hqstate_province`, `hqcity` | Location |
| `hqglobalregion` | "Americas", "Europe", "Asia", "Oceania", "Middle East", "Africa" — **NOT "North America"** |
| `primaryindustrysector`, `primaryindustrygroup` | PitchBook taxonomy |
| `totalraised` | USD millions, cumulative (96% null) |
| `lastfinancingdate`, `lastfinancingsize`, `lastfinancingdealtype` | Most recent deal |
| `cikcode` | SEC CIK — multiple values semicolon-separated; use `companycikcoderelation` instead |
| `ticker`, `exchange` | Public company data |

## Relation Tables

### Companies & Deals

| Table | Purpose |
|-------|---------|
| `dealinvestorrelation` | Investors per deal (3.5M rows); `isleadinvestor` "Yes"/"No" |
| `dealsellerrelation` | Sellers/exiters per deal; `entryamount`, `exitamount`, `timetoexit` |
| `dealserviceproviderrelation` | Advisors per deal; `serviceprovided`, `buyside_sellside` |
| `dealdebtlenderrelation` | Debt tranche × lender; spread, seniority, maturity, LCD crossref IDs |
| `dealbondrelation` | Bond terms; `marketplace` ("144A", "RegS"), `pik`, `convertible` |
| `dealtrancherelation` | VC round tranches; `tranchedate`, `amount`, `stockseriestype` |
| `companycikcoderelation` | Normalized CIK crosswalk (one row per CIK) |
| `companysiccoderelation` | SIC codes per company |
| `companynaicscoderelation` | NAICS codes per company |
| `companyinvestorrelation` | All investors per company; `investorsince`, `investorexit` |
| `companyfinancialrelation` | Historical financials (time series) |
| `companyboardteamrelation` | Board members and executives |

### Investors, Funds, LPs

| Table | Purpose |
|-------|---------|
| `fundlpcommitmentrelation` | LP commitments per fund; `commitment`, `commitmentdate`, `commitmentstatus` |
| `lpfundcommitmentrelation` | LP → fund commitments (same data, LP-centric) |
| `fundclosehistoryrelation` | First/interim/final close dates and amounts |
| `fundportfolioholdingsrelation` | BDC/credit fund holdings (998K rows) |
| `investorfundrelation` | Investor → fund mapping |
| `investorinvestyearrelation` | Deal activity by investor × year |
| `investorcoinvestorrelation` | Co-investment frequency between pairs |

## Canonical Query Patterns

### Annual PE deal activity (Buyout/LBO + Growth)

```python
cursor.execute("""
    SELECT
        EXTRACT(YEAR FROM d.dealdate)::int AS deal_year,
        d.dealtype,
        COUNT(*)                            AS deal_count,
        SUM(d.dealsize)                     AS total_size_mn,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.dealsize) AS median_size_mn
    FROM pitchbk_companies_deals.deal d
    WHERE d.dealclass = 'Private Equity'
      AND d.dealstatus = 'Completed'
      AND d.dealdate BETWEEN %(start_date)s AND %(end_date)s
    GROUP BY deal_year, d.dealtype
    ORDER BY deal_year, deal_count DESC
""", {'start_date': '2010-01-01', 'end_date': '2024-12-31'})
```

### Fund formation by vintage (PE/VC funds closed)

```python
cursor.execute("""
    SELECT
        f.vintage::int                          AS vintage_year,
        f.fundcategory,
        COUNT(*)                                AS funds_closed,
        SUM(f.fundsize)                         AS total_raised_mn,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f.fundsize) AS median_size_mn
    FROM pitchbk_investors_funds_lps.fund f
    WHERE f.fundstatus IN ('Closed', 'Liquidated', 'Fully Invested')
      AND f.fundcategory IN ('Venture Capital', 'Private Equity')
      AND f.vintage BETWEEN %(start_year)s AND %(end_year)s
      AND f.fundsize IS NOT NULL
    GROUP BY vintage_year, f.fundcategory
    ORDER BY vintage_year, f.fundcategory
""", {'start_year': 2010, 'end_year': 2024})
```

### Fund performance by vintage and strategy (latest observation per fund)

```python
cursor.execute("""
    SELECT
        f.fundid, f.fundname, f.fundtype, f.vintage, f.fundsize,
        r.asofyear, r.irr, r.tvpi, r.dpi, r.rvpi, r.nav, r.quartile
    FROM pitchbk_investors_funds_lps.fund f
    JOIN pitchbk_fund_returns.wrds_fund_returns r ON f.fundid = r.fundid
    WHERE f.fundcategory = 'Private Equity'
      AND r.asofquarter = '4Q'
      AND r.asofyear = (
          SELECT MAX(r2.asofyear)
          FROM pitchbk_fund_returns.wrds_fund_returns r2
          WHERE r2.fundid = r.fundid
            AND r2.asofquarter = '4Q'
      )
      AND f.vintage BETWEEN 2000 AND 2020
""")
```

### Deal investors for a specific deal class (with lead flag)

```python
cursor.execute("""
    SELECT
        d.dealid, d.dealdate, d.companyname, d.dealtype, d.dealsize,
        di.investorname, di.isleadinvestor, di.investorfundname
    FROM pitchbk_companies_deals.deal d
    JOIN pitchbk_companies_deals.dealinvestorrelation di ON d.dealid = di.dealid
    WHERE d.dealclass = 'Venture Capital'
      AND d.dealdate BETWEEN '2015-01-01' AND '2020-12-31'
      AND d.dealstatus = 'Completed'
      AND di.isleadinvestor = 'Yes'
    LIMIT 1000
""")
```

## Linking to Other Datasets

### PitchBook → Compustat / CRSP (via CIK)

```sql
-- Normalized crosswalk (preferred)
SELECT ck.companyid, ck.cikcode, l.gvkey
FROM pitchbk_companies_deals.companycikcoderelation ck
JOIN wrdssec.wciklink_gvkey l
  ON LPAD(ck.cikcode, 10, '0') = LPAD(l.cik::text, 10, '0')
```

Coverage: ~110K of 10M+ PitchBook companies have a CIK. Best for VC/PE-backed companies; sparse for unfinanced private firms.

### PitchBook → Form D (via CIK)

```sql
SELECT f.primarycik, f.primaryentityname, f.exempt_item,
       ck.companyid, c.companyname
FROM wrdssec.wrds_vc_formd f
JOIN pitchbk_companies_deals.companycikcoderelation ck
  ON LPAD(f.primarycik, 10, '0') = LPAD(ck.cikcode, 10, '0')
JOIN pitchbk_companies_deals.company c ON ck.companyid = c.companyid
WHERE f.submissiontype = 'D'
  AND f.isamendment = 'false'
```

### PitchBook → SDC (name matching)

No key-based link. Match on `companyname` + `dealdate` ± 30 days, or `ticker` for public targets. Use SDC for deal terms (fees, advisors); PitchBook for investor roster and fund-level data.

## Fund Formation Use Case

For studying private fund formation (complement to Form D §3(c)(1)/§3(c)(7) filings):

| Dimension | PitchBook source | Form D source |
|-----------|-----------------|---------------|
| Fund count by vintage | `fund` table, `fundstatus` = Closed | `wrds_vc_formd`, `exempt_item` IN ('3C.1','3C.7') |
| Fund size | `fundsize` (USD millions, often missing) | `totalamountsold` (string, often missing) |
| Strategy | `fundcategory` / `fundtype` | Not available |
| LP names | `fundlpcommitmentrelation` | Not available |
| Fund performance | `wrds_fund_returns` (IRR, TVPI, DPI) | Not available |
| Filing date | Not available | `signaturedate` / accession year |

PitchBook has richer fund-level data; Form D has better coverage of smaller funds that don't make it into PitchBook's database.
