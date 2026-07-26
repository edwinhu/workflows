#!/bin/bash
#$ -N parse_13f
#$ -l m_mem_free=2G
#$ -pe onenode 1
#$ -cwd
#$ -j y
#$ -o /scratch/nyu/hue/parse_13f/sge_$TASK_ID.out
#
# submit_shards.sh — SGE array wrapper for scan_shard.sh.
#
# One slot per task, and m_mem_free=2G rather than 4G: peak RSS at
# GOMAXPROCS=1 measured 454 MB (1.0 GB at four slots, 1.2 GB at eight), so 4 G
# was over-reserving by ~8x and only made the tasks harder to schedule.
#
# Submit ALL shards:
#   cd /scratch/nyu/hue/parse_13f
#   qsub -t 1-$(wc -l < filelists/shards/chunks.txt) sge/submit_shards.sh
#
# Subset (always do this first — 8 shards is a ~2 minute smoke test):
#   qsub -t 1-8 sge/submit_shards.sh
#
# Only ten slots per user are schedulable in all.q, so the array self-throttles
# to ten concurrent tasks no matter how many are submitted.

set -u

export PARSE13F_ROOT="${PARSE13F_ROOT:-/scratch/nyu/hue/parse_13f}"
export SHARD_LIST="${SHARD_LIST:-$PARSE13F_ROOT/filelists/shards/chunks.txt}"
export SHARD_DIR="${SHARD_DIR:-$PARSE13F_ROOT/filelists/shards}"
export OUT_DIR="${OUT_DIR:-$PARSE13F_ROOT/out}"
export BIN="${BIN:-$PARSE13F_ROOT/bin/parse_13f_go}"
export ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"

mkdir -p "$OUT_DIR"

exec "$PARSE13F_ROOT/sge/scan_shard.sh"
