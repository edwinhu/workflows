# SEC Form D Filings

## Contents

- [Tables](#tables)
- [Key Fields](#key-fields)
- [CIK Columns](#cik-columns-critical)
- [Industry Categories](#industry-categories)
- [Exemption Types](#exemption-types)
- [Query Patterns](#query-patterns)
- [Deduplication](#deduplication)
- [Common Gotchas](#common-gotchas)

## Tables

| Table | Description |
|-------|-------------|
| `wrdssec.wrds_vc_formd` | Form D filings — 9.69M rows, 425K unique offerings, 186K unique CIKs |

## Key Fields

### Issuer Identity
- `primarycik` - SEC CIK (10-digit padded) — **USE THIS for linking**
- `primaryentityname` - Company name
- `primaryjurisdictionofinc` - State/country of incorporation
- `primaryentitytype` - Corporation, LLC, LP, Trust, etc.
- `primaryissuer_stateorcountry` - State/country code
- `accession` - SEC accession number (unique per filing)

### Offering Details
- `industrygrouptype` - Industry classification (35 categories, see below)
- `exempt_item` - Exemption type code (06, 06b, 06c, etc.)
- `first_sale_date` - Date of first sale (DATE type, only date field available)
- `totalofferingamount` - Total offering amount (varchar, may contain text)
- `totalamountsold` - Amount sold to date
- `totalremaining` - Remaining amount
- `minimuminvestmentaccepted` - Minimum investment

### Security Type Flags (varchar Y/N)
- `isequitytype` - Equity offering
- `isdebttype` - Debt offering
- `isoptiontoacquiretype` - Options
- `issecuritytobeacquiredtype` - Securities to be acquired
- `ispooledinvestmentfundtype` - Pooled investment fund
- `istenantincommontype` - Tenant in common
- `ismineralpropertytype` - Mineral property

### Fund-Specific
- `investmentfundtype` - Type of investment fund
- `is40act` - Subject to Investment Company Act
- `revenuerange` - Revenue range
- `aggregatenetassetvaluerange` - Net asset value range

### Investor Info
- `hasnonaccreditedinvestors` - Non-accredited investors present
- `numbernonaccreditedinvestors` - Count of non-accredited investors
- `totalnumberalreadyinvested` - Total investor count

### Filing Metadata
- `submissiontype` - D, D/A (amendment), etc.
- `isamendment` - Amendment flag
- `previousaccessionnumber` - Prior filing accession (for amendments)

## CIK Columns (CRITICAL)

Three CIK-like columns exist but serve different purposes:

| Column | What It Is | Unique Values | Use Case |
|--------|-----------|---------------|----------|
| `primarycik` | **SEC CIK** | 186,303 | Primary linking key to EDGAR |
| `regcik` | Registrant CIK | 186,630 | Usually matches primarycik |
| `issuer_cik` | **FINRA CRD number** | 3,402 | NOT an SEC CIK — broker-dealer tracking |

**WARNING:** `issuer_cik` is a FINRA CRD number, not an SEC CIK. Do not use it for EDGAR lookups.

## Industry Categories

35 categories in `industrygrouptype`:

| Category | Count | Notes |
|----------|-------|-------|
| Construction | 5,346,820 | Largest category (row-level, denormalized) |
| Other | 1,695,939 | Catch-all |
| Retailing | 1,570,435 | |
| Pooled Investment Fund | 354,082 | Hedge funds, PE funds, VC funds |
| Other Health Care | 188,901 | |
| Manufacturing | 168,088 | |
| REITS and Finance | 98,081 | REITs and financial companies |
| Other Real Estate | 71,412 | |
| Other Technology | 48,528 | |
| Oil and Gas | 42,338 | |
| Commercial | 17,543 | Commercial real estate |
| Residential | 13,589 | Residential real estate |
| Insurance | 13,043 | |
| Biotechnology | 10,343 | |
| Other Energy | 8,905 | |
| Other Banking and Financial Services | 8,430 | |
| Investing | 7,729 | |
| Pharmaceuticals | 4,281 | |
| Business Services | 3,178 | |
| Computers | 3,098 | |
| Restaurants | 2,899 | |
| Commercial Banking | 2,579 | |
| Telecommunications | 2,236 | |
| Agriculture | 2,017 | |
| Lodging and Conventions | 1,212 | |
| Hospitals and Physicians | 997 | |
| Environmental Services | 638 | |
| Energy Conservation | 609 | |
| Electric Utilities | 381 | |
| Other Travel | 349 | |
| Investment Banking | 331 | |
| Tourism and Travel Services | 267 | |
| Health Insurance | 175 | |
| Coal Mining | 158 | |
| Airlines and Airports | 118 | |

## Exemption Types

`exempt_item` field values:

| Code | Meaning | Count |
|------|---------|-------|
| `06` | Rule 506 (unspecified) | 8,180,557 |
| `06b` | Rule 506(b) | 1,077,496 |
| `3C.7` | ICA Section 3(c)(7) | 260,803 |
| `3C.1` | ICA Section 3(c)(1) | 80,983 |
| `06c` | Rule 506(c) | 59,919 |
| `3C.5` | ICA Section 3(c)(5) | 7,014 |
| `04` | Rule 504 | 6,317 |
| `46` | Section 4(a)(6) / Reg CF | 4,016 |
| `4a5` | Section 4(a)(5) | 2,745 |
| `3C.6` | ICA Section 3(c)(6) | 2,433 |
| `05` | Rule 505 (repealed 2017) | 2,026 |
| `3C.9` | ICA Section 3(c)(9) | 1,817 |
| `3C` | ICA Section 3(c) general | 1,746 |
| `04.3` | Rule 504 (subsection) | 1,203 |

Note: A single accession can have MULTIPLE rows with different `exempt_item` values (one per exemption claimed).

## Query Patterns

### Deduplicated Offerings (One Row Per Filing)
```sql
SELECT DISTINCT ON (accession)
    primarycik, primaryentityname, industrygrouptype,
    exempt_item, first_sale_date, totalofferingamount,
    isequitytype, isdebttype, accession
FROM wrdssec.wrds_vc_formd
ORDER BY accession, first_sale_date DESC NULLS LAST
```

### Offerings by Industry
```sql
SELECT industrygrouptype, COUNT(DISTINCT accession) as offerings
FROM wrdssec.wrds_vc_formd
WHERE industrygrouptype IS NOT NULL
GROUP BY industrygrouptype
ORDER BY offerings DESC
```

### Find Form D Filings for a Company by CIK
```sql
SELECT DISTINCT ON (accession)
    accession, primaryentityname, industrygrouptype,
    exempt_item, first_sale_date, totalofferingamount
FROM wrdssec.wrds_vc_formd
WHERE primarycik = %s
ORDER BY accession, first_sale_date DESC NULLS LAST
```

### All Exemptions for a Filing
```sql
SELECT DISTINCT exempt_item
FROM wrdssec.wrds_vc_formd
WHERE accession = %s
```

### Rule 506(b) Equity Offerings in Date Range
```sql
SELECT DISTINCT ON (accession)
    primarycik, primaryentityname, first_sale_date, totalofferingamount
FROM wrdssec.wrds_vc_formd
WHERE exempt_item = '06b'
  AND isequitytype = 'Y'
  AND first_sale_date BETWEEN %s AND %s
ORDER BY accession, first_sale_date DESC NULLS LAST
```

## Deduplication

The table is heavily denormalized: **one row per related person/recipient per offering**, not one row per offering. A single Form D filing with 5 related persons and 10 state recipients generates 50+ rows.

**Always deduplicate** using `DISTINCT ON (accession)` or `GROUP BY accession` before analysis.

Row count by level:
- Total rows: 9,689,729
- Unique accessions: 425,603
- Unique CIKs: 186,303

## Common Gotchas

1. **`issuer_cik` is NOT a SEC CIK** — it's a FINRA CRD number. Use `primarycik` for EDGAR linking.
2. **Row explosion** — Multiple rows per accession from denormalization. Always deduplicate.
3. **`industrygrouptype` can be NULL** — Not all filings have industry classification.
4. **`totalofferingamount` is varchar** — Contains text like "Indefinite" or formatted numbers. Cast carefully.
5. **No filing date field** — Only `first_sale_date` is available (the date of the offering, not the SEC filing).
6. **Amendments** — `isamendment = 'Y'` indicates amended filings. Use `previousaccessionnumber` to link to original.
7. **Multiple exemptions per filing** — One filing can claim multiple exemptions (e.g., Rule 506(b) AND Section 3(c)(7)). Use `SELECT DISTINCT exempt_item WHERE accession = X` to get all.
