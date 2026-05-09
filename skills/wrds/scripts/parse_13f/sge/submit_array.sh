#!/bin/bash
#$ -N parse_13f
#$ -l m_mem_free=4G
#$ -cwd
#$ -j y
#$ -o /scratch/nyu/eddyhu/parse_13f/sge_$TASK_ID.out
#
# submit_array.sh — SGE array wrapper for scan_quarter.sh.
#
# Submit ALL quarters:
#   cd /scratch/nyu/eddyhu/parse_13f
#   qsub -t 1-$(wc -l < filelists/buckets.txt) sge/submit_array.sh
#
# Single quarter (re-run):
#   qsub -t 5-5 sge/submit_array.sh     # 5th line in buckets.txt
#
# Subset:
#   qsub -t 1-4 sge/submit_array.sh     # first 4 quarters (dry-run)

set -u

export BUCKETS_LIST="${BUCKETS_LIST:-/scratch/nyu/eddyhu/parse_13f/filelists/buckets.txt}"
export FILELIST_DIR="${FILELIST_DIR:-/scratch/nyu/eddyhu/parse_13f/filelists}"
export OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/parse_13f/out}"
export BIN="${BIN:-/scratch/nyu/eddyhu/bin/parse_13f_go}"
export ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"

mkdir -p "$OUT_DIR"

exec /scratch/nyu/eddyhu/parse_13f/sge/scan_quarter.sh
