---
name: wrds-sge-enforcement
description: WRDS SGE grid job-submission enforcement for the wrds skill
applies-to: [wrds]
---

# WRDS SGE Enforcement

## Rule

**NEVER run compute-intensive work on the WRDS login node.** Always write an SGE array job script and submit via `qsub`.

The login node is shared by all WRDS users. Running parsers, bulk file reads, or any process that takes more than a few seconds will get your account flagged and potentially suspended.

## What counts as compute-intensive

- Any Go/Python binary that processes >100 files
- Bulk file reads from `/wrds/sec/archives/` or `/wrds/sec/wrds_clean_filings/`
- SAS jobs (always use `qsas` or `qsub`)
- Any process expected to run >30 seconds

## What's OK on the login node

- `qsub`, `qstat`, `qdel` (job management)
- `ls`, `head`, `wc -l` (quick file inspection)
- `scp`, `rclone` (file transfer)
- Short `psql` queries (metadata lookups)

## Required pattern

1. Write an SGE submission script (`submit_*.sh`) with `#$ -N`, `#$ -l m_mem_free=`, `#$ -t` for arrays
2. Upload binary + data to WRDS via `scp`
3. Submit via `qsub` from the login node
4. Monitor via `qstat -u $USER`
5. Download results via `scp`

## Existing examples

- `mirror/scripts/bylaw_quorum/submit_quorum.sh` — DEF 14A quorum parser (Go)
- `mirror/scripts/state_incorp_go/submit_state_incorp.sh` — 10-K state of incorporation parser (Go)
- `mirror/sas/run_pipeline.sh` — SAS ETL pipeline

## Red flags — STOP if you're about to

- `ssh wrds 'cat file.tsv | ./my_binary > output.tsv'` → STOP. Use qsub.
- `ssh wrds 'nohup ... &'` → STOP. That's still the login node. Use qsub.
- `ssh wrds 'python3 process_all.py'` → STOP. Use qsub.
- Write a new parser without reading `references/edgar.md` first → STOP. Path conventions are documented.
- Build an index builder without looking at existing `build_index.py` scripts → STOP. Solved problem.

## Iron Law: Read Before Writing

Before writing ANY new WRDS-side code, read:
1. `workflows/skills/wrds/references/edgar.md` — path conventions, SGE patterns
2. Existing parsers in the same project — `bylaw_quorum/`, `state_incorp_go/`
3. Existing submission scripts — `submit_quorum.sh`, `submit_state_incorp.sh`

The `wrds_clean_filings` path is `{cik_int.zfill(10)[:6]}/{cik_int}/{accession}.txt`.
NOT `{accession[:6]}/{cik_int}/...` (this was a real bug that wasted a full run cycle).
