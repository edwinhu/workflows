# ISS N-PX → SEC Series → CRSP Crosswalk

Builds the `fundid → block` crosswalk that
[`../build_npx.sas`](../build_npx.sas) hash-merges on the WRDS grid.

**This is the hard half.** The SGE array that reduces 238M N-PX rows to 2.25M
`(item, block)` cells is mechanical once you have this file; getting from an ISS
`fundid` to a CRSP fund is not.

**It runs end to end from a fresh checkout with nothing but WRDS credentials.**
Every input is either a WRDS table or a public SEC download. Read
[`references/npx-crsp-linking.md`](../../../references/npx-crsp-linking.md)
before touching a threshold — it documents the measured failure each one prevents.

## Quick start

```bash
# 0. one-off: SEC series/class masters (public, no credentials)
export SEC_USER_AGENT="your name your@email.edu"     # SEC blocks generic agents
./download_sec_series_class.py --out data/raw/sec_series_class
SEC_SERIES_RAW=data/raw/sec_series_class SEC_SERIES_OUT=data/processed \
    ./build_sec_series_master.py

# 1. TEST BEFORE SCALING — one year, ~2 min, 8 assertions
./smoke_test.sh 2023

# 2. the dimensions (the ISS pull is the slow one, ~7 min)
./pull_npx_funds.py  --out npx_funds.parquet --start-year 2005 --end-year 2025
./pull_crsp_funds.py --out crsp_funds.parquet

# 3. the ladder
./build_npx_crsp_link.py \
    --npx-funds npx_funds.parquet \
    --crsp-funds crsp_funds.parquet \
    --sec-series-master      data/processed/sec_series_master.parquet \
    --sec-series-names-long  data/processed/sec_series_names_long.parquet \
    --out npx_crsp_link.parquet

# 4. push it to the grid
cd .. && ./npx_link_to_csv.py --in npx_linking/npx_crsp_link.parquet \
    --out npx_link.csv --key fundid --group block --weight tna_latest
scp npx_link.csv wrds:~/projects/myproject/
```

Requires `polars`, `pandas`, `numpy`, `scikit-learn`, `sparse_dot_topn`, `psycopg2`.

## The ladder

```
L0  risk.voteanalysis_npx  ──►  npx_funds.parquet    26,929 fundids (server-side agg)
    crsp.fund_hdr/summary2/cik_map ──► crsp_funds.parquet   75,445 fundnos
    SEC annual masters     ──►  sec_series_master    87,065 class rows / 34,546 series

L1-L2  fundid ──► seriesId ──► CRSP fund unit
L3     block from crsp.index_fund_flag, name-regex fallback for unlinked
                    │
              npx_crsp_link.parquet   26,929 × 21
```

## Measured coverage — 2005-2025, run 2026-07-25

| Tier | Kind | fundids | vote rows | % vote rows |
|---|---|---:|---:|---:|
| `propagated` | exact | 5,957 | 84,831,520 | 58.76 |
| `sec_name` | fuzzy→ID | 8,033 | 26,637,210 | 18.45 |
| `crsp_name_scoped` | fuzzy | 763 | 1,953,098 | 1.35 |
| `iss_seriesid` | exact | 1,814 | 1,771,876 | 1.23 |
| `crsp_name_global` | fuzzy | 452 | 1,000,385 | 0.69 |
| `via_sec_ticker` | exact | 228 | 499,672 | 0.35 |
| **`unlinked`** | — | **9,682** | **27,682,099** | **19.17** |

**LINKED: 116,693,761 / 144,375,860 vote rows = 80.8%**
(82.4% of *linkable* rows — 1,038 ISS non-registrants have no SEC seriesId by
construction and can never link.)

| Block | fundids | % vote rows |
|---|---:|---:|
| `active` | 21,627 | 55.95 |
| `index` | 3,704 | 36.56 |
| `passive` | 560 | 5.59 |
| `asset_owner` | 1,038 | 1.90 |

Shares reconcile to 100.0000%. Total TNA at fundid grain after the many-to-one
split: **$32.96T** (an unsplit version of the same number reads ~$64T).

### How far short of mirror's 90.5%, and why

**80.8% vs 90.5% — 9.7 points short**, and 9,682 unlinked fundids against 5,495.
Two causes, both structural, neither fixable without project-specific work:

1. **No hand-adjudication.** Mirror's ladder carries curated tiers built by
   inspecting candidates — `feeder_master_name` (275), `via_l2_crsp_name` (210),
   `digit_split_name` (6) — plus a hand-curated family table. Those tiers are
   *decisions*, not code; they cannot be shipped as a portable algorithm. The
   `--family-overlay` hook is where they belong (see below).
2. **SEC masters start in 2010.** They are point-in-time snapshots of
   then-active registrants, so a fund that died before 2010 appears in none of
   them and the `sec_name` tier cannot reach it. 2,847 unlinked fundids last
   voted in 2005-2009.

The block distribution lands within a few percent of mirror's on every block
(`asset_owner` 1,038 vs 1,035; `active` 21,627 vs 21,145; `index` 3,704 vs
3,892), so the missing 9.7 points are concentrated in small, short-lived funds —
not in a systematically different classification.

## Files

| File | Role |
|---|---|
| `download_sec_series_class.py` | fetch the SEC annual masters (scrapes the landing page — URLs are inconsistent) |
| `build_sec_series_master.py` | consolidate them into series/class masters |
| `pull_npx_funds.py` | ISS fund dimension, aggregated server-side |
| `pull_crsp_funds.py` | CRSP fund dimension (`fund_hdr` + `fund_summary2` + `crsp_cik_map`) |
| `build_npx_crsp_link.py` | **the ladder** + the coverage report |
| `matching.py` | the engine — normalisers, digit guard, TF-IDF, cross-family verdict |
| `linking_config.py` | every threshold and stoplist, with the failure it prevents |
| `smoke_test.sh` | one year, 8 assertions — run this first |
| `family_overlay.example.csv` | schema example for the optional overlay |

## The one optional, project-specific input

`--family-overlay` takes a hand-curated CSV mapping an ISS institution name to
the family token the cross-family rule should use. **It is never required.** The
ladder runs to completion without it and the coverage report says so explicitly.

```csv
institutionname_modal,family_token,note
"Allspring Global Investments",ALLSPRING,"Wells Fargo -> Allspring succession"
```

Rows with an empty `family_token` are ignored; a missing file logs a note and
continues. It exists because corporate successions (Boston Management & Research
→ Eaton Vance, Gartmore → Nationwide) are *decisions* a matcher cannot make from
names, and they are ~15% of the master-feeder tier's accepts.

## Traps that will cost you a headline number

- **`n_vote_rows` is `uint32` at source.** A naive sum overflows: block shares
  summed to 40.5% and the index block read **6.3% when the truth was 36.1%**.
  `pull_npx_funds.py` casts to int64 once, at source; the coverage report
  asserts shares reconcile to 100%.
- **`fundid → crsp_fundno` is many-to-one.** Unsplit TNA gives **$64.43T against
  a true $32.38T**. `split_tna()` divides each unit's TNA across the fundids
  sharing it; the smoke test asserts the split reconciles.
- **Resolve identity at fundid grain, never on the vote panel.** 16 fundids
  carry >1 seriesId (reproduced exactly). At 27K rows that is auditable; at
  144M it is not.
- **Use the right denominator.** `pull_npx_funds.py` restricts to N-PX rows
  whose item is in `vavoteresults` — the same universe `build_npx.sas`
  aggregates. Without it you count 237,057,808 rows instead of 144,375,860 and
  every coverage percentage is against the wrong base. `--no-item-universe`
  disables it if you really want the raw meetingdate window.
- **Report weight coverage.** 24.2% of vote rows carry no TNA weight. Publish
  that alongside any weighted statistic — `build_npx.sas` emits `n_no_tna` per
  cell for the same reason.
