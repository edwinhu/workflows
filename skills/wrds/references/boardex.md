# BoardEx on WRDS

Director and executive profiles, board composition, employment history and networks.
Account-gated: `boardex_na` is readable by **`edwin_hu` only**; `eddyhu` sees `boardex` and
`boardex_trial` and gets `permission denied for schema boardex_na` on every real table.
`boardex_uk`, `boardex_eur`, `boardex_row` are denied to both. See `capiq.md` for the mirror-image
split — the two best board sources cannot share a connection.
Use BoardEx employment, not PitchBook's `representingname`, to decide sponsor affiliation —
see the measured disagreement in `pitchbook.md`.

## Coverage — the number that decides whether BoardEx fits your sample

**History starts 1999. Roughly 20,000 companies worldwide, weighted to larger listed firms.**
Collected from public sources only: company websites, news releases, proxy statements.

Measured against 194 companies' own DEF 14A director slates (PE take-private targets, 1,530
verbatim-verified directors):

| proxy vintage | n | BoardEx recall | CIQ recall |
|---|---|---|---|
| pre-1999 | 12 | 14.5% | 50.6% |
| 1999–2004 | 23 | 29.6% | 82.8% |
| 2005–2012 | 69 | 43.6% | 87.5% |
| 2013+ | 90 | 46.5% | 89.1% |
| **1999+, directors only** | **180** | **43.4%** | **87.8%** |

Recall is the fair metric here: the proxy is a point-in-time slate, both vendors are cumulative
panels. Extra names cannot lower recall, so a low number is missing people, not noise.

**Do not read this as "BoardEx is bad."** It is a coverage-fit result on a population BoardEx is not
built for — take-private targets skew small- and mid-cap. On S&P 1500 boards its coverage is the
reason the dataset exists. Check your own sample against filings before assuming either way.

## `wrds_org_composition` is NOT a board

It "provides a complete list of individuals available from BoardEx for each company by combining
director listings with **senior manager** listings." Measured on one 504-company extract:

| seniority | rows |
|---|---:|
| Senior Manager | 20,403 |
| Supervisory Director | 7,864 |
| Executive Director | 2,882 |

Filter `seniority IN ('Supervisory Director','Executive Director')` for a board. Without it a
7-person board reads as 30+, and any "board size" or "share of board" statistic is wrong.

## Sentinel dates

`datestartrole = 1900-01-01` and `dateendrole = 9999-12-31` are placeholders for unknown, and they
parse as valid dates. Measured at ~2% of rows on one extract but concentrated in private-company
roles, so a point-in-time filter (`role spans date X`) silently admits every undated role. Feed
version 4.2 added `DateStartRoleFlag` / `DateEndRoleFlag` "indicating the nature of the date
variables" — use them rather than the sentinel values.

## Feed version 4.2 (January 2025)

Updated from 3.5. Coverage and structure intact; additions worth knowing:

- `na_company_profile_details`: **`PreviousCompanyID`, `SuccessorCompanyID`, `UltimateParentCompanyID`**
  — entity succession, which is what a renamed / delisted / re-registered company needs.
- `PrimaryKeyID` on most profile tables (faster linking); `LeaderShipTeam` on `dir_profile_emp`.
- Date flag variables across the profile tables.
- `na_wrds_dir_profile_emp` and `na_wrds_company_profile` now join stocks only where
  `PrimaryStock = 'Yes'`; non-primary issues remain in `na_company_profile_stocks`.
- `na_wrds_company_profile` no longer includes advisors (one-to-many); see
  `na_company_profile_advisors`.

## Identifiers

Per the 4.2 technical reference: **`CompanyID` and `DirectorID` are 1:1 and permanent** — "a Company
will only ever have one identifier." So a wrong company in your results is a wrong JOIN, not a
reassigned id. `BoardID` and `DirBrdID` are the same values re-labelled in views that show a base
company/director beside related records.

## Linking a company to BoardEx — the trap

`na_wrds_company_names` carries `ticker`, `cikcode` and `isin`, but ticker alone is not a key:
**tickers are reused across companies over time**. Matching on ticker without a date window put 14%
of one 193-company sample on the wrong entity — large rosters with ZERO overlap against the
company's own proxy. Bound the ticker window and anchor it on a date when the company was still
trading; for a take-private that means the **announcement** date, since the stock delists at
closing and the ticker window ends at or before the effective date by construction.

Prefer `cikcode` where populated (23,985 of 1,253,484 rows) and validate any join against a company
whose board you know independently.

## Key tables

| table | contents |
|---|---|
| `na_wrds_org_composition` | directors + senior managers per company, with `seniority` |
| `na_wrds_dir_profile_emp` | employment records with company info (primary stock only, 4.2+) |
| `na_wrds_company_names` | companyid, boardname, ticker, cikcode, isin, country |
| `na_dir_profile_details` | `forename1..4`, **`usualname`** (the nickname), `surname`, dob, LinkedIn URL |
| `na_wrds_company_profile` | aggregated company profile |
| `na_board_dir_committees` | committee membership |

`na_dir_profile_details.usualname` vs `forename1` is how "Al Berkeley III" and "Alfred Berkeley"
reconcile — use both sides when name-matching people, though see `people-linking.md` for the
identifier route that avoids names entirely.
