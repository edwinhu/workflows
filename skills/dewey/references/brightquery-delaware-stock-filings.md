# BrightQuery — Delaware Stock Filings

Dataset page: `app.deweydata.io/data/BrightQuery/<dataset>?datasetSlug=<table>` (UVA account 17881).
Page facts measured 2026-10-08 over CDP; the banner reads "Dewey Subscription: You have access to
this dataset through your Dewey subscription". Data facts below were measured the same day by pulling
and profiling four tables with DuckDB (denominators in the tables; sections are for stock-time-series
`sts`, stock-group `sg`, stock-event-timeline `sev`, legal-entity `le`).

## Scope

- **Refresh:** monthly, on the 11th (page text; not re-measured).
- **9 tables.** Counting against a project's limit, they are ONE dataset (see `access-options.md`).
- **Not only private firms.** `le` carries listed names (Apple, Alphabet, Abbott with a `BQ_TICKER`). `le` jurisdiction: US_DE 1,248,453 of 1,386,531 rows, the rest other states (US_CA 27,580, US_TX 16,831, ...). `sts` is 100% `BQ_US_DE_*` ids (422,987 rows).
- **Not contemporaneous.** `sts.BQ_DATE_TIME_RECEIVED` spans only 2022-11-01 to 2024-03-18; earlier years are a backfill from recent filings.

## Tables

Rows and columns equal the page meta for all four pulled tables. The other five were not pulled.

| Table | Rows | Cols | On disk | Columns (short) |
|---|---:|---:|---|---|
| Legal Entity (**PRIMARY**) | 1,386,531 | 75 | 253M, 32 parquet | all `BQ_*`: name, address, parent/child ids, EIN, status, ownership indicators, `BQ_TICKER`, `BQ_WEBSITE`; key `BQ_LEGAL_ENTITY_ID` (0 duplicates) |
| Stock Time Series | 422,987 | 7 | 18M, 6 csv.gz | `BQ_COMPANY_NAME`, `BQ_COMPANY_NUMBER`, `BQ_DATE_TIME_RECEIVED`, `BQ_ID`, `BQ_STOCK_CLASS_SERIES_ID`, `_MEMBER_IDS`, `_NAME` |
| Stock Group | 1,137,654 | 12 | 43M, 16 csv.gz | name, number, received, id, `BQ_STOCK_GROUP_` `AUTHORIZED_SHARES` / `BEGIN_DATE` / `END_DATE` / `ID` / `ISSUED_SHARES` / `MEMBER_IDS` / `TOTAL_ASSETS`, `BQ_TAX_YEAR` |
| Stock Event Timeline | 1,963,609 | 7 | 54M, 16 csv.gz | name, number, `BQ_EVENT_SUMMARY_` `DATE` / `DESCRIPTION` / `ID`, `BQ_ID`, `BQ_TICKER` |
| Stock Class | | | | Get Sample works; **Get Data is disabled** |
| Corporate Status, Stock Group - Most Recent, Stock Time Series - Daily / - Most Recent | | | | not pulled |

Blank cells were not recorded. `catalog.md` lists these tables as separate BrightQuery rows with older sizes.

**Join:** `BQ_COMPANY_NUMBER` (`sts`, `sg`, `sev`) = `le.BQ_LEGAL_ENTITY_ID`. All 342,962 entities in `sts`, and the same 342,962 in `sg`, match (100.00%).

## Years

`sts` has no year column. Year = the 4-digit token in each `BQ_STOCK_CLASS_SERIES_MEMBER_IDS` element (1,478,615 of 1,478,615 parsed, 1990-2024). `sg.BQ_TAX_YEAR` (1990-2024) equals that token for 1,478,615 of 1,478,615 elements. The year convention was inferred from the id strings, not from BrightQuery documentation.

Coverage is **1990-2024, not "tax years 2019-2023"**; 2019-2023 holds the bulk. Entities per year (identical in `sts` and `sg`):

| Years | Entities / year |
|---|---|
| 1990-2009 | 15 to 93 |
| 2010 / 2013 / 2018 | 5,150 / 7,852 / 13,089 |
| 2019 / 2020 / 2021 | 116,325 / 126,401 / 136,183 |
| 2022 / 2023 | 310,063 / 258,627 |
| 2024 | 1 |

## Stock class names and votes

- `sts.BQ_STOCK_CLASS_SERIES_NAME`: 32 distinct values, generic placeholders: `COMMON` 342,817 (81.05%), `PREFERRED` 66,431 (15.71%), `NEW1 COMMON` 9,062, `NEW1 PREFERRED` 2,605, then `NEWk COMMON` (k to 9) and `NEWk PREFERRED` (k to 21) in small counts (denominator 422,987 rows).
- No name contains CLASS A/B, VOTING, NON-VOTING or SUPER (0 of 422,987). `sg` has no class-name column.
- **No voting field anywhere:** no column with `VOT` in its name in any of the four tables. `sg` has share counts at group level only (authorized non-null 1,137,200 of 1,137,654; issued and assets 252,980).

## Multi-class proxies

| Definition (entity-years, all years) | Entities with ≥1 such year | Entity-years | 2019-2023 entity-years |
|---|---:|---:|---|
| `sts`, ≥2 distinct class series | 63,339 of 342,962 | 244,631 of 1,030,020 | 28,520 + 31,736 + 34,812 + 49,812 + 46,927 |
| `sts`, ≥2 distinct **COMMON**-type series | 10,451 | 28,290 | 3,521 + 3,832 + 4,263 + 7,668 + 6,036 |
| `sg`, ≥2 distinct member ids | 72,317 | 256,947 | 29,924 + 33,244 + 36,710 + 53,310 + 49,247 |
| `sg`, ≥2 distinct group ids | 44,405 | 87,017 | 9,918 + 10,415 + 13,294 + 16,257 + 11,834 |

The ≥2-series rows are dominated by COMMON + PREFERRED (210,803 of 244,631 entity-years): they measure preferred issuance. The COMMON-type row is the closest dual-class proxy. Sanity check: Alphabet (`BQ_US_DE_5786925`) and Meta (`BQ_US_DE_3835815`) show COMMON, NEW1 COMMON and PREFERRED in every year 2019-2023 (caught); Snap (`BQ_US_DE_5159776`) shows only COMMON and PREFERRED (**missed**). Counts for 2022-2023 are inflated by entity growth.

## Identifiers

| Field | Fill (denominator) |
|---|---|
| CIK, CUSIP, ISIN, LEI, PERMNO, GVKEY | no column exists (not a zero fill) |
| `le.BQ_TICKER` | 4,784 of 1,386,531 = 0.345%; 3,498 distinct; duplicate rows share tickers; some tickers sit on non-Delaware entities with no stock rows (e.g. GOOGL on `BQ_US_CA_3831672`) |
| `sev.BQ_TICKER` | 40,587 of 1,963,609 rows |
| `le.BQ_LEGAL_ENTITY_EIN` | 380,369 of 1,386,531 = 27.43%; lengths 9 digits 380,010, 8 digits 354, 7 digits 3, 6 digits 2, so leading zeros dropped in about 359 rows (zero-pad before matching) |
| Among the 342,962 stock-table entities | ticker 2,462 (0.72%), EIN 96,648 (28.18%) |
| Among the 10,451 multi-COMMON entities | ticker 331 (3.17%), EIN 5,300 (50.71%) |

A CRSP/Compustat link would go through current ticker (not point-in-time) or EIN (27%); a name match was not attempted.

## Verdict

- **Cannot rebuild a JKL16 1994-2011 dual-class list.** 1994-2009 has 15-93 entities a year, mostly unlisted; 2010-2011 has 5,150 and 6,077 entities but from filings received 2022-2024; there is no vote structure and no CIK/CUSIP.
- **Modern 2019-2023 flag: candidate list only.** "≥2 COMMON-type series in a tax year" gives 3,521 to 7,668 entity-years a year; 292 entities carry a ticker. It cannot say which class votes. Confirm against a vote-bearing source (charters, proxy statements, ISS/FactSet governance) before using it as a flag.
- Not done in the profile: other five tables, any CRSP/Compustat link, check against the actual JKL16 list, hand-verification against charters.

## The Data Request Form is not a block

On Continue (primary table) or Save (supplementary table), a modal "Data Request Form: This dataset requires an institutional Dewey license..." (Email, Reason, Submit) opens **at the same time as** the download dialog. The table **is** added to the project anyway; the project's dataset list confirms it. An earlier session wrongly concluded the dataset was license-gated from this form.

- Cancel the form. Never submit it without the user's OK.
- Verify access in the project's dataset list, not from the modal.
- Add-to-project flow and project limits: `access-options.md`.
