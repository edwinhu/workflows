# Capital IQ on WRDS

S&P Capital IQ. The subscription is split across schemas, and — critically — across WRDS
**accounts**. Verified 2026-08-09 against `eddyhu` (NYU) and `edwin_hu` (UVA).

## Contents

- [The Account Split](#the-account-split)
- [Schema Access Matrix](#schema-access-matrix)
- [`ciq_pplintel.wrds_professional` — the board/professional panel](#ciq_pplintelwrds_professional--the-boardprofessional-panel)
- [`ciq_common.ciqcompanyrel` — company-to-company relationships](#ciq_commonciqcompanyrel--company-to-company-relationships)
- [Headline: sponsor-affiliated directors, keyed](#headline-sponsor-affiliated-directors-keyed)
- [Identifier crosswalks](#identifier-crosswalks)
- [Limitations](#limitations)

## The Account Split

**The two best board sources cannot share one connection.** Capital IQ People Intelligence and
BoardEx North America are on opposite accounts, and the WRDS-built link between them is on neither.

| Schema | `eddyhu` | `edwin_hu` |
|---|---|---|
| `ciq_pplintel` | **readable** | `permission denied for schema ciq_pplintel` |
| `boardex_na` | `permission denied for schema boardex_na` | **readable** (1,253,484 companies) |
| `ciq_common` | readable | readable |
| `ciq_transactions` | `permission denied` | `permission denied` |
| `wrdsapps_plink_boardex_ciq` | `permission denied` | `permission denied` |

`ciq.*` is a view schema over the licensed schemas — `ciq.wrds_professional` returns the same
20,922,958 rows for `eddyhu` and is denied for `edwin_hu`. `USAGE` on `ciq` is granted to both
accounts, so `has_schema_privilege(..., 'ciq', 'USAGE')` is **not** a test of access. Test with a
real `SELECT`.

### Per-account connections, one process

Do not route both accounts through a singleton client — WRDS connection wrappers commonly return
whichever connection opened first regardless of the username requested, silently reading the wrong
account. Open psycopg2 directly, per user:

```python
import os, psycopg2, pandas as pd

def _conn(user: str):
    pw = next(ln.split(":")[4].strip() for ln in open(os.path.expanduser("~/.pgpass"))
              if ln.split(":")[3] == user)
    return psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737, dbname="wrds",
                            user=user, password=pw, sslmode="require", connect_timeout=60)

def _q(user: str, sql: str) -> pd.DataFrame:
    c = _conn(user)
    try:
        return pd.read_sql(sql, c)
    finally:
        c.close()
```

Verify with `select current_user` before concluding an account lacks a subscription.

Because `wrdsapps_plink_boardex_ciq` is denied on both, any CIQ↔BoardEx person link must be built
by name/company matching in pandas across two connections. Budget for that; there is no key.

## Schema Access Matrix

All `ciq*` schemas, `has_schema_privilege(..., 'USAGE')`. `_old` = prior vintage snapshot,
`ciqsamp*` = WRDS free sample (tiny; granted to everyone — do not mistake it for the real data).

| Schema | `eddyhu` | `edwin_hu` | Content |
|---|---|---|---|
| `ciq` | ✓ (views) | ✓ (views, underlying denied) | Views over licensed schemas |
| `ciq_common` | ✓ | ✓ | Company master, company relationships, identifier crosswalks |
| `ciq_pplintel` | ✓ | ✗ | People Intelligence: professionals, boards, compensation |
| `ciq_capstrct` | ✓ | ✗ | Capital structure / debt |
| `ciq_keydev` | ✓ | ✗ | Key developments (news events) |
| `ciq_transcripts` | ✗ | ✓ | Earnings call transcripts |
| `ciq_transcripts_new` | ✗ | ✓ | |
| `ciq_transactions` | ✗ | ✗ | M&A / financing transactions — **not licensed on either account** |
| `ciq_ratings` | ✗ | ✗ | Not licensed |
| all `ciq_*_old` | ✗ | ✗ | Not licensed |
| `ciqsamp*` (17 schemas) | ✓ | ✓ | Free sample only |

## `ciq_pplintel.wrds_professional` — the board/professional panel

One row per **person × company × role**. A single directorship generates several rows (the seat,
plus one per committee), so the row count is not a seat count.

| Metric | Value |
|---|---|
| Rows | 20,922,958 |
| Distinct `personid` | 6,712,860 |
| Distinct `companyid` | 973,049 |
| Rows with `boardflag=1` | 9,116,839 |
| Companies with any `boardflag=1` row | 467,735 |
| People with any `boardflag=1` row | 2,414,563 |
| `boardflag=1` rows with a `startyear` | 2,855,320 (**31.3%**) |
| `boardflag=1` rows with an `endyear` | 1,773,799 (19.5%) |
| `startyear` range | 1847–2026 |

### Columns (39)

| Column | Type | Notes |
|---|---|---|
| `companyid`, `personid`, `proid` | double | `proid` = the role row id |
| `profunctionid`, `profunctionname` | double / varchar(64) | 298 distinct roles |
| `companyname`, `personname` | varchar(150) / varchar(75) | Denormalized |
| `title` | varchar(150) | Free-text title as reported |
| `yearfounded`, `yearborn` | double | Company / person |
| `countryid`, `country`, `stateid`, `state` | | Company location |
| `startday`, `startmonth`, `startyear` | double | **Mostly null** — see Limitations |
| `endday`, `endmonth`, `endyear` | double | |
| `rank`, `prorank`, `boardrank` | double | Seniority ordering within company |
| `proflag`, `currentproflag` | double 0/1 | Row is a professional (non-board) role |
| `boardflag`, `currentboardflag` | double 0/1 | Row is a board role |
| `currentflag` | double 0/1 | Role is current as of the vintage |
| `keyexecflag`, `topkeyexecflag` | double 0/1 | |
| `advisorflag`, `dealmakerflag`, `sponsorflag` | double 0/1 | **Role attributes, not person attributes** |
| `graduateflag`, `undergraduateflag` | double 0/1 | Row is an education record, not a job |
| `onlyoneflag`, `companyflag`, `hideflag` | double 0/1 | Vendor display/dedup flags |
| `committeeid` | double | Populated on committee-membership rows |

### What the flags actually mean

`boardflag` and `proflag` are **row-level**: they vary within `profunctionid` (250 and 231 of 298
profunctions respectively contain both values). They classify the *role occurrence*.

`sponsorflag`, `advisorflag`, and `dealmakerflag` are **deterministic functions of
`profunctionid`** — verified: zero of 298 profunctions has more than one value of any of the three.
They are vendor screen tags on the role taxonomy, not facts about the person.

| Flag | Rows = 1 | Reads as |
|---|---|---|
| `proflag` | 12,232,085 | Operating/professional role |
| `currentproflag` | 5,398,863 | …and current as of vintage |
| `boardflag` | 9,116,839 | Board-ish role (see trap below) |
| `currentboardflag` | 3,897,437 | …and current as of vintage |
| `currentflag` | 7,122,682 | |
| `keyexecflag` | 8,779,727 | |
| `topkeyexecflag` | 3,378,920 | |
| `sponsorflag` | 17,454,270 | Role is an employment role at all — 0 on education rows (`BS`, `MBA`, `PhD`…), `Equity Analyst`, `Chief Compliance Officer`. **Nothing to do with PE sponsors.** |
| `advisorflag` | 16,601,409 | Near-superset of `sponsorflag`; additionally 0 on committee-*chair* roles |
| `dealmakerflag` | 2,059,369 | Deal-facing professions only: `Investment Professional`, `Other Professional`, `Legal Professional`, `Operations Professional`, `Sales Professional`, `Finance and Accounting Professional` |

**`sponsorflag` is the single most misleading column in this table.** 83% of all rows carry it. It
does not identify sponsors, sponsor employees, or sponsor-backed companies.

### TRAP: `boardflag=1` is not a directorship

Composition of the 9,116,839 `boardflag=1` rows:

| Slice | Rows | Share |
|---|---|---|
| `Member of the Board of Directors` | 3,264,863 | 35.8% |
| Committee rows (`Member of … Committee` / `Chairman of … Committee`) | 2,617,508 | 28.7% |
| `Member of Advisory Board` + `Member of Supervisory Board` | 387,122 | 4.2% |
| Everything else (CEO, President, Chairman, Secretary, …) | 2,847,346 | 31.2% |

Counting `boardflag=1` rows counts a director once per committee and counts advisory-board members
as directors. **Filter on `profunctionname`, not the flag.**

```sql
-- Actual board seats
WHERE profunctionname IN ('Member of the Board of Directors',
                          'Chairman of the Board',
                          'Vice Chairman')
```

That set is 447,454 companies and 2,027,791 people — 4% fewer companies and 16% fewer people than
the `boardflag=1` universe, and free of the advisory/supervisory contamination.

Top `profunctionname` by rows (whole table):

| profunctionname | Rows | boardflag=1 |
|---|---|---|
| Member of the Board of Directors | 3,264,956 | 3,264,863 |
| Senior Key Executive | 1,782,029 | 286,028 |
| Other Key Executive | 1,490,517 | 125,059 |
| Chief Executive Officer | 808,963 | 393,906 |
| Investment Professional | 786,129 | 24,720 |
| Member of Audit Committee | 607,396 | 587,569 |
| Top Key Executive | 534,216 | 159,608 |
| Chief Financial Officer | 524,032 | 121,421 |
| President | 483,444 | 215,636 |
| Chairman of the Board | 459,149 | 459,140 |
| BS | 439,424 | 13 |
| Member of Compensation Committee | 430,618 | 424,005 |
| Member of Nominating Committee | 367,517 | 355,351 |
| Member of Advisory Board | 243,733 | 243,731 |
| Member of Supervisory Board | 143,393 | 143,391 |

Education degrees (`BS`, `MBA`, `BA`, `PhD`, …) are rows in this table. Exclude them with
`profunctionname` or `graduateflag`/`undergraduateflag`.

### Other `ciq_pplintel` tables

`ciqperson`, `ciqpersonbiography`, `ciqprofessional`, `ciqprofessionalcoverage`, `ciqprofunction`,
`ciqprotoprofunction`, `ciqcompensation`(+`detail`/`type`/`subtype`/`adjustment`/`adjustmenttype`),
`compensation_length`, `wrds_compensation`, `wrds_compensationdetails`.
`wrds_professional` is the denormalized convenience table over `ciqprofessional` × `ciqprofunction`
— start there.

## Measured board recall — CIQ vs BoardEx against the companies' own proxies

Scored on 194 companies (PE take-private targets), ground truth = the DEF 14A director slate
extracted with verbatim-quote verification, 1,530 directors.

| proxy vintage | n | CIQ | BoardEx |
|---|---|---|---|
| pre-1999 | 12 | 50.6% | 14.5% |
| 1999-2004 | 23 | 82.8% | 29.6% |
| 2005-2012 | 69 | 87.5% | 43.6% |
| 2013+ | 90 | 89.1% | 46.5% |
| **1999+, directors only** | **180** | **87.8%** | **43.4%** |

Recall, not precision: the proxy is a point-in-time slate while both vendors are cumulative panels
that legitimately hold directors from other years.

Three caveats that keep this honest:

- **BoardEx history starts 1999**, so the pre-1999 row scores it on a period it does not cover.
- **BoardEx's remaining link bug flatters CIQ.** 14% of BoardEx companies in that test were matched
  on ticker with no date window and landed on the wrong entity; excluding the obvious ones lifts it
  to ~48%. CIQ's links were date-bounded. A like-for-like BoardEx is probably ~50%.
- **This is a population-fit result.** Take-private targets skew small/mid-cap; BoardEx covers ~20k
  mostly larger listed firms. On S&P 1500 boards the comparison would likely differ. Score your own
  sample against filings before choosing.

CIQ's strict and loose (nickname-tolerant) name matching gave IDENTICAL recall, so its name forms
are clean; BoardEx gained ~21 points from loose matching, which is a sign its names need
`usualname`/`forename1` handling. See `boardex.md` and `people-linking.md`.

## `ciq_common.ciqcompanyrel` — company-to-company relationships

14,133,170 rows. Readable by **both** accounts. Six columns only:

| Column | Type | Notes |
|---|---|---|
| `companyrelid` | numeric | Row id |
| `companyid` | numeric | **Left side = investor / parent / sponsor** |
| `companyid2` | numeric | **Right side = investee / subsidiary** |
| `companyreltypeid` | integer | FK to `ciq_common.ciqcompanyreltype` |
| `percentownership` | numeric | 9.9% populated overall — see below |
| `totalinvestment` | numeric | 1.7% populated overall |

The join column is **`companyreltypeid`**, not `relationshiptypeid` — that column does not exist.
Names live in `ciq_common.ciqcompanyreltype (companyreltypeid, companyreltypename)`.

Direction verified on `companyreltypeid=1`: the modal edge is
`Private Investment Firm → Private Company` (641,864), then `Private Company → Private Company`
(186,546) and `Private Fund → Private Company` (107,863).

### Relationship types

| id | `companyreltypename` | Rows |
|---|---|---|
| 17 | Current Fund Sponsor | 7,956,325 |
| 5 | Current Subsidiary/Operating Unit | 1,569,128 |
| **1** | **Current Investment** | **1,501,339** |
| **2** | **Prior Investment** | **963,592** |
| 6 | Prior Subsidiary/Operating Unit | 732,513 |
| 7 | Merged Entity | 353,153 |
| 34 | Current Fund Investment Advisor | 229,313 |
| 11 | Current Fund Investor | 132,201 |
| 35 | Prior Fund Investment Advisor | 123,611 |
| 23 | Prior Fund Sponsor | 120,158 |
| 32 | Prior Lender | 93,841 |
| 22 | Fund Family Member | 73,406 |
| 26 | Cancelled Acquisition/Investment | 60,052 |
| 31 | Current Lender | 56,587 |
| 19 | Prior Fund Investor | 46,019 |
| 25 | Pending Acquisition/Investment | 42,539 |
| 9 | Current Investment Arm | 41,898 |
| 47 / 48 | Current / Prior Fund Distributor | 14,929 / 8,461 |
| 12 | Prior Investment Arm | 6,211 |
| 38 / 39 | Current / Prior Affiliated Government Institution | 4,398 / 135 |
| 40 / 41 | Current / Prior Index Provider | 1,402 / 43 |
| 37 | Cancelled Fund Investor | 722 |
| 42 / 43 | Pending / Cancelled Lender | 431 / 117 |
| 10 / 24 | Current / Prior Affiliate | 352 / 280 |
| 16 / 14 | Prior Legal / Prior Auditor | 10 / 4 |
| 33 | Previous Version | 0 |

`Current Fund Sponsor` (17) dominates the table at 56% of all rows and is fund-family plumbing
(a fund and its manager), not a portfolio relationship. It is not what you want.

### `percentownership` is effectively unusable for investments

| Rel type | Rows | `percentownership` non-null |
|---|---|---|
| 1 Current Investment | 1,501,339 | 290,055 (**19.3%**) |
| 2 Prior Investment | 963,592 | 1,972 (**0.20%**) |
| 5 Current Subsidiary | 1,569,128 | 759,337 (48.4%) |
| 17 Current Fund Sponsor | 7,956,325 | 363 (0.005%) |

Range is 0–100 where populated. **Do not build a stake-size or control measure on this field for
investment edges.** For Prior Investment it is null on 99.8% of rows. `totalinvestment` is worse
(115,275 / 78,293 non-null on types 1 / 2).

### `ciq_common.ciqcompanytype`

| id | name | `ciqcompany` rows |
|---|---|---|
| 1 | Public Investment Firm | — |
| **2** | **Private Investment Firm** | **292,472** |
| 3 | Assets/Products | 307,077 |
| 4 | Public Company | — |
| **5** | **Private Company** | **30,194,463** |
| 6 | Corporate Investment Arm | — |
| 7 | Financial Service Investment Arm | — |
| 8 | Index | 434,365 |
| 9 | Private Fund | 8,227,453 |
| 11 | Fund Family | — |
| 13 | Public Fund | 652,890 |
| 17–23 | Educational / Arts / Labor Union / Government / Religious / Trade Assoc. / Foundation | — |
| 24–30 | Industry / Commodity / Rate Group / Yield Curve / GCP Industry | — |

`ciq_common.ciqcompany` is 40,622,238 rows. Type 5 (Private Company) is 74% of it.

## Headline: sponsor-affiliated directors, keyed

Identifies directors of a portfolio company who are **also employed by that company's own
PE/VC sponsor** — entirely on `companyid`/`personid`. No name matching anywhere.

```sql
WITH sponsor_portco AS (
    SELECT r.companyid  AS sponsorid,
           r.companyid2 AS portcoid
    FROM   ciq_common.ciqcompanyrel r
    JOIN   ciq_common.ciqcompany s ON s.companyid = r.companyid  AND s.companytypeid = 2  -- Private Investment Firm
    JOIN   ciq_common.ciqcompany p ON p.companyid = r.companyid2 AND p.companytypeid = 5  -- Private Company
    WHERE  r.companyreltypeid = 1                                                          -- Current Investment
),
portco_board AS (
    SELECT sp.sponsorid, sp.portcoid, d.personid, d.startyear
    FROM   sponsor_portco sp
    JOIN   ciq_pplintel.wrds_professional d
           ON d.companyid = sp.portcoid
          AND d.profunctionname IN ('Member of the Board of Directors',
                                    'Chairman of the Board',
                                    'Vice Chairman')
)
SELECT DISTINCT b.sponsorid, b.portcoid, b.personid, b.startyear
FROM   portco_board b
JOIN   ciq_pplintel.wrds_professional e          -- the same person, employed by the sponsor
       ON e.personid  = b.personid
      AND e.companyid = b.sponsorid;
```

Runs in ~6s on `eddyhu`. Verified counts:

| Stage | Count |
|---|---|
| Sponsor → portco edges (PIF → Private Co, Current Investment) | 641,864 |
| Distinct portfolio companies | 312,935 |
| …of which have any observed director | 61,041 (19.5%) |
| Director seat rows at those portcos | 1,324,634 |
| Sponsor-affiliated **rows** (with role fan-out) | 134,254 |
| Sponsor-affiliated **distinct (sponsor, portco, person)** | **50,529** |
| Distinct people / portcos / sponsors | 25,752 / 23,645 / 9,317 |
| Affiliated triples carrying a board `startyear` | 14,044 (27.8%) |

**`SELECT DISTINCT` is required.** The sponsor-side leg fans out: one person holds several role
rows at the sponsor (`Investment Professional`, `Top Key Executive`, `Operations Professional`…),
multiplying 50,529 real affiliations into 134,254 rows. Sample output confirms the shape:

| personname | portconame | sponsorname | sponsor_role |
|---|---|---|---|
| Spurlock, Steven | Abaco Mobile, Inc. | Benchmark | Top Key Executive |
| Spurlock, Steven | Abaco Mobile, Inc. | Benchmark | Investment Professional |
| Spurlock, Steven | Abaco Mobile, Inc. | Benchmark | Operations Professional |
| Klausner, Arthur | ATI Medical, Inc. | Domain Associates, L.L.C. | Investment Professional |

The sample is also the caveat: `Benchmark`, `Domain Associates`, `Voyager Capital` are VC firms.
See Limitations.

## Identifier crosswalks

In `ciq_common`, readable by **both** accounts:

| Table | Rows | Notes |
|---|---|---|
| `wrds_gvkey` | 144,145 | `companyid → gvkey`, with `startdate`/`enddate`/`primaryflag` (both dates null on sampled rows) |
| `wrds_cusip` | 2,788,029 | 321,878 distinct `companyid` — security-level, expect fan-out |
| `wrds_ciqsymbol`, `wrds_ciqsymbol_primary`, `ciqsymbol`, `ciqsymboltype` | | Ticker/exchange symbols |
| `ciqgvkeyiid` | | gvkey + issue id |

There is **no** readable CIQ↔BoardEx person link (see The Account Split).

## Limitations

**1. 69% of board rows are undated.** Only 2,855,320 of 9,116,839 `boardflag=1` rows carry a
`startyear` (27.8% on the sponsor-affiliated subset). Any "who sat on the board at date *X*"
measure is therefore defined on roughly a third of the data, and the missingness is not random —
it skews toward small private companies, which is exactly the sponsor-backed population. This is
the binding constraint on every point-in-time use of this table. State the dated subsample size
before reporting a point-in-time result.

**2. `currentboardflag` is a vintage snapshot, not point-in-time.** 125,807 of its 3,897,437 rows
also carry an `endyear` — the seat has demonstrably ended and the flag still says current. It means
"current as of whenever WRDS last loaded CIQ," and it cannot be evaluated as of a historical date.

**3. `Current Investment` is not a control measure.** It is any equity investment edge, including
VC minority stakes and syndicate co-investors — the headline sample is dominated by early-stage VC
firms. It carries no threshold, no lead/follow distinction, and (see above) no usable ownership
percentage. Do not read a type-1 edge as "the sponsor controls this company." If control matters,
restrict with an external source (PitchBook `dealtype = 'Buyout/LBO'`, SDC M&A) or with
`companyreltypeid = 5` (Current Subsidiary), which is a different and stronger claim.

**4. `sponsorflag` does not mean sponsor.** It is a role-taxonomy tag on 83% of rows. See flags.

**5. `boardflag=1` includes advisory and supervisory boards** and one row per committee. Filter on
`profunctionname`.

**6. `ciq_transactions` is denied on both accounts.** There is no CIQ deal table available here —
use PitchBook (`references/pitchbook.md`) or SDC M&A (`references/sdc-ma.md`) for transactions.
