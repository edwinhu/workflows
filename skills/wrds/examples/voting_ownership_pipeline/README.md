# ISS Voting + Institutional/Mutual Fund Ownership Pipeline

All-SAS pipeline for building a meeting-level panel with proxy voting outcomes and ownership data. Runs on WRDS SGE grid with maximum parallelism.

## Architecture

```
Step 1 (all parallel):
┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  ┌───────────────┐
│ build_meetings  │  │ build_inst_own   │  │ build_mflinks  │  │   split_s12   │
│    (~12 sec)    │  │    (~3 min)      │  │    (~1 min)    │  │   (~15 min)   │
└────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │ (PG read →   │
         │                    │                    │           │  /scratch)    │
         │                    │                    │           └──────┬────────┘
         │                    │                    └─────┬────────────┘
         │                    │                          │
         │                    │         ┌────────────────▼───────────────────┐
         │                    │         │ tfn_holdings_parallel.sas ×9      │
         │                    │         │ (reads /scratch, zero contention) │
         │                    │         │      (~5 min each)               │
         │                    │         └────────────────┬──────────────────┘
         │                    │                          │
         └────────────────────┼──────────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │   merge_panel.sas   │
                   │  (MERGE_ASOF all)   │
                   │     (~5 sec)        │
                   └─────────────────────┘

Total wall time: ~20 min
```

## Files

| File | Language | Purpose |
|------|----------|---------|
| `run_pipeline.sh` | bash | SGE orchestration — submits all jobs with hold_jid dependencies |
| `run_sas.sh` | bash | SGE wrapper for SAS scripts (supports -sysparm) |
| `build_meetings.sas` | SAS | ISS vote results → turnout/forpct → CRSP permno + CIK → out.meetings |
| `build_inst_own.sas` | SAS | S34 13-F → cfacshr adjustment → IO metrics (DBREADTH, HHI, AUM) → out.inst_own |
| `build_mflinks.sas` | SAS | Build mfl2/mfl3 prereqs for TFN jobs |
| `split_s12.sas` | SAS | Read S12 via PostgreSQL, write year-range partitions to /scratch |
| `tfn_holdings_parallel.sas` | SAS | Partitioned S12 → MFLINKS → CUSIP→PERMNO → TSO → aggregate → out.mf_own_YYYY_YYYY |
| `merge_panel.sas` | SAS | Concatenate MF chunks + MERGE_ASOF all inputs → out.pass |

### Python alternatives (kept for reference)

| File | Purpose |
|------|---------|
| `build_votes.py` | PostgreSQL version of build_meetings (simpler, fewer variables) |
| `build_inst_own.py` | PostgreSQL version of build_inst_own (no DBREADTH/HHI/AUM) |
| `merge_panel.py` | pandas merge_asof version (parquet I/O) |
| `sas_to_parquet.py` | Concat SAS outputs to parquet (only needed for Python merge) |
| `run_python.sh` | SGE wrapper for Python (unbuffered output) |
| `run_mflinks.sh` | Legacy SGE wrapper for mflinks |

## Usage

```bash
# Copy to WRDS project directory
scp -r voting_ownership_pipeline/* wrds:~/projects/myproject/

# Ensure autoexec.sas is set up with libnames (out, tfn, crsp, mfl, risk, wrdssec)
# And ~/sas/MERGE_ASOF.sas exists

# Run the full pipeline
ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh"

# Monitor
ssh wrds "qstat -u $USER"
```

## Key Design Decisions

1. **All SAS for data building.** SAS streams from disk (no memory management), the crspmerge macro handles CRSP extraction reliably, and the original logic includes cfacshr share adjustment, DBREADTH (Lehavy & Sloan 2008), and IOC_HHI that the Python versions omitted.

2. **SAS aggregates before merge.** The TFN script does CUSIP→PERMNO mapping, TSO joins, and permno-quarter aggregation. Output is ~50K rows per chunk, not millions of raw holdings.

3. **PostgreSQL for large NFS reads.** `tfn.s12` (44GB SAS file on NFS) causes severe I/O contention when read by multiple parallel jobs (~40 min each vs ~5 min solo). `split_s12.sas` reads it once via WRDS PostgreSQL (`tr_mutualfunds.s12`), writing year-range partitions (~40GB total) to `/scratch`. Each TFN job then reads its own partition with zero contention. Note: WRDS PostgreSQL schema names differ from SAS libnames (`tfn.s12` → `tr_mutualfunds.s12`, `tfn.s34` → `tr_13f.s34`).

4. **Year ranges balanced by row count.** S12 data exploded from ~4M rows/year (2003-2016) to ~20-26M rows/year (2018-2024). Ranges are sized so each chunk is ~22-34M rows: early years get 6-8 year ranges, recent years get 1 year each.

5. **Shell wrappers for all qsub jobs.** Always use `.sh` with `#$ -cwd`, never `qsub -b y sas script.sas`.

6. **Maximum parallelism.** meetings, inst_own, mflinks, and split_s12 all start simultaneously. TFN holdings (9 jobs) start after mflinks + split_s12 finish. Merge waits for everything.

## Customization

- **Date range:** Edit `%let year1/year2` in each SAS script, year ranges in `split_s12.sas`, and `YEAR_RANGES` in `run_pipeline.sh`
- **Output library:** Controlled by `autoexec.sas` (libname `out`)
- **Additional ownership variables:** Edit the aggregation step in `tfn_holdings_parallel.sas`
- **MERGE_ASOF path:** Edit the `%INCLUDE` in `merge_panel.sas`
