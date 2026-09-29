#!/bin/bash
#$ -N def14a_own
#$ -l m_mem_free=16G
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
# 16G / concurrency 4 since 2026-09-29, when the fixed full-archive sample joined
# the round filelist: the sample reaches into 2023-2026 and carries filings up to
# 151.7 MB, and x/net/html builds a DOM several times the source size. The old
# 4G with the default concurrency (NSLOTS*8 = 8) would run eight of those at once.
export CONCURRENCY="${CONCURRENCY:-4}"

mkdir -p "$OUT_DIR" "$DEF14A_ROOT/logs"

exec "$DEF14A_ROOT/sge/scan_shard.sh"
