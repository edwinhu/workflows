#!/bin/bash
#$ -N pa_scan
#$ -l m_mem_free=2G
#$ -cwd
#$ -j y
#$ -o /scratch/nyu/eddyhu/proxy_advisors/sge_$TASK_ID.out
#
# submit_array_proxy_advisors.sh — SGE array wrapper for scan_year.sh
# specialized for the proxy_advisors profile.
#
# Submit ALL years in years.txt:
#   cd /scratch/nyu/eddyhu/proxy_advisors
#   qsub -t 1-$(wc -l < years.txt) submit_array_proxy_advisors.sh
#
# Single year (re-run):
#   qsub -t 5-5 submit_array_proxy_advisors.sh
#
# FullBody mode reads whole 485 filings (1–5 MB). 2 GB mem_free is plenty
# (peak per-worker is ~5 MB × concurrency, well under 2 GB).

set -u

export YEARS_LIST="${YEARS_LIST:-/scratch/nyu/eddyhu/proxy_advisors/years.txt}"
export FILELIST_DIR="${FILELIST_DIR:-/scratch/nyu/eddyhu/proxy_advisors/filelists}"
export OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/proxy_advisors/out}"
export BIN="${BIN:-/scratch/nyu/eddyhu/bin/scan_covers}"
export PROFILE="${PROFILE:-proxy_advisors}"

mkdir -p "$OUT_DIR"

exec /scratch/nyu/eddyhu/proxy_advisors/scan_year.sh
