# Form 3/4/5 ETL Pipeline (TR Insiders + SEC Bridge)

Two parallel Form 4 pipelines that solve different problems:

1. **Annualized ownership panel (SAS)** — `tr_insiders.table1` → `prc_own`
   aggregated per `(cusip6, personid, year)`. Used as the insider add-on
   to the blockholder 13D/G panel (Volkova script 8).
2. **TR-to-SEC CIK bridge (Python)** — Thomson's `personid` has no SEC
   Owner CIK. Parse Form 4 XMLs from SEC EDGAR to build a
   `(issuer_cik, norm_name) → rpt_owner_cik` lookup so the add-on panel
   can be joined with SEC-native filings.

Reference: `../../references/insider-form4.md` (TR schema, rolecodes,
transaction codes).

## Files

| Path | Purpose |
|------|---------|
| `sas/pull_tr_insiders.sas` | Server-side annualization. Hash-joins TR Form 3/4/5 ↔ CRSP SHROUT, computes `prc_own = 100 * sharesheld / (1000 * shrout)`, keeps `max(prc_own)` per (cusip6, personid, year). One year per invocation via `-sysparm`. |
| `sas/run_insider_array.sh` | SGE array wrapper: `#$ -t 1994-2024`, 31 year-tasks parallel. |
| `pull_insider_ownership.py` | Python alternative to the SAS path. Interactive, asyncio-free, year-chunked SQL. Practical for 5-year windows. |
| `form4_step1_query_filings.py` | Query `wrdssec_all.wrds_forms` for all Form 3/4/5 XMLs per issuer in the bridge window. Writes `files_from.txt` for rclone. |
| `form4_step2_download_xmls.sh` | Bash: scp files_from.txt to WRDS, tar server-side, rclone back, extract. |
| `form4_step3_parse_xmls.py` | Parse XML, extract `(issuer_cik, rpt_owner_cik, rpt_owner_name)`, build `form4_owner_bridge.parquet`. |

## When to use which

| Goal | Pipeline |
|------|----------|
| Annualized % ownership per insider per issuer per year | SAS (`pull_tr_insiders.sas`) for full history, Python (`pull_insider_ownership.py`) for 5-year slices |
| Which SEC rptOwnerCik maps to TR personid X? | Python bridge (`form4_step1/2/3`), then `scripts/redo_bridge.py` in blockholders_pipeline |
| Individual transactions (trade-level analysis) | Query `tr_insiders.table1` directly — see `../form4_disposals.py` |

## Pipeline shape

### Path A — SAS annualization (full history, ~600K rows output)

```
           WRDS grid (SAS)
           ───────────────
tr_insiders.table1  (400M+ rows)
     │
     └─ formtype IN ('3','4','5') & sectitle='COM' & cusip6 ∈ whitelist
     │
     ▼
   hash-join crsp.msf on (permno, year_month)
     │
     ▼
   prc_own = 100 * sharesheld / (1000 * shrout)
   max(prc_own) per (cusip6, personid, year), WHERE max_prc > 5
     │
     ▼
   out.tr_insider_panel_{year}  (~20K rows/year)
     │
     ▼  rclone copy
   data/processed/tr_insider_panel.parquet
```

### Path B — SEC XML bridge (personid ↔ rpt_owner_cik)

```
  step 1 (Python SQL)                  step 2 (bash)              step 3 (Python)
  ───────────────────                  ──────────                 ──────────────
wrdssec_all.wrds_forms   ──→  files_from.txt  ──→  tar+rclone  ──→  XML parse
  form IN ('3','4','5')         (~540K filings)     (~500 MB)        lxml + regex
  issuer_cik IN universe                                                │
                                                                         ▼
                                                form4_owner_bridge.parquet
                                             (issuer_cik, rpt_owner_cik,
                                                rpt_owner_name)
```

## Run

### SAS annualization (WRDS grid)

```bash
# upload SAS scripts once
scp sas/*.sas sas/run_insider_array.sh wrds:~/sas/

# launch year-parallel array (31 tasks, ~8G each)
ssh wrds "cd ~/sas && qsub run_insider_array.sh"

# monitor
ssh wrds "qstat -u \$USER"

# after all 31 tasks complete, stitch + ship back
ssh wrds "cd ~/sas && sas stack_insider_panel.sas"   # user-provided stitcher
rclone copy wrds:~/sas/out/tr_insider_panel.sas7bdat data/processed/
```

### Python annualization (interactive, 5-year windows)

```bash
pixi run python pull_insider_ownership.py \
    --start 2019 --end 2024 \
    --out data/processed/tr_insider_2019_2024.parquet
```

### Python XML bridge

```bash
# 1. Query SEC EDGAR Form 3/4/5 filenames for relevant issuers
pixi run python form4_step1_query_filings.py \
    --start 2019 --end 2024 \
    --out data/raw/form4_xmls/files_from.txt

# 2. Server-side tar + rclone back + extract (~500 MB)
bash form4_step2_download_xmls.sh \
    data/raw/form4_xmls/files_from.txt \
    data/raw/form4_xmls/

# 3. Parse XMLs → bridge table (~76K unique pairs from 540K filings)
pixi run python form4_step3_parse_xmls.py \
    --in  data/raw/form4_xmls/ \
    --out data/processed/form4_owner_bridge.parquet
```

## Key design choices

1. **SAS for annualization, Python for bridging.** `tr_insiders.table1`
   is 400M+ rows / 5.5 GB. Shipping raw to Python is hours of wire and
   Parquet conversion; SAS hash-joins CRSP SHROUT in-place and emits a
   ~600K-row panel. Python is fine for 5-year slices (1.7M rows in 22s)
   but SAS is the right tool for the full 1994-2024 history.
2. **Range-filter `fdate`, don't call `year(fdate)`.** WRDS indexes on
   fdate; `year(fdate) = 2020` forces a full table scan. Always
   `fdate BETWEEN '2020-01-01' AND '2020-12-31'`.
3. **TR `fdate` ≠ SEC `fdate` for the bridge.** They differ by 1-3 days
   for after-hours filings. Don't try to join on fdate — pull ALL
   Form 3/4/5 for candidate issuers in the window and parse broadly.
   See `form4_step1_query_filings.py` for the wide-pull rationale.
4. **`personid` has NO SEC Owner CIK in any public WRDS table.**
   The linking tables (`wrdsapps_plink_trinsider_ciq`, etc.) map to
   Capital IQ / ExecuComp IDs, not SEC CIK. The XML bridge is the only
   path, short of subscribing to `wrdssec_insiders.table1` (permission-
   denied for most subscriptions).

## Performance

| Stage | Time |
|-------|------|
| SAS one-year annualization (WRDS grid) | 2-4 min |
| SAS full 31-year array | ~15 min wall (parallel) |
| Python annualization (5 years, cusip6 whitelist) | ~22s |
| Form 4 XML query (step 1) | 30s |
| Form 4 XML tar + rclone (step 2) | 5-10 min (~500 MB) |
| Form 4 XML parse (step 3, 540K files, 15 cores) | 6-8 min |

## Anti-patterns

- Don't pull `tr_insiders.table1` raw to Python for the full history —
  you'll wait hours and fill disk. Use SAS.
- Don't try to join TR `fdate` to SEC `wrds_forms.fdate` exactly —
  off-by-one to off-by-three is normal. Pull wide, parse, let the
  bridge be issuer+name-scoped.
- Don't assume `wrdssec_insiders.table1` is available — most
  subscriptions get permission denied. Verify with `SELECT COUNT(*)`.
- Don't use `trandate` for annualization — Volkova uses filing date
  effectively (via the year-month CRSP SHROUT join on transaction date).
  Transaction date and filing date can straddle year boundaries.
