# LinkUp — job postings & labor-market activity

Provider page: `app.deweydata.io/data/providers/linkup` · Vendor: `linkup.com` ·
**Included in the UVA/NYU Platform Subscription** — all tables downloadable (`DL`).

Job postings scraped **directly from employer career sites**, not from job boards or aggregators.
That is the whole selling point: no duplicate repostings, no expired listings left standing, and a
live source URL per posting. Coverage since **2007-08**, 195 countries, ~86k companies.

## Datasets and tables

LinkUp on Dewey is **two products**, and the platform nests tables under each — a structure the
older `catalog.csv` sweep does not reflect (it lists the tables flat, as if they were separate
datasets). Verified live 2026-08-21; **Job Records last refreshed Aug 06, 2026**.

### `job-records` — 7 tables, all keyed on `JOB_HASH`

| Table (slug) | What it adds |
|---|---|
| **Job Records** (`job-records`) — PRIMARY | one row per posting-location; 342.0M rows, 15 cols |
| **Extracted Salary** (`extracted-salary`) | parsed compensation, normalized to annual USD |
| **Job Descriptions** (`job-descriptions`) | **full description text**, 100% populated |
| **Structured Fields** (`structured-fields`) | 21 employer-provided fields (reqid, education, shift, …) |
| **Remote Tag** (`remote-tag`) | remote/hybrid classification, point-in-time |
| **Full Time / Part Time** (`full-time-part-time`) | FT/PT classification, point-in-time |
| **ONET Taxonomy** (`onet-taxonomy`) | posting → ONET occupation code |

### Company/ticker aggregates and reference (separate datasets)

| Table (slug) | Grain | Coverage | Rows | Cols |
|---|---|---|---|---|
| **Company Analytics** (`Company-Analytics`) | company × day | 2007-08-03 → 2026-05-11 | 123.3M | 7 |
| **Ticker Analytics** (`ticker-analytics`) | ticker × day | 2007-08-03 → 2026-05-11 | 25.6M | 6 |
| **PIT Company Reference** (`pit-company-reference`) | company × validity interval | snapshot | 277K | 8 |
| **Company and Ticker Reference** (`company-and-ticker-reference`) | company × ticker × interval | snapshot | 201K | 7 |
| **Company Scrape Log** (`company-scrape-log`) | company × date | snapshot | 65.5M | 3 |

Note the capital `C` in the `Company-Analytics` slug — the others are lowercase-hyphenated.

## Join keys

- `COMPANY_ID` (int) — "unique identifier for a **company-scrape**", the hub key. Joins Job
  Records → Company/PIT reference → Scrape Log → Company Analytics.
- `JOB_HASH` (str) — posting-level key; joins Job Records → ONET Taxonomy.
- `BASE_HASH` (str) — identifier for the posting on the employer site. **One `BASE_HASH` maps to
  many `JOB_HASH` because LinkUp splits a posting into one row per location listed on it.** So
  `JOB_HASH` counts *posting-locations*, not openings — a national role listed in 40 cities is 40
  rows. Collapse on `BASE_HASH` for opening counts; keep `JOB_HASH` for geographic work. (Across
  several career portals, `REQID` in Structured Fields is the better key — see below.)
- `STOCK_TICKER` — only in Ticker Analytics; several `COMPANY_ID`s roll up to one ticker.

## Job Records (15 cols)

`JOB_HASH`, `TITLE`, `COMPANY_ID`, `COMPANY_NAME`, `CITY`, `STATE`, `ZIP`, `COUNTRY`,
`CREATED`, `LAST_CHECKED`, `LAST_UPDATED`, `DELETE_DATE`, `UNMAPPED_LOCATION`, `URL`, `BASE_HASH`.

The four timestamps are the dataset's real content and each means something different:
`CREATED` (100%) = first observed; `LAST_CHECKED` (100%) = scraped and posting still present;
`LAST_UPDATED` (**11%**) = scraped and the posting had *changed*; `DELETE_DATE` (**98%**) =
scraped and posting **not found**. A vacancy's duration is `DELETE_DATE − CREATED`; the 2% with a
null `DELETE_DATE` are still open, not missing.

Location is **not** fully populated: `CITY` 90%, `STATE` 88%, `ZIP` 79%, `COUNTRY` 93%. On top of
that, `UNMAPPED_LOCATION = True` flags a posting whose location could not be resolved. Filter on
both — the flag alone does not catch a row that simply has no `ZIP`.

## Enrichment tables (verified schemas)

**Extracted Salary** — `JOB_HASH` (100%), `EXTRACTED_VALUE_LOW` (100%), `EXTRACTED_VALUE_HIGH`
(65%), `FREQUENCY` (80%), `NORMALIZED_FREQUENCY` (100%), `CURRENCY` (97%), `NORMALIZED_CURRENCY`
(100%), `NORMALIZED_ANNUAL_LOW`/`_HIGH` (100% / 65%), `NORMALIZED_ANNUAL_LOW_USD`/`_HIGH_USD`
(100% / 65%), `DATE_TIME` (100%, **2013-05-13 → 2026-08-04**).

> **Three traps.** (1) `*_HIGH` is only **65%** populated — a third of postings quote a point
> value, not a range, so `AVG((low+high)/2)` silently drops them; coalesce to `LOW`.
> (2) The normalized annual fields are **bounded at exactly 12,000 and 1,000,000** — that is
> top- and bottom-coding, not a natural range, and it will flatten the tails of any pay-dispersion
> estimate. Raw `EXTRACTED_VALUE_*` runs from 5 (hourly rates) to 1,000,000.
> (3) Dewey's June newsletter advertises coverage "back to January 2019"; the dictionary says
> **2013-05-13**. Verify on your own sample before quoting either.

**Job Descriptions** — `JOB_HASH`, `DESCRIPTION` (**100%**, full scraped text), `COMPANY_ID`,
`COMPANY_NAME`. This is the table that makes skill extraction and text-based work possible.

**Structured Fields** — 21 columns of employer-supplied detail, all `TEXT`, most at 74–79% fill:
`REQID` (99%), `CATEGORY` (98%), `SUBCATEGORY` (92%), `POSTED_DATE` (98%), `TIME_TYPE` (79%),
`SITE_ID` (77%), `ADDRESS`/`DIVISION`/`WORK_LOCATION`/`CLOSE_DATE` (76%), `COMPENSATION` (75%),
`EDUCATION_REQUIREMENTS`/`EMPLOYMENT_TYPE`/`EXPERIENCE_REQUIRED`/`SHIFT` (75%),
`CERTIFICATIONS`/`COMMISSION_ELIGIBLE`/`CONTRACT_LENGTH`/`SIGNING_BONUS`/`TRAVEL_REQUIREMENTS`/
`VACANCY_COUNT` (74%). **`REQID` is the employer's own requisition id** — the documented way to
track one opening across multiple career portals, and a better dedupe key than `BASE_HASH` when
a firm posts to several sites. `POSTED_DATE`/`CLOSE_DATE` are the *employer's claimed* dates and
are typed `TEXT`; LinkUp's own observed `CREATED`/`DELETE_DATE` live in the primary table and the
two will disagree.

**Remote Tag** — `REMOTE_STATUS` (100%, BOOLEAN), `REMOTE_DETAIL` (**7%** — hybrid-vs-remote split
is mostly unavailable), `START_DATE` (100%), `END_DATE` (3%). Keyword-based classification over
title/description/structured fields, and `FALSE` conflates "explicitly on-site" with "says
nothing" — that is a meaningful limitation for a WFH study, not a rounding error.

**Full Time / Part Time** — `FULLTIME_PARTTIME` (100%: `fulltime` / `parttime` /
`fulltime_parttime`), `START_DATE` (100%), `END_DATE` (<1%).

> Remote Tag and FT/PT are **interval tables** (`START_DATE`/`END_DATE`) because a posting's
> classification can change. With `END_DATE` at 3% and <1%, nearly every row is the current one —
> so a plain join is *usually* right and *silently wrong* for the minority that changed. Filter on
> `END_DATE IS NULL` for a current-state join, or do a real as-of join for a historical one.

**Correction to earlier guidance:** an earlier version of this file said the Dewey distribution
carried no salary, skills, or description text. That was read off the stale `catalog.csv` sweep
and is **wrong** — salary landed in the June 2026 release and Job Descriptions/Structured Fields
were already there. Re-check the live table switcher rather than the CSV.

## Point-in-time joins — the trap that matters for finance work

`PIT Company Reference` and `Company and Ticker Reference` are **interval tables**
(`START_DATE`/`END_DATE` per row), not lookups. Company names, URLs, and ticker mappings change,
and `Company and Ticker Reference` additionally carries `PRIMARY_FLAG` plus multiple exchanges per
company.

A naive `COMPANY_ID → ticker` equi-join therefore does two bad things at once: it **fans out**
(one company × several exchange listings and several validity intervals) and it **leaks
look-ahead** (attaching today's ticker to a 2011 posting for a firm that has since been renamed or
acquired). Always constrain the join to the posting's own date:

```sql
JOIN ctr ON j.COMPANY_ID = ctr.COMPANY_ID
        AND j.CREATED >= ctr.START_DATE
        AND (ctr.END_DATE IS NULL OR j.CREATED < ctr.END_DATE)
        AND ctr.PRIMARY_FLAG                      -- else one row per exchange listing
```

`PIT Company Reference` also carries **`LEI`**, **`OPEN_PERM_ID`**, and **`NAICS_CODE`** — those
are the bridges out to other datasets (and to `fuzzy-name-matching` when no identifier is shared).

## Company Scrape Log — read this before any time-series claim

One row per company per day the scrape ran or changed, with `SCRAPE_CHANGED` true when LinkUp
**modified the scraper code** for that employer. A scraper change is a structural break in that
company's posting counts: a jump in `CREATED_JOB_COUNT` around a `SCRAPE_CHANGED` date is a
measurement artifact, not hiring. Any panel built on Company/Ticker Analytics should either
control for these dates or drop the affected windows. This is the single most under-used table in
the set and the easiest way to publish a spurious result from it.

## Analytics tables (pre-aggregated — prefer these over rolling your own)

Company Analytics (`DAY`, `COMPANY_ID`, `COMPANY_NAME`) and Ticker Analytics (`DAY`,
`STOCK_TICKER`) both carry `CREATED_JOB_COUNT`, `DELETED_JOB_COUNT`, `UNIQUE_ACTIVE_JOB_COUNT`,
and `ACTIVE_DURATION` (mean days-open across jobs active that day). At 123M / 25.6M rows these are
far cheaper than aggregating 342M postings yourself, and they are time-partitioned so
`partition_key_after/before` works — unlike the snapshot reference tables.

## Worked pattern — a clean firm-quarter vacancy panel

The three traps above (interval join, scraper breaks, `BASE_HASH` inflation) all have to be handled
in the same query or the panel is wrong. Sketch:

```sql
-- 1. postings, collapsed to distinct requisitions, location-resolved
WITH postings AS (
  SELECT COMPANY_ID, BASE_HASH,
         MIN(CREATED)     AS opened,
         MAX(DELETE_DATE) AS closed          -- NULL = still open
  FROM job_records
  WHERE NOT UNMAPPED_LOCATION AND COUNTRY = 'US'
  GROUP BY COMPANY_ID, BASE_HASH             -- collapse JOB_HASH duplicates
),
-- 2. windows contaminated by a scraper-code change
breaks AS (
  SELECT COMPANY_ID, DATE AS break_date
  FROM company_scrape_log WHERE SCRAPE_CHANGED
),
-- 3. point-in-time ticker, primary listing only
tick AS (
  SELECT p.*, ctr.TICKER_SYMBOL
  FROM postings p
  JOIN company_and_ticker_reference ctr
    ON  p.COMPANY_ID = ctr.COMPANY_ID
    AND p.opened >= ctr.START_DATE
    AND (ctr.END_DATE IS NULL OR p.opened < ctr.END_DATE)
    AND ctr.PRIMARY_FLAG
)
SELECT TICKER_SYMBOL, date_trunc('quarter', opened) AS q,
       count(*)                                   AS postings,
       avg(date_diff('day', opened, closed))      AS mean_days_open
FROM tick t
WHERE NOT EXISTS (                                  -- drop ±30d around a scraper change
  SELECT 1 FROM breaks b
  WHERE b.COMPANY_ID = t.COMPANY_ID
    AND abs(date_diff('day', b.break_date, t.opened)) <= 30)
GROUP BY 1, 2;
```

`mean_days_open` silently drops still-open postings (null `closed`) — that is right-censoring, so
either say so or model it. And if you only need counts, **Company/Ticker Analytics already
computes `CREATED_JOB_COUNT` / `UNIQUE_ACTIVE_JOB_COUNT` / `ACTIVE_DURATION`** at 123M/25.6M rows
instead of 342M; reach for the raw postings only when you need the title, location, or URL.

## Occupation coding

`ONET Taxonomy` maps `JOB_HASH → ONET_OCCUPATION_CODE` (ONET 2019, 1,000+ US occupations, applied
across the global dataset). It is 342.6M rows — one per posting — so it is a join partner, not a
lookup table; project to the hashes you need before pulling.
