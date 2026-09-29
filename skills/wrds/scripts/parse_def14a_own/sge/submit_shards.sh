#!/bin/bash
#$ -N def14a_own
#$ -l m_mem_free=4G
#$ -pe onenode 1
#$ -cwd
#$ -j y
#$ -o /scratch/nyu/eddyhu/parse_def14a_own/logs/sge_$TASK_ID.out
#
# submit_shards.sh — SGE array wrapper for scan_shard.sh.
#
# Submit ALL shards:
#   cd /scratch/nyu/eddyhu/parse_def14a_own
#   qsub -t 1-$(wc -l < filelists/shards/chunks.txt) sge/submit_shards.sh
#
# Subset (always do this first):
#   qsub -t 1-1 sge/submit_shards.sh
#
# Only ten slots per user are schedulable in all.q, so the array self-throttles
# to ten concurrent tasks no matter how many are submitted.

set -u

export DEF14A_ROOT="${DEF14A_ROOT:-/scratch/nyu/eddyhu/parse_def14a_own}"
export SHARD_LIST="${SHARD_LIST:-$DEF14A_ROOT/filelists/shards/chunks.txt}"
export SHARD_DIR="${SHARD_DIR:-$DEF14A_ROOT/filelists/shards}"
export OUT_DIR="${OUT_DIR:-$DEF14A_ROOT/out}"
export BIN="${BIN:-$DEF14A_ROOT/bin/parse_def14a_own_go}"
export ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"

mkdir -p "$OUT_DIR" "$DEF14A_ROOT/logs"

exec "$DEF14A_ROOT/sge/scan_shard.sh"
