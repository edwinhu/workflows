#!/bin/bash
#$ -N bh_scan
#$ -l m_mem_free=2G
#$ -cwd
#$ -j y
#$ -o /scratch/nyu/eddyhu/blockholders_13dg/sge_$TASK_ID.out
#
# submit_array.sh — SGE array wrapper for scan_year.sh.
#
# Submit ALL years in years.txt:
#   cd /scratch/nyu/eddyhu/blockholders_13dg
#   qsub -t 1-$(wc -l < years.txt) submit_array.sh
#
# Single year (re-run) :
#   qsub -t 5-5 submit_array.sh        # 5th line in years.txt
#
# Subset:
#   qsub -t 25-31 submit_array.sh

set -u

export YEARS_LIST="${YEARS_LIST:-/scratch/nyu/eddyhu/blockholders_13dg/years.txt}"
export FILELIST_DIR="${FILELIST_DIR:-/scratch/nyu/eddyhu/blockholders_13dg/filelists}"
export OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/blockholders_13dg/out}"
export BIN="${BIN:-/scratch/nyu/eddyhu/bin/scan_covers}"
export PROFILE="${PROFILE:-blockholders_13dg}"

mkdir -p "$OUT_DIR"

exec /scratch/nyu/eddyhu/blockholders_13dg/scan_year.sh
