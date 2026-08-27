# ISS/RiskMetrics Directors Data

Board-level governance data from ISS (formerly IRRC/RiskMetrics).

## Tables

| Table | Library | Years | Grain | Approx Rows |
|-------|---------|-------|-------|-------------|
| `risk.directors` | risk | 1996-2006 | director-year | 166K |
| `risk.rmdirectors` | risk | 2007-present | director-year | 268K+ |

**These are two separate tables with different schemas.** You must pull from both and harmonize to cover the full time series.

## Grain & Keys (verified 2026-06-09)

- **Row PK `risk.rmdirectors` (2007+):** none exact. The WRDS-documented primary identifier is
  `(year, ticker, director_detail_id)`
  ([Identifiers in ISS Directors US](https://wrds-www.wharton.upenn.edu/pages/support/support-articles/iss-formerly-known-riskmetrics-and-irrc/best-identifier-use-riskmetrics-directors-changes-identifier-between-legacy-and-current-files/):
  "The primary identifier in the current dataset is year-ticker-director_detail_id").
  VERIFIED-WITH-RESIDUAL: 82 dupes over 268,451 rows; `(cusip, meetingdate, director_detail_id)` → 72 dupes.
  Inspected collisions are byte-identical duplicate rows (same name, title, everything) — run
  `drop_duplicates()` first, then the documented key is effectively unique. Two-meetings-per-year firms
  explain the (year,ticker) vs (cusip,meetingdate) difference.
- **Row PK `risk.directors` (1996-2006):** none. The documented key FAILS here:
  `director_detail_id` is NULL on 51,511 / 166,375 rows (`legacy_director_id` NULL on 4,631), so
  `(year, ticker, director_detail_id)` leaves 39,788 dupes and `(cusip, year, legacy_director_id)` leaves
  2,210. Best observed: `(cusip, meetingdate, fullname)` — 26 dupes over 166,375 (byte-identical pairs;
  `drop_duplicates()` clears them). WRDS confirms: "There is no single variable that is populated for all
  companies and all years" (same article).
- **Business/event key:** director-firm-year (one board seat in one proxy season). No amendment axis;
  collisions = vendor duplicate loads only.
- **Linking identifiers:** `cusip` (legacy table = 6-digit HEADER cusip, backfilled to latest by WRDS;
  `rmdirectors` = as-delivered, typically 9-digit historical — per the same WRDS article), `ticker`
  (as-delivered, never restated), `director_detail_id` (person across boards/years; cross-board interlocks),
  `legacy_director_id` (legacy table only — never use across tables), `company_id` (rmdirectors only),
  link to Compustat/CRSP via `cusip6`.

## Key Column Differences

| Column | `directors` (1996-2006) | `rmdirectors` (2007+) |
|--------|------------------------|----------------------|
| `female` | DOUBLE (0.0/1.0) | VARCHAR ('Yes'/'No') |
| `attend_less75_pct` | DOUBLE (0.0/1.0) | VARCHAR ('Yes'/'No') |
| `audit_membership` | DOUBLE | VARCHAR ('Chair'/'Member') |
| `comp_membership` | DOUBLE | VARCHAR ('Chair'/'Member') |
| `nom_membership` | DOUBLE | VARCHAR ('Chair'/'Member') |
| `legacy_director_id` | exists | **does not exist** |
| `director_detail_id` | exists | exists |
| `ticker` | exists | exists |
| `indexname` | VARCHAR | VARCHAR |

## Harmonization

```python
# female: map string to numeric
df_new["female"] = df_new["female"].map({"Yes": 1.0, "No": 0.0})

# attend_less75_pct
df_new["attend_less75_pct"] = df_new["attend_less75_pct"].map({"Yes": 1.0, "No": 0.0})

# committee membership
for col in ["audit_membership", "comp_membership", "nom_membership"]:
    df_new[col] = df_new[col].map({"Chair": 2.0, "Member": 1.0})
```

## Director Identifiers

- **`director_detail_id`**: Exists in both tables. Tracks directors across boards (same person on multiple boards has same ID). Use this for cross-board linkage (e.g., IV instruments based on board interlocks).
- **`legacy_director_id`**: Only in `risk.directors`. Do not use for cross-table joins.

## 1996 Gender Data

Gender (`female`) is completely NULL for all observations in 1996. Backfill strategies:
1. Match to 1997+ via `legacy_director_id` or `director_detail_id` (~85% recovery)
2. Match via `first_name` using 1997+ gender distribution (>=5 obs, >=95% agreement)
3. Conservative default: assign male (91% base rate)

## Independence: `classification`, and the 2019 recode trap

`classification` is **ISS's own judgment under its voting policy**, not the company's
Section 303A.02 / Rule 5605(a)(2) determination. ISS is stricter than the exchanges in places
(long tenure, designated directors, co-investments). Never report it as "the board determined".

**The codes changed in 2019.** Legacy `I`/`E`/`L` map 1:1 onto `I-NED`/`Exec`/`NI-NED`.
Counts, `risk.rmdirectors`, `meetingdate >= 2015-01-01`, n = 157,593 after
`drop_duplicates(["company_id","meetingdate","fullname"])` (verified 2026-08-26):

| code | meaning | n | years |
|---|---|---:|---|
| `I-NED` | independent non-executive | 82,912 | 2019+ (17 strays 2017-18) |
| `I` | independent (legacy) | 46,358 | 2015-2018 (+~14 strays to 2024) |
| `Exec` | executive/insider | 13,004 | 2019+ |
| `E` | employee/insider (legacy) | 8,029 | 2015-2019 |
| `NI-NED` | **affiliated** non-executive | 4,611 | 2019+ |
| `L` | linked (legacy) | 2,623 | 2015-2019 |
| NULL | | 56 | |

```python
indep = df.classification.isin(["I-NED", "I"])   # NOT just "I-NED"
exec_ = df.classification.isin(["Exec", "E"])
affil = df.classification.isin(["NI-NED", "L"])
```
Filtering on `I-NED` alone silently zeroes 2015-2018 and drives mean independent share to ~0.51.

BoardEx `ned` cannot express this construct: it is only an executive/non-executive split, with
**no category for an affiliated non-executive**.

## Component relationship flags

Value domain is `'Yes'` or NULL (`designated` also has 3 `'Y'`; `charity` and
`attend_less75_pct` carry a `'NUL'` literal). `Yes` counts over the same 157,593 director-rows:

| column | label | Yes | % |
|---|---|---:|---:|
| `relative_yn` | Relative? | 2,964 | 1.88% |
| `former_employee_yn` | Former Employee? | 2,844 | 1.80% |
| `business_transaction` | Business Transaction? | 2,433 | 1.54% |
| `charity` | Charity Relationship? | 1,768 | 1.12% |
| `prof_services_yn` | Prof Services? | 1,616 | 1.03% |
| `otherlink` | Other Affiliation | 804 | 0.51% |
| `interlocking` | Interlocking Directorship? | 236 | 0.15% |
| `designated` | Designated Director? | 177 | 0.11% |

Also carried: `dirsince`, `year_of_termination`, `nominee`, `pcnt_ctrl_votingpower`,
`primary_employer`, `prititle`, `financial_expert`, `employment_ceo/chairman/president/cfo/...`.
`employment_*` is the director's title at **their own employer**, not at this company — 3,889
`I-NED` rows carry `employment_ceo='Yes'`.

**Flag defects, by year (`Yes` counts):** `business_transaction` spikes to 859 (2016) and 514
(2017) against ~110-150 in every other year. `interlocking` is effectively discontinued after
2019 (37 in 2019 → 1 in 2024 → 0 in 2025). `year_of_termination` is documented "Mostly
incomplete" and coverage collapses from ~750/yr to ~140/yr in 2020; it is present on only 61%
of `former_employee_yn='Yes'` rows, so "former employee within 3 years" is not generally
derivable.

1,541 of 4,618 `NI-NED` director-years (2019+) carry **no** flag at all — ISS's affiliation
judgment often rests on factors the flags do not record.

## `exchange_type`

Separate column labelled only "Exchange Type"; values `I`/`E`/`L`/`ND`/`Exec`/`Management`.
Not a copy of `classification`: `NI-NED` splits into `L` 1,894 / `I` 1,269 / `ND` 1,205 /
`Management` 243 (2015+). The 1,269 `NI-NED` × `exchange_type='I'` rows are directors ISS
deems non-independent under its own policy but independent under whatever standard this field
encodes. Semantics are undocumented by WRDS — treat as a candidate exchange-standard measure
and label it as unverified.

## S&P 1500 Filter

The `indexname` column identifies index membership. To restrict to S&P 1500:
```python
not_super = df["indexname"].str.lower().str.contains("not super", na=False)
df = df[~not_super]  # Keep NaN (1996 has no labels) and S&P 1500 firms
```

## Linking to Compustat/CRSP

Link via `cusip` (first 6 characters -> `cusip6`). ISS cusip is the historical CUSIP at time of observation.

## Other Tables

| Table | Description |
|-------|-------------|
| `risk.rmgovernance` | Firm-level governance provisions (not director-level) |
| `risk.rm_gov_2010`-`2013` | Year-specific governance snapshots |
| `risk.committee96_97` | Early committee data |

## Common Gotchas

1. **Two tables, not one** -- most code examples only use `risk.directors` and miss 2007+
2. **Type mismatches** -- string vs numeric columns break `pd.concat` / parquet writes
3. **1996 gender** -- appears complete (no errors) but is 100% NULL
4. **`codirfin` != director-level ISS** -- ExecuComp's codirfin is firm-level director comp, not individual directors
5. **Select specific columns** -- taking `SELECT *` from both tables and concatenating fails due to incompatible column types in unused columns (e.g., `interlocking` is double vs varchar)
