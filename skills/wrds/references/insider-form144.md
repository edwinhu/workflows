# Thomson Reuters Form 144 (Rule 144 Proposed Sales)

**Reliable coverage start: June 1996, filtered on `secdate` (SEC receipt date), not `fdate`.** Rows with `secdate` before 1996-06-01 are stray (71 rows, 1907-1995; under 100 rows a month through May 1996, then ~3,000-4,000 a month). `fdate` is unusable as a time filter before ~2018: 172,067 rows are stamped `2001-12-31` (a load date) and the lag from `secdate` runs to years. Pre-2023 rows are Thomson-keyed from mostly paper filings; EDGAR electronic filing is the source from 2023. Verified 2026-11-16 (`tr_insiders.form144`, current through `fdate` 2026-11-13); evidence in [Coverage and Date Columns](#coverage-and-date-columns).

## Contents

- [Tables](#tables)
- [Key Fields](#key-fields)
- [Coverage and Date Columns](#coverage-and-date-columns)
- [Grain, Keys & Amendments](#grain-keys--amendments)
- [Code References](#code-references)
- [Query Patterns](#query-patterns)
- [Common Gotchas](#common-gotchas)

## Tables

| Table | Description |
|-------|-------------|
| `tr_insiders.form144` | Thomson Reuters Form 144 proposed-sale notices, 1,215,926 rows, 1,180,205 `dcn`s. Flat: filer, issuer and sale in one row |
| `tfn.form144` | View over the same table (identical row count and date range) |
| `tr_insiders_old.form144` | Archive copy. **`permission denied for schema tr_insiders_old`** for this account; do not plan on it |
| `wrdssec.wrds_forms` / `wrdssec_all.wrds_forms` | EDGAR filing **index only**: form `144` (272,021) and `144/A` (3,525), 1996-2026. No parsed Form 144 table exists in any `wrdssec*` schema |
| `form_metadata.tr_insiders_form144_*` | Five column-group tables (`transactioninformation`, `insiderinformation`, `companyinformation`, `notcleansedasreporteditems`, `additionaltransactionandrecorditems`). Column names and types only; **no code lists or descriptions**. The only descriptions are Postgres column comments on `tr_insiders.form144` |

Sibling tables are in [insider-form4.md](insider-form4.md): `table1` (Form 4 transactions), `header`, `company`. Form 144 is a *notice of intended sale*; Form 4 is the *executed* transaction.

## Key Fields

Column comments are WRDS's; notes are measured.

### Identity and grain
- `dcn` - Document control number = one Form 144 filing. Formats are mixed: 8-digit `30...`/`31...`/`32...` (Thomson-assigned, 2000-2014 secdate), `se000...` (10 chars, 2014-2023), 8-9 digit `yy...` (2023+)
- `seqnum` - Line within the filing. **`(dcn, seqnum)` is unique** (see [Grain](#grain-keys--amendments))
- `amend` - `'A'` on rows from an amended filing (144/A), else NULL
- `cleanse` - Thomson cleanse indicator (see [Code References](#code-references))

### Filer and issuer
- `personid`, `owner` - Filer identity (Thomson `personid`, same ID space as Form 4 `table1`/`header`). Often an entity (trust, fund), not a person
- `rolecode1`-`rolecode4` - Filer relationship to issuer
- `secid`, `ticker`, `cusip6`, `cusip2`, `cusipx`, `cname`, `cnum`, `sector`, `industry` - Issuer, same as `tr_insiders.company`. `cusip6 || cusip2` = 8-digit CUSIP = CRSP `ncusip`
- `broker` - Broker name
- `address1`-`phone` - Filer address

### Proposed sale
- `pshares` - Proposed number of shares. `pshares_ar` - as reported; `pshares_adj` - adjusted (see [as-reported columns](#as-reported-columns))
- `value` - Aggregate market value of the proposed sale. `value_ar` - as reported
- `psaledate` - Proposed sale date. `psaledate_ar` - as reported. 3,539 rows carry the sentinel `1900-01-01`
- `acq_nature` - **Free text** nature of acquisition, 114,811 distinct strings. Not a code

### Dates
- `secdate` - SEC receipt date. **Use this as the filing date**
- `fdate` - File date; Thomson load/processing date, not the SEC filing date before ~2018
- `cdate` - Created date (Thomson record creation)
- `sigdate` - Labelled "SEC Receipt Date" in the column comments but it is not: 1,170,126 NULL and 44,896 `1900-01-01`, only 904 real dates. Ignore
- `maintdate` - Last maintenance date

## Coverage and Date Columns

Year counts of rows by each date column (`select ... group by extract(year from col)` on `tr_insiders.form144`, 2026-11-16; full output in the run report):

| Year | `fdate` | `psaledate` | `secdate` | `cdate` |
|------|--------:|------------:|----------:|--------:|
| < 1996 | 0 | 11 (+3,539 in 1900) | 71 | 0 |
| 1996 | 0 | 23,727 | 25,458 | 152 |
| 1997 | 0 | 50,690 | 51,904 | 187 |
| 2000 | 0 | 95,879 | 103,024 | 103,588 |
| 2001 | 172,067 | 76,491 | 71,714 | 68,728 |
| 2002 | 20,498 | 40,239 | 47,208 | 46,961 |
| 2007 | 47,096 | 53,928 | 53,931 | 54,444 |
| 2008 | 33,821 | 25,471 | 25,646 | 27,884 |
| 2015 | 118,851 | 28,269 | 28,201 | 28,653 |
| 2022 | 17,161 | 15,931 | 16,014 | 16,139 |
| 2023 | 29,593 | 30,375 | 30,360 | 30,391 |
| 2026 (to 11-13) | 34,552 | 30,988 | 30,997 | 30,997 |
| NULL | 792 | 16,086 | 1,244 | 0 |

- **`fdate` is not a filing date for most of the history.** 172,067 rows share `fdate = 2001-12-31` (a single load day). Their `secdate` is 1996-2001 and their `psaledate` 1996-2001. After 2001, `fdate` bulges (2009: 67k, 2015: 119k, 2016: 98k) are backfills: the share of rows with `fdate - secdate > 60` days is 27-82% in 2003-2016 and 36% in 2017, and only falls to 1-13% from 2018. For `secdate` year 2005 the median `fdate - secdate` lag is 475 days.
- **The 792 NULL-`fdate` rows are corrupt, not late.** They are exactly the 792 rows with `cleanse = '2'`, all `dcn = 19980529`-type legacy loads with columns shifted (`owner` holds a number, `ticker` a number, `cname` a 1-digit, `rolecode1` an issuer-ish code, `amend` a letter). Drop `cleanse = '2'`. Their `psaledate` and `secdate` are NULL too.
- **`secdate` and `psaledate` are the reliable columns.** `psaledate` is within 30 days of `secdate` for 91-99.9% of rows in every sampled year (1996: 21,963/24,045; 2000: 91,486/95,767; 2025: 34,191/34,247).
- **Start.** `secdate` by month: 1996-01 to 1996-05 = 9, 16, 2, 1, 72 rows; 1996-06 = 3,647 and ~3,000-4,000 every month after. Use `secdate >= '1996-06-01'`. Annual `secdate` counts are 25-103k through 2007, 16-39k from 2008 (2007 to 2008 halves, 53,931 to 25,646; cause not established).
- **Electronic filing.** Rows with `dcn LIKE 'se%'` run 2014-2023 (6,301 in 2023, 9 in 2024); EDGAR's 144 index (`wrdssec_all.wrds_forms`) has 439 filings in 2022 and 48,702 in 2023, 77,826 in 2024, while this table has 15,904 and 30,151 distinct `dcn`s by `secdate` year (the index is far larger than the table from 2023; why is not established, the jump itself is the point). The SEC's adopting release says only 234 Form 144 filings (0.8%) were filed electronically in CY2021 of about 29,700 filed, the rest paper or emailed PDF, and that mandatory EDGAR filing starts six months after the Federal Register publication of the EDGAR Filer Manual update (SEC Release 33-11070, effective July 11, 2022; the release does not give the calendar date). The data bears this out: pre-2023 volume is Thomson transcription, 2023+ is EDGAR. Do not read the 2022 to 2023 rise (16,014 to 30,360 rows) as a change in selling behavior.

**Recommended filters:** filing-time windows on `secdate`; event time on `psaledate` with `psaledate >= '2001-01-01'` (or `>= '1996-06-01'` for the full history) to drop the `1900-01-01` sentinel; always `cleanse <> '2'`.

## Grain, Keys & Amendments

| Level | Key | Meaning |
|-------|-----|---------|
| **Row primary key** | `(dcn, seqnum)` | Verified unique: 1,214,867 rows (excluding the 792 corrupt rows) = 1,214,867 distinct `(dcn, seqnum)` |
| **Filing** | `dcn` | 1,179,444 filings; 1,157,555 have one row, the rest 2-12+ |
| **Event key (approximate)** | `(personid, cusip6, psaledate, pshares)` across `dcn`s | A 144/A is re-filed under a **new** `dcn` |

- **`seqnum` is a line within one filing, not a sale counter.** `seqnum = 1` is 1,178,961 of the rows. Rows with `seqnum > 1` (35,896 rows, 706 multi-row filings since 2023, all but one single-issuer) mostly leave `acq_nature` NULL (13,306), `pshares` NULL (18,305) and `psaledate` NULL (14,380). Some are extra lots on different `psaledate`s (a 4-row filing with 333,334 / 1,430,000 / 1,075,000 / 20,000 shares on 4 dates), some repeat the same shares and value (4 identical rows of 100,000 / $133,465,000), and in 111 of 706 filings one row equals the sum of the others (12,187 + 12,187 = 24,374). **Do not blindly `SUM(pshares)` across a filing's rows.** What the lines represent on the form is not established from the data; for one-row-per-notice analysis use `seqnum = 1`.
- **Amendments.** `amend = 'A'` marks 13,004 rows on 12,150 `dcn`s (excluding corrupt rows). An amended filing gets a new `dcn` and **every row of that `dcn` is `A`**: 0 `dcn`s mix `A` and NULL. The original `dcn` stays in the table unflagged, so the same notice appears twice. Example: `251033898` (original) and `251036073` (`A`) carry identical 3-line content for filer 16297987 in issuer `124411`; `241012135` (original) and `241020988` (`A`) are the same 50,000-share notice. Across `(personid, cusip6, psaledate, pshares)` since 2023, 592 of 133,364 events appear under more than one `dcn` and 565 of those involve an `A`.
- **Supersession.** As in Form 4: keep the latest filing per event key, across filings only.

```sql
-- amendments: drop the original when an A with the same event exists (since 2023 sample)
SELECT * FROM (
  SELECT f.*, ROW_NUMBER() OVER (PARTITION BY personid, cusip6, psaledate, pshares, seqnum
                                 ORDER BY secdate DESC, (amend = 'A') DESC, dcn DESC) rn
  FROM tr_insiders.form144 f WHERE cleanse <> '2' AND psaledate >= DATE '2001-01-01') t
WHERE rn = 1;
```

Profiling probes before any sum: `(dcn, seqnum)` duplicates must be 0; `count(distinct dcn)` per event key above 1 is the double-count.

### As-reported columns

The `*_ar` columns hold the value as Thomson received it; the unsuffixed columns are cleansed.

| Comparison | Rows differing | Of rows with both non-null |
|------------|---------------:|----------------------------|
| `pshares <> pshares_ar` | 1,919 | 1,189,195 |
| `value <> value_ar` | 63,416 | 1,167,208 |
| `psaledate <> psaledate_ar` | 7,810 | 1,189,041 |
| `pshares <> pshares_adj` | 269,326 | 1,199,859 |

- `pshares` is almost always the as-reported number; Thomson changes `value` far more often (63k), by `cleanse` class below. Examples of a cleansing fix: `pshares` 33,333.34 vs `pshares_ar` 3,333,334 with `value` 27,866,678.91 vs `value_ar` 266,666 (`cleanse = 'L'`).
- `pshares_adj` differs from `pshares` in 22% of rows and tracks split adjustment: 80,000 → 5,714.2857 (2003), 574 → 1,148 (1997). Treat it as the split-adjusted share count; this is inferred from samples, not documented. Use it only for cross-time share comparisons.
- `value / pshares` (2023+, positive rows): 1st / 50th / 99th percentile = 0.56 / 45.50 / 861.94, so `value` is dollars.

## Code References

### Role codes (`rolecode1`-`rolecode4`)

The database holds no code dictionary for Form 144 (see [Tables](#tables)). Codes shared with Form 4 (`CEO`, `CFO`, `GC`, `P`, `EVP`, `SVP`, `D`, `CB`, `VC`, `OD`, `DO`, `O`, `OE`, `OS`, `C`, `F`, `FO`, `S`, `B`, `H`, `CT`, `CO`, `CI`) keep the meanings in [insider-form4.md](insider-form4.md#rolecode-reference). Form 144-specific and commonest `rolecode1` values (rows): `UT` 294,908; `O` 243,930; `AF` 152,598; `D` 122,308; `SH` 81,420; `T` 63,801; `VP` 25,036; `OX` 16,460; `DS` 4,212. Meanings **inferred from the owner names on sampled rows, not documented**:

| Code | Reading | Evidence |
|------|---------|----------|
| `T` | Trust | owners like "KHAKAL TRUST", "...TR OF 2006" |
| `SH` | Shareholder entity | funds and foundations ("ORBIMED GENESIS MASTER FUND", "ROB WALTON FOUNDATION") |
| `AF` | Affiliate | mix of entities and individuals ("DIGITAL CURRENCY GROUP INC") |
| `VP` | Vice President | individuals, `VP` only appears on officers |
| `UT`, `OX`, `DS`, `R`, `MD`, `OT`, `MC`, `GP`, `CP`, `IA`, `GM` | Unknown | individuals and entities with no pattern; `GP` general partner, `IA` investment adviser, `MD` managing director are plausible but unverified |

Other values: 9,843 NULL (clean rows: all `secdate` 1993-1999), plus a long tail of three-letter strings (`HUM`, `NOR`, `MAC`, ...) that look like truncated company names, not roles; their source is not established. `rolecode2`-`4` are populated in about 1% of rows (`rolecode2` ~16,000 rows: `P`, `EVP`, `SVP`, `CB`, `D`, `O` lead); read all four when filtering for officers, as in Form 4.

### `acq_nature` - free text, not a code

114,811 distinct strings (30,653 NULL). Top by rows: `EXERCISE OF OPTIONS (THROUGH AN ACQUISITION)` 230,226; `GRANT OR AWARD` 119,747; `PURCHASE` 62,974; `PRIVATE PURCHASE` 58,683; `RESTRICTED STOCK VESTING` 39,485; `PRIVATE PLACEMENT` 32,291; `ACQUIRED THROUGH A PLAN` 26,911; `ACQUIRED BY GIFT` 19,262; `ACQ OF TENDER SHARES IN A MERGER OR A TAKE OVER` 18,964; `RESTRICTED STOCK` 18,171; `RESTRICTED STOCK UNITS` 14,322; `GIFT` 13,483; `NON-TRANSACTION, TRANSFER OR CONVERSION` 11,459; `COMPENSATION` 10,066; `FOUNDERS SHARES` 10,036. Many are spelling variants of the same thing (`RSU`, `RSU VESTING`, `RESTRICTED STOCK UNIT VESTING`). The leading phrases look like Thomson standardized values and the long tail is filer-typed text. Only 37 values are 1-2 characters (`S8` 58, `M` 43, `PP` 40, `NQ` 33) and they are filer shorthand, not a code list. Bucket with `ILIKE` patterns (`%OPTION%`, `%RESTRICTED%|%RSU%`, `%GIFT%`, `%FOUNDER%`), never an `IN` list, and bucket NULL separately.

### `cleanse`

`R` 991,275 (81.6% of clean rows); `I` 135,687; `S` 31,376; `A` 24,307; `H` 22,260; `L` 9,890; `N` 72; `2` 792 (corrupt, see above). Thomson publishes no definition in the database. Behavior by class: `R` has `pshares_ar`, `value_ar` and `psaledate_ar` on essentially all rows and `value` ≈ `value_ar` (4 differences), so `R` is as-reported/unchanged; `H` and `I` have `value` differing from `value_ar` in 6,754 and 54,638 rows, i.e. cleansed values; `L` has `pshares` differing from `pshares_ar` in 1,698 of 9,483 rows (share corrections); `A` has 19,302 NULL `pshares` and 19,370 NULL `value` and `_ar` values on only 462 rows, i.e. mostly unparsed; `N` has no `pshares_ar`. Read `R` as raw, `H`/`I`/`L`/`S` as touched by Thomson, `A` as incomplete. These are inferences from the data pattern. Do not filter on `cleanse` except to drop `'2'`.

### `amend`

`'A'` only (13,004 rows clean). The other letters seen in `amend` (`B`-`V`) are on the 792 corrupt `cleanse = '2'` rows and are not amendment flags.

## Query Patterns

### Form 144 proposed sales matched to the same insider's Form 4 sales

Tested 2026-11-16 on one issuer (`cusip6 = '<cusip6>'`). Join on `personid` and `cusip6`, window on `trandate` after `psaledate`. Form 4 originals only (`amend IS NULL`).

```sql
WITH f144 AS (
    SELECT dcn, seqnum, personid, owner, cusip6, secdate, psaledate, pshares, value
    FROM tr_insiders.form144
    WHERE cusip6 = '<cusip6>'
      AND cleanse <> '2'                 -- 792 column-shifted legacy rows
      AND seqnum = 1                     -- one line per filing
      AND psaledate >= DATE '2001-01-01' -- drops the 1900-01-01 sentinel
), f4 AS (
    SELECT personid, trandate, dcn AS dcn4, seqnum AS seq4, shares, tprice
    FROM tr_insiders.table1
    WHERE cusip6 = '<cusip6>'
      AND trancode = 'S'
      AND amend IS NULL                  -- a 4/A re-reports the same trade
      AND shares > 0
)
SELECT a.dcn, a.owner, a.psaledate, a.pshares AS proposed_shares,
       COUNT(b.dcn4)   AS n_f4_sales_90d,
       SUM(b.shares)   AS f4_shares_sold_90d,
       MIN(b.trandate) AS first_f4_trandate
FROM f144 a
LEFT JOIN f4 b
  ON b.personid = a.personid
 AND b.trandate BETWEEN a.psaledate AND a.psaledate + 90
GROUP BY a.dcn, a.seqnum, a.owner, a.psaledate, a.pshares
ORDER BY a.psaledate DESC
LIMIT 10;
```

Output: one row per notice with the proposed shares, the number of the same insider's Form 4 sales within 90 days, and the shares they sold. Two overlapping notices from one insider both count the same Form 4 sale.

Join-key notes:
- `personid` is the same Thomson ID as `table1`/`header` (many Form 144 filers never appear as Form 4 sellers, e.g. entities that did not sell on Form 4 in the window). Scope with `cusip6` first: a global `personid` join against `header` did not return within 5 minutes.
- Issuer keys are identical across `form144`, `table1` and `company`: `cusip6`, `cusip2`, `secid`, `ticker`. Link to CRSP with `cusip6 || cusip2 = crsp.stocknames.ncusip` over `namedt`-`nameenddt`.
- A Form 4 window that overlaps another notice from the same insider counts the same Form 4 sale under both notices. De-duplicate on `(dcn4, seq4)` before summing across notices.
- To collect a controlling holder's notices, filter by issuer (`cusip6`) and match `owner` to the holder's entities; do not use `owner ILIKE '%<surname>%'` (see gotcha 14).

### Proposed sales by year of SEC receipt

```sql
SELECT EXTRACT(year FROM secdate)::int AS yr, COUNT(DISTINCT dcn) AS filings
FROM tr_insiders.form144
WHERE cleanse <> '2' AND secdate >= DATE '1996-06-01'
GROUP BY 1 ORDER BY 1;
```

## Common Gotchas

1. **Proposed, not executed.** A Form 144 is a notice of intended sale; the sale may not happen, may happen on a different date at a different size, or may be split. Counts and `value` are **intent**. Executed sales are Form 4 `trancode = 'S'` ([insider-form4.md](insider-form4.md)); Rule 144 notices cover affiliates and holders of restricted stock, so many filers never file a Form 4.
2. **`fdate` is not the filing date.** Filter on `secdate`. `WHERE fdate >= '2002-01-01'` silently misdates the 2001-12-31 load (172,067 rows) and the 2005-2016 backfills.
3. **Drop `cleanse = '2'`** (792 corrupt column-shifted rows; they are also the 792 NULL-`fdate` rows).
4. **`psaledate = '1900-01-01'`** is a sentinel on 3,539 rows (3,399 of them clean rows); another 16,086 rows have NULL `psaledate`. Filter `psaledate >= '2001-01-01'` (or `'1996-06-01'`) and keep the NULLs separate.
5. **Amendments double-count**: `amend = 'A'` on a new `dcn`, original left in place. See [Grain](#grain-keys--amendments).
6. **`seqnum > 1` rows are not sales** in a simple sense; they are mostly sparse (NULL `pshares`/`psaledate`) or repeats. Use `seqnum = 1` for one row per notice.
7. **Coverage is not constant.** 1996-2022 is Thomson-keyed paper/PDF filings; 2023+ is EDGAR electronic (the SEC release counts 234 electronic filings in 2021 against ~29,700 total). The 2022 to 2023 rise and the 2007 to 2008 halving are not trading effects. Do not difference a count across those years without a note.
8. **`pshares_adj` is not `pshares`**: it differs in 22% of rows (split adjustment). Pick one and say which.
9. **`acq_nature` is free text** (114,811 distinct); never `IN (...)`.
10. **`sigdate` is not the SEC receipt date** despite its column comment. Use `secdate`.
11. **`tr_insiders_old` is permission-denied; `wrdssec` has only the filing index.** For a Form 144 without a Thomson row, the EDGAR filing is the only source and `wrdssec_all.wrds_forms` gives only the filing record (form `144`, `144/A`, filing date), not the sale terms.
12. **Entities file too.** `owner` is frequently a trust or fund; Thomson `personid` identifies the filer, not necessarily a human officer.
13. **Table size.** 1.2M rows, small enough to pull whole, but joins against `tr_insiders.header` by `personid` alone are slow; scope by `cusip6` or `secdate` first.
14. **Controllers file under their entities.** To find a controlling holder's Form 144s, search by issuer (`cusip6`) and match filer names to the holder's entities, not `owner ILIKE '%<surname>%'`. A controller's early notices are often filed by its holding entities rather than in its own name, and sales in a registered offering need no Form 144 (match them to the 424B prospectus instead).
15. **`acq_nature` keeps one label per notice** even when the form's Table I lists several acquisitions. An EDGAR Form 144 can list several acquisition lines (public offering, registered direct offering, open-market purchase, unit conversion) while Thomson codes the notice "NON-TRANSACTION, TRANSFER OR CONVERSION". For acquisition detail on 2023+ notices, parse the EDGAR `primary_doc.xml` (`natureOfAcquisitionTransaction`, `acquiredDate`, `amountOfSecuritiesAcquired`, plus `remarks`, `planAdoptionDate` for 10b5-1 plans, and `securitiesSoldInPast3Months`). The EDGAR XML has no "control securities" field; relationship is free text such as "10% Shareholder".
16. **Validated against Washington Service (2026-11-16).** Replicating Figure 3 of the March 9, 2023 Rule 144 modernization petition (Form 144 filings by days since IPO, SDC IPOs 2016-2020), Thomson dated by `psaledate` (fallback `fdate`) matched the Washington Service figure with bin-count correlation r = 0.999 (ticker merge) / 0.998 (CUSIP6 merge): 438 vs 466 filings (94%; CUSIP6 84%), shortfall concentrated in 2016-17; day-180 lockup bin 133 vs 151. Record-level matching on (ticker, filing date +-3 days, shares) found only 8.8% because `fdate` is a load date. Use `psaledate`/`secdate` for event time.
