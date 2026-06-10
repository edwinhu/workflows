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
