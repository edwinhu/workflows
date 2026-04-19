# scan_covers — SGE deployment (year-sharded)

One SGE array task per calendar year. Each task runs `scan_covers` on a
pre-built filelist of that year's SC 13D/G filings (pulled from
`wrdssec_all.wrds_forms`, deduped by accession) and writes a gzipped TSV.

## Layout on WRDS

```
/scratch/nyu/eddyhu/bin/scan_covers           # linux/amd64 static binary
/scratch/nyu/eddyhu/blockholders_13dg/
├── years.txt                                 # 1994, 1995, …, 2024 (one per line)
├── filelists/YYYY.txt                        # /wrds/sec/wrds_clean_filings/... paths
├── scan_year.sh                              # worker (reads SGE_TASK_ID → year)
├── submit_array.sh                           # SGE submit wrapper
├── out/YYYY.tsv.gz                           # output
└── out/YYYY.log                              # per-year log
```

## Run (from laptop)

```bash
cd ~/projects/workflows/skills/wrds/scripts/scan_covers
bash build.sh                                 # cross-compile Linux binary

pixi run python sge/stage_blockholders.py \
    --start 1994 --end 2024 \
    --step metadata,upload,submit             # stops after qsub

# (wait for SGE)
ssh wrds "qstat | grep bh_scan"

pixi run python sge/stage_blockholders.py --step fetch \
    --local-out ~/projects/mirror/data/raw/blockholders_go
```

Per-step execution (`--step metadata,upload,submit,fetch` in any subset)
makes it easy to iterate on one phase without re-running earlier work.

## Sharding rationale

- Year-sharded because WRDS's 13D/G corpus is ~20K-30K filings/year; each
  task completes in ~10-60s with 32 goroutines against the NFS mount.
- Re-running a single year: `qsub -t N-N submit_array.sh` where N is the
  1-based line number in `years.txt`.
- File-list chunk sharding (e.g. 10K files/task) would be more even but
  adds bookkeeping; year boundaries also align with the downstream
  aggregate.py year loop.

## Correctness

Verified against R ground truth (Volkova scripts 5+6 run directly):
- 2020 corpus (27,404 filings): max_prc 99.04%, item12 99.26% exact agreement
- WRDS-produced TSV is byte-identical to a local build on the same input
