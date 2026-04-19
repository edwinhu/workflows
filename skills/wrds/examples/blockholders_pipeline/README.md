# Blockholder ETL Pipeline (13D/13G → Volkova Panel)

End-to-end Python replication of Ekaterina Volkova's blockholder panel
(R source: https://github.com/volkovacodes/Block_Codes). Produces one row
per `(company_CIK, blockholder_CIK, year)` with position %, `filing_type`
(13D/13G), and Volkova's 4 mutually-exclusive flags (`individual`,
`active_inst`, `passive_inst`, `other`).

Full reference: `../references/blockholders.md`.

## Pipeline shape

```
  WRDS SQL (metadata)                    Bash (tar+rclone)
  wrdssec_all.wrds_forms                 /wrds/sec/wrds_clean_filings
         │                                         │
         └────────→  files_from.txt  ──────────────┘
                          │
                          ▼
                    local .txt files
                          │
                          ▼  src/parser.py (ProcessPool, ~1200 filings/sec)
                    parsed.parquet
                          │
                          ▼  src/aggregate.py:build_panel
              assign_year → dedup (latest) → gap_fill → 13F flag
                          │
                          ▼  classify_block_type
              filing_type + individual/active_inst/passive_inst/other
                          │
                          ▼
                    blockholders_panel.parquet
                          │
                          ▼  (optional) redo_bridge.py
              + insider add-on (Form 3/4/5 via TR) with TF-IDF name bridge
                          │
                          ▼
                    blockholders_final.parquet
```

## Files

| Path | Purpose |
|------|---------|
| `pull_blockholders.py` | Driver: query metadata, rclone bulk pull, parse, aggregate. `--work-dir data/raw/blockholders/{year}` |
| `src/parser.py` | SGML header + SC 13D/G body parser. Extracts filer/subject CIKs, item12, max_prc, cusip6 |
| `src/aggregate.py` | Volkova scripts 7-9 port. `build_panel`, `find_blocks`, `compute_insider_addon`, `merge_insider_addon` |
| `redo_bridge.py` | Merges insider add-on into the panel and bridges TR `personid` → SEC `rptOwnerCik` (F4 + Volkova name + TF-IDF fuzzy, 97.4% hit rate) |

**Upstream dependency — Form 4 insider add-on**: `redo_bridge.py` consumes
two artifacts produced by the Form 4 pipeline
(`../form4_pipeline/`):
- `tr_insider_panel.parquet` — annualized % ownership per (cusip6,
  personid, year), built by `sas/pull_tr_insiders.sas` on the WRDS grid.
- `form4_owner_bridge.parquet` — `(issuer_cik, rpt_owner_name) →
  rpt_owner_cik` lookup, built by `form4_step1/2/3_*.{py,sh}` from SEC
  EDGAR Form 4 XMLs.

Run the Form 4 pipeline first; see its README for commands.

## Output schema

```
blockholder_CIK (int)    blockholder_name (str)
company_CIK (int)        company_name (str)
year (int)               position (float, % owned)
block_type (str)         ∈ {individual, institution, other}  — back-compat collapse
files_13F (int)          1 if filer filed 13F in same year
filing_type (str)        ∈ {13D, 13G, NA}                    — from retained filing's form_type
individual (int8)        item12 == "in"
active_inst (int8)       13D filer & files_13F & not individual
passive_inst (int8)      13G filer & files_13F & not individual
other (int8)             1 - individual - active_inst - passive_inst
```

**Use the 4 flags, not `block_type`**, if you need 13D (activist) vs 13G
(passive) — `block_type` collapses them into `institution`.

## Run

```bash
# 1. Per-year (small memory, 5-10 min each)
pixi run python pull_blockholders.py \
    --start 2020-01-01 --end 2020-12-31 \
    --work-dir data/raw/blockholders/2020 \
    --out     data/processed/blockholders_2020.parquet

# 2. Full corpus: loop years, concat, bridge
for Y in $(seq 1994 2024); do
  pixi run python pull_blockholders.py \
    --start ${Y}-01-01 --end ${Y}-12-31 \
    --work-dir data/raw/blockholders/${Y} \
    --out     data/processed/blockholders_${Y}.parquet
done

pixi run python -c "
import pandas as pd, glob
pd.concat([pd.read_parquet(f) for f in sorted(glob.glob('data/processed/blockholders_*.parquet'))],
          ignore_index=True).to_parquet('data/processed/blockholders_panel.parquet')
"

# 3. (Optional) Merge insider add-on into panel
#    Prereq: run ../form4_pipeline/ to produce tr_insider_panel.parquet
#    and form4_owner_bridge.parquet.
pixi run python redo_bridge.py
```

## Key design choices

1. **Metadata via SQL, text via rclone+tar.** Never pull filing text
   through the WRDS SQL connection — `wrds_forms` carries paths only.
   Tar server-side, rclone the tar back, parse locally.
2. **ProcessPool for parsing.** Regex-heavy + GIL-bound → processes, not
   threads. `chunksize=256` keeps queue hot.
3. **Dedup rule mirrors R exactly.** `sort([fil, sbj, year, file_date],
   ascending=[T,T,T,F])` + `keep='first'` = latest filing wins,
   including `/A` amendments.
4. **Gap-fill is optional.** `--skip-gap-fill` shuts off Volkova's 2/3/4
   year forward-fill. The full panel's row count roughly doubles with
   gap-fill; disable if you want filings-only rows.
5. **`filing_type` derived post-dedup.** The retained row's `form_type`
   decides `active_inst`/`passive_inst`, so a filer who switched 13G→13D
   mid-year ends up `active_inst=1` (R source behavior).
6. **Insider add-on is produced by the Form 4 pipeline.** Annualization
   (`tr_insiders → prc_own`) and the `personid → rpt_owner_cik` bridge
   are both Form 4 concerns; see `../form4_pipeline/`. `redo_bridge.py`
   just merges those artifacts into this panel. Add-on rows default to
   `individual=1`, `filing_type=NA`.

## Performance

| Stage | Time (single year, ~70K filings) |
|-------|----------------------------------|
| SQL metadata query | 3-5s |
| Server-side tar | 30-60s |
| rclone pull | 20-40s (~70 MB) |
| Parse (15 cores) | 45-60s |
| Aggregate + 13F join | <5s |
| **Total** | **2-3 min** |

## Anti-patterns

- Don't `SELECT text FROM …` on WRDS filings — no text column; paths only.
- Don't `scp` per-filing — always tar first, even for 1K files.
- Don't `keep='first'` with ascending date — you'll keep the earliest
  (often stale) filing, not the latest amendment.
- Don't filter by `block_type == 'institution'` for activism studies —
  use `active_inst == 1` or `filing_type == '13D'`.
