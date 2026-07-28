#!/bin/bash
#$ -N sec_idx
#$ -l m_mem_free=2G
#$ -cwd
#$ -j y
#$ -o logs/
#
# submit_array.sh — SGE array wrapper for scan_shard.sh
#
# PATHS. Nothing here names a user or an institution. The scratch root is
# derived, and every consumer honours an override:
#
#   WRDS_SCRATCH   root for shard list, binaries and output
#                  (default: /scratch/${WRDS_INST:-nyu}/$(whoami))
#   SHARD_LIST     shard list file      (default: $WRDS_SCRATCH/sec_index/shards.txt)
#   OUT_DIR        gzipped TSV output   (default: $WRDS_SCRATCH/sec_index)
#   SCAN_BIN       scanner to exec      (default: $WRDS_SCRATCH/sec_index/bin/scan_shard_go.sh)
#                  Set SCAN_BIN=.../scan_shard.sh for the awk fallback (26x slower).
#   ARCHIVE_ROOT   EDGAR archive root   (default: /wrds/sec/archives)
#
# `#$ -o logs/` is relative to -cwd on purpose: SGE parses the `#$` block
# BEFORE the shell runs, so a ${VAR} in that directive is a literal, not an
# expansion. A user-specific absolute path there is therefore NOT fixable by
# environment — it would keep writing into one account's scratch no matter who
# submitted. Override at submit time with `qsub -o <dir>` if you want it
# elsewhere.
#
# Submit ALL 164 shards:
#   cd "$WRDS_SCRATCH/sec_index" && mkdir -p logs
#   ls -d /wrds/sec/archives/*/ | sed 's|/wrds/sec/archives/||;s|/$||' | sort > shards.txt
#   qsub -t 1-$(wc -l < shards.txt) submit_array.sh
#
# Submit first 5 shards (validation):
#   qsub -t 1-5 submit_array.sh

set -u

WRDS_SCRATCH="${WRDS_SCRATCH:-/scratch/${WRDS_INST:-nyu}/$(whoami)}"

export SHARD_LIST="${SHARD_LIST:-$WRDS_SCRATCH/sec_index/shards.txt}"
export OUT_DIR="${OUT_DIR:-$WRDS_SCRATCH/sec_index}"
export ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
# THE GO SCANNER IS THE DEFAULT. references/edgar.md has said "Use the Go
# scanner (recommended)" since it was measured at 22s/shard against awk's 583s,
# but this wrapper still exec'd the awk baseline — so the documented
# recommendation and the thing that actually ran disagreed by 26x, and every
# full 164-shard run took the slow path unless someone set SCAN_BIN by hand.
SCAN_BIN="${SCAN_BIN:-$WRDS_SCRATCH/sec_index/bin/scan_shard_go.sh}"

mkdir -p "$OUT_DIR" logs

exec "$SCAN_BIN"
