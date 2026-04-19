#!/bin/bash
#$ -N sec_idx
#$ -l m_mem_free=2G
#$ -cwd
#$ -j y
#$ -o /scratch/nyu/eddyhu/sec_index/sge_$TASK_ID.out
#
# submit_array.sh — SGE array wrapper for scan_shard.sh
#
# Submit ALL 164 shards:
#   cd /scratch/nyu/eddyhu/sec_index_rga
#   ls -d /wrds/sec/archives/*/ | sed 's|/wrds/sec/archives/||;s|/$||' | sort > shards.txt
#   qsub -t 1-$(wc -l < shards.txt) submit_array.sh
#
# Submit first 5 shards (validation):
#   qsub -t 1-5 submit_array.sh

set -u

export SHARD_LIST="${SHARD_LIST:-/scratch/nyu/eddyhu/sec_index_rga/shards.txt}"
export OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/sec_index}"
export ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"

mkdir -p "$OUT_DIR"

exec /scratch/nyu/eddyhu/sec_index_rga/bin/scan_shard.sh
