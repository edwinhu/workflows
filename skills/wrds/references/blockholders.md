# SEC 13D/13G Blockholders Dataset (Volkova Replication)

Python port of Kate Volkova's blockholder panel (Schwartz-Ziv & Volkova 2020,
"Is Blockholder Diversity Detrimental?") that parses SEC Schedule 13D/13G filings
into a company-blockholder-year panel.

Source R pipeline: https://github.com/volkovacodes/Block_Codes
Published CSV (1993–2023): 572K rows × 29K companies × 63K blockholders.

## What the dataset is

One row per `(company_CIK, blockholder_CIK, year)`. Columns:

| Field | Description |
|-------|-------------|
| `blockholder_CIK`, `blockholder_name` | Filer of 13D/G |
| `company_CIK`, `company_name` | Subject (issuer) company |
| `year` | Ownership year (not filing year — see below) |
| `position` | Aggregate % of class owned (max across co-filers on cover page) |
| `block_type` | `individual`, `institution`, or `other` (3-way collapse — loses 13D/G split) |
| `files_13F` | 1 if blockholder CIK filed a 13F in the same year |
| `filing_type` | `13D` or `13G` (from retained filing's `form_type`; NA for insider add-on rows) |
| `individual` | 1 if `item12 == 'in'` (Volkova flag 1 of 4) |
| `active_inst` | 1 if 13D filer & `files_13F` & not individual (Volkova flag 2) |
| `passive_inst` | 1 if 13G filer & `files_13F` & not individual (Volkova flag 3) |
| `other` | `1 - individual - active_inst - passive_inst` (Volkova flag 4) |

Year assignment differs from filing date:
- Anyone filed in first 14 days of year → previous year
- 13G with position <10% filed by Feb 24 → previous year (annual 13G)
- All others: `year = year(filing_date)`

## Grain & Keys (verified 2026-06-09)

- **Row PK (pipeline output):** `(company_CIK, blockholder_CIK, year)` — VERIFIED BY CONSTRUCTION, not by
  index: the aggregator's amendment-resolution step `drop_duplicates` on exactly this triple after sorting
  `file_date` descending (see [Key gotchas](#key-gotchas) #1), so the output panel is unique on it by
  definition. Re-verify with `df.duplicated(subset=["company_CIK","blockholder_CIK","year"]).sum() == 0`
  after any pipeline change.
- **Business/event key:** same triple = one blockholder's stake in one company in one ownership year.
  Collisions upstream = SC 13D/A / 13G/A amendments + multiple filings per year; resolved by keeping the
  **latest `file_date`** filing per triple (Volkova supersession rule).
- **Underlying index tables (schema-verified):** `wrdssec_all.wrds_forms` — `fname` unique, `(accession,
  cik)` unique, `accession` alone NOT unique (one row per filer CIK; 347,721 dupes in a 2023 slice of
  1,159,918 rows) — hence the `DISTINCT` / `drop_duplicates('accession')` steps in this pipeline.
  **Caveat:** the SQL below selects `accession` FROM `wrdssec_all.forms`, but `forms` has NO `accession`
  column (verified 2026-06-09) — use `wrdssec_all.wrds_forms`, or derive the accession from `forms.fname`.
- **Linking identifiers:** `company_CIK` / `blockholder_CIK` (SEC CIK) → gvkey via `wrdssec.wciklink_gvkey`;
  13F overlap via `wrdssec_all.forms` form ILIKE '%13F%'.

## Script locations

**The multi-filer gap is closed.** `scan_covers -profile blockholders_13dg` now
emits **one row per (subject, filer) pair**, matching `parser.py`, via the opt-in
`Profile.Expand` hook added for exactly this (see `expand_blockholders.go`).

It had emitted one row per *filing* with `fil_cik`/`sbj_cik` on `Reduce:First`, so
a joint filing under §13(d)(3) — N filers acting as a group, each with its own
Item 12 — collapsed to whichever filer came first. That is the case blockholder
work is most interested in.

Two properties worth knowing:

- **No-op on the common case.** A filing naming one filer and one subject returns
  the row untouched, so output for the overwhelming majority is byte-identical to
  before. Verified against the pre-change binary.
- **Opt-in for everything else.** `Expand` is nil on all five other profiles, so
  none of them changed. Also verified.

`parser.py` remains the reference implementation and the parity target; the Go
profile is the one to run at scale.

- Parser (multi-filer): `~/projects/mirror/src/blockholders/parser.py`
- Aggregator: `~/projects/mirror/src/blockholders/aggregate.py`
- Driver: `~/projects/mirror/scripts/pull_blockholders.py`
- Comparison vs the published Volkova baseline: `~/projects/mirror/scripts/compare_blockholders.py`
- Investigation: `~/projects/mirror/docs/investigations/2026-04-18_volkova_pipeline.md`

**Known open defect**, currently recorded only in mirror's `sas/README.md`:
`aggregate.py` computes `prc_own = 100 * Num_Own / (1000 * SHROUT)` from CRSP
`SHROUT`. For 13D/G the filer reports a specific security class, so the per-class
CRSP value is normally correct — but when multiple permnos share a CIK and the
`crsp_shrout` frame has one row per permno-month, the `merge(on="year_month")`
can double-count.

## How to run

```bash
cd ~/projects/mirror

# 1. Query metadata, create tar on WRDS, download (~100 MB compressed per year)
pixi run python scripts/pull_blockholders.py \
    --start 2020-01-01 --end 2020-12-31 \
    --work-dir data/raw/blockholders/2020 \
    --out data/processed/blockholders_python_2020.parquet
```

**Faster for multi-year runs** — use the WRDS tar pattern (see edgar.md):

```bash
# 1. Python: query + write files_from.txt
pixi run python -c "
from scripts.pull_blockholders import query_forms_metadata, write_files_from
from pathlib import Path
meta = query_forms_metadata('2020-01-01','2020-12-31')
wd = Path('data/raw/blockholders/2020'); wd.mkdir(parents=True, exist_ok=True)
meta.to_parquet(wd/'metadata.parquet')
write_files_from(meta.drop_duplicates('accession')['fname'].tolist(), wd/'files_from.txt')
"

# 2. Bash: upload list, tar server-side, download
scp data/raw/blockholders/2020/files_from.txt wrds:/tmp/bh_2020.txt
ssh wrds "cd /wrds/sec/wrds_clean_filings && \
    tar czf /scratch/nyu/eddyhu/bh_2020.tar.gz -T /tmp/bh_2020.txt"
rclone copy wrds:/scratch/nyu/eddyhu/bh_2020.tar.gz data/raw/blockholders/2020/
cd data/raw/blockholders/2020/ && tar xzf bh_2020.tar.gz -C filings/

# 3. Python: parse + aggregate (rclone skipped via --skip-rclone)
pixi run python scripts/pull_blockholders.py \
    --start 2020-01-01 --end 2020-12-31 \
    --work-dir data/raw/blockholders/2020 \
    --out data/processed/blockholders_python_2020.parquet \
    --skip-rclone --skip-gap-fill
```

Per-year size estimates (wrds_clean_filings):
- 1998: 65K filings → 117 MB tar.gz → 900 MB raw → 22K panel rows
- 2020: 55K filings → 67 MB tar.gz → 600 MB raw → 20K panel rows
- 2024: 73K filings → 75 MB tar.gz → 700 MB raw → 24K panel rows

Parse rate: **~1,200 filings/sec** on 15 cores (M-series). End-to-end one year ≈ 5-10 min.

## Key gotchas

### 1. Amendment resolution
Volkova resolves SC 13D/A, SC 13G/A by keeping the **latest filing** per `(blockholder, company, year)` triple. Our port uses `ascending=[True,True,True,False]` on `file_date` and `drop_duplicates(keep='first')`. The R source `setkey(..., dif)` where `dif = Jan 1 - DATE` is negative for post-Jan filings, so ascending sort puts latest first.

### 2. block_type classification — `block_type` collapses 4 flags into 3, losing 13D/G
Volkova's `combine_annual_file.R` (lines 128-132) computes four
mutually-exclusive flags on the post-dedup row:

```r
annual[, `:=` (individual = 0, active_inst = 0, passive_inst = 0, other = 0)]
annual[item12 == "in", individual := 1]
annual[grepl("13D", TYPE) & files_13F == 1 & individual == 0, active_inst := 1]
annual[grepl("13G", TYPE) & files_13F == 1 & individual == 0, passive_inst := 1]
annual[, other := 1 - individual - active_inst - passive_inst]
```

The **published CSV collapses** `active_inst` + `passive_inst` into a single
`institution` bucket — discarding the 13D (active) vs 13G (passive) distinction
that matters for activist-investor studies.

Our Python port (as of 2026-04-18) carries all four flags through + a
`filing_type ∈ {'13D','13G'}` column derived from the retained filing's
`form_type`. `block_type` remains as a back-compat column but prefer the
four flags for filtering.

`TYPE` comes from the retained (latest-in-year) filing's `form_type` after
dedup, so a filer who switched 13G→13D mid-year gets `active_inst=1`.

`item12` is the "Type of Reporting Person" code from the cover page. Our parser does a two-pass match (line-based, then collapsed-one-liner). Miss rate ~5-10%.

### 3. `files_13F` lookup
Use `wrdssec_all.forms WHERE form ILIKE '%13F%'` (default to `forms`, not `wrds_forms` — see `references/wrds-forms-tables.md`). Pre-1999 coverage is sparse (<100 CIKs/year) because many filings were paper — not a WRDS bug, SEC never digitized them. Post-1999 is complete.

### 4. Position extraction artifacts
The R parser has hacks to strip row-number prefixes (row 9 → value looks like `9xx`; row 11 → `11xx` or `11x`). Our port ports these byte-for-byte.

**Known parser fragility**: the 16-line window after "percent" keyword can capture percentages mentioned in narrative ("100% of shares subject to the award"). Affects ~5% of filings per year. The `max` aggregation then picks up a false high.

### 5. Gap-fill
Volkova forward-fills 2/3/4-year gaps: if `(blockholder, company)` files in 2016 and again in 2020, rows for 2017/2018/2019 are synthesized. This significantly inflates row count and accounts for **~50% of the full-panel rows**. Our single-year runs use `--skip-gap-fill` because filling requires parsing all prior years.

### 6. Insider add-on (Volkova scripts 8–9) — PORTED 2026-04-18

Roughly 5–10% of the published CSV comes from Form 3/4/5 scraping. Volkova
hits SEC `own-disp` per CIK; we pull the same data server-side from
`tr_insiders.table1` (Thomson Reuters). See `insider-form4.md` for the
bulk extraction pattern.

- **Puller (Python, interactive):** `scripts/pull_insider_ownership.py`
  — asyncio-free, year-chunked SQL with cusip6 whitelist (12K issuers).
  2019-2024 → 1.7M rows in ~22s.
- **Puller (SAS, WRDS grid):** `sas/pull_tr_insiders.sas` +
  `sas/run_insider_array.sh` (`#$ -t 1994-2024`). Pushes the
  `prc_own = 100 * sharesheld / (1000 * shrout)` aggregation into SAS so
  that only the annualised panel rows ship back.
- **CRSP SHROUT panel:** `scripts/pull_crsp_msf.py` → `data/processed/crsp_msf_shrout.parquet` (cik, permno, date, SHROUT, RET, year_month).
- **Cusip6 ↔ CIK:** `data/processed/cusip6_cik_map.parquet` (via
  `crsp.stocknames` + CCM linktable).
- **Compute:** `aggregate.find_blocks(company_cik, insider_df, crsp_msf)` and
  `aggregate.compute_insider_addon(annual_panel, tr_insider, crsp_msf, cusip_map, year_range, position_threshold=5)`.
  Output schema matches the panel (8 cols, `files_13F=0`,
  `block_type='individual'`).

**2024 add-on yield:** 1,929 new rows for 2024 (on top of the 13,164 from
13D/G). See the investigation doc for the full fidelity table.

### 6a. TR-to-SEC CIK bridge (personid → rptownercik) — BRIDGED 2026-04-18

`tr_insiders` has NO SEC Owner CIK column — only Thomson's proprietary
`personid`. The WRDS-parsed Form 4 tables that DO carry `rptownercik`
(`wrdssec_insiders.table1`, `wrds_insiders.table1`, `wrdssec.table1`
views) are **permission-denied for non-subscribed users** — verify with
`SELECT COUNT(*) FROM wrdssec_insiders.table1`.

WRDS linking tables that do NOT solve this (but are useful for other
studies):
- `wrdsapps_plink_trinsider_ciq.trinsider_ciq_link` (790K rows) — maps
  `tr_personid → ciq_personid` (Capital IQ). NOT SEC CIK.
- `wrdssec.wciklink_{cusip,gvkey,names,ticker}` — ISSUER-level only.
- `wrdsapps_plink_exec_trinsider`, `wrdsapps_plink_boardex_trinsider` —
  exec/director bridges, useful for pay/governance studies.

Workaround in this project: `scripts/bridge_insider_names.py` builds a
`(company_CIK, normalized_name) → blockholder_CIK` dictionary from
Volkova's ~273K individual/other rows (which carry SEC CIKs via her
script-8 SEC own-disp scrape). For each TR add-on row, it normalizes
`owner` and looks up within the same issuer.

Name normalization:
- Uppercase, strip `.,'"()/\`, collapse whitespace
- Drop standalone suffixes: `JR SR II III IV V MD PHD ESQ CPA MR MRS MS DR`
- Scope match by `company_CIK` so common names don't cross companies

**Hit rate on 2019-2024 TR add-on: 65.9% (3,125 / 4,741).** Remaining
1,616 rows receive a synthetic `personid + 1_000_000_000` offset CIK so
they can't collide with real SEC CIKs in downstream joins.

**Volkova-vs-TR universe overlap is LOW** (~17.5% of Volkova's 2020
individual/other rows have a name match in TR Form 3/4/5 for 2020).
Volkova's `individual` category includes 13D/G filers (John Malone,
Glaxo, hedge fund entities) who never filed Form 4 — the bridge can't
help with those. Its practical value is longitudinal continuity: a
person appearing in Volkova 2018 and our TR add-on 2019-2024 gets the
same CIK across both sources.

### 7. CIK padding
WRDS `forms.cik` (and `wrds_forms.cik`) is zero-padded 10-digit; Volkova's CSV is integer. Our port converts via `.str.lstrip('0').replace('','0').astype(int)` before joins.

## Volkova replication fidelity (single-year samples)

Tested on 1998, 2020, 2023, 2024 against the public CSV (filtered to years ±1 to account for year-reassignment):

| Year | n matched | Recall | Precision | Pearson `position` | Pearson (drop >20pp) | Within 1pp | block_type match |
|------|-----------|--------|-----------|--------------------|----------------------|------------|------------------|
| 1998 | 20,893 | 0.512 | 0.960 | 0.970 | — | 0.940 | — |
| 2020 | 19,958 | 0.485 | 0.993 | 0.886 | — | 0.935 | — |
| 2023 | 10,676 | 0.551 | 0.996 | 0.874 | **0.998** | 0.994 | **0.983** |
| 2024 | 10,676 | 0.551 | 0.447 | 0.874 | — | 0.994 | — |

- **Precision** is 96-99% for single-year replication (ignoring the 2024 column, where Volkova's CSV doesn't cover 2024 so our new rows show up as "py-only"). Rows our parser emits are almost always in Volkova's data.
- **Recall** ~50% because of gap-fill and insider add-on (Volkova scripts 7-9). To reach Volkova's full row count we'd need to parse 1993-2023 and apply the gap-fill, plus scrape SEC `own-disp` for insider Form 3/4/5 data.
- **Pearson `position`** is dragged down by ~17 parser outliers (0.16% of matched rows). Dropping them gives 0.998. Median absolute diff on the 2023 match is 0.00.
- **block_type match rate** is 98.3% on 2023 — well above the 95% target.
- Scripts 8-9 (insider add-on) are ported as `aggregate.insider_addon_from_ownership` and `aggregate.merge_insider_addon` but not run end-to-end; the SEC scrape + CRSP MSF panel are prerequisites.

## Extension to 2024+

Volkova's CSV ends in 2023. `wrdssec_all.forms` tracks the EDGAR live index
(typical lag ≤ 3 days) and covers 2024–2025. Our port produces 13,164 rows for
year=2024. Post-Sept-2024 filings use the new SCHEDULE 13D/G XBRL format — the
legacy SGML regex extractors miss those; see `scan_covers` XBRL triple-pattern
fallback (`scripts/scan_covers/` in workflows skill).

## WRDS schema reference

```sql
-- SC 13D/G metadata (DISTINCT collapses multi-CIK rows from `forms`)
SELECT DISTINCT fdate, cik, coname, form, accession, fname
FROM wrdssec_all.forms
WHERE form IN ('SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A')
  AND fdate BETWEEN '2020-01-01' AND '2020-12-31';

-- 13F index for files_13F flag
SELECT DISTINCT cik, EXTRACT(YEAR FROM fdate)::int AS year
FROM wrdssec_all.forms
WHERE form ILIKE '%13F%'
  AND fdate BETWEEN '1993-01-01' AND '2025-12-31';
```

Filing paths: `/wrds/sec/wrds_clean_filings/{parent}/{cik_int}/{accession}.txt`
where `parent = CIK.zfill(10)[:6]`. Each filing contains `<SEC-HEADER>` (filer/subject
blocks with CIK + name) followed by the main document text (already HTML-stripped).

## Anti-patterns

- Don't pull text via SQL — `forms` / `wrds_forms` have no text column, but `wrds_sec_search.filing_*` does; never use them for bulk.
- Don't SEC.gov the filings — rate-limited to 10 req/s; WRDS has them already.
- Don't parse per-filing with `subprocess` — use rclone+tar for bulk, then local parse.
- Don't dedup by `keep="first"` with ascending file_date — you'd keep the **earliest** filing within a year, which can be a stale post-Jan-1 amendment rather than the latest view.
- Don't filter on `block_type == 'institution'` when you need activist vs passive — that bucket collapses 13D and 13G. Use `filing_type == '13D'` or `active_inst == 1` instead.
