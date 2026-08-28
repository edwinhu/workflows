#!/bin/bash
#$ -N parse_npx
#$ -l m_mem_free=2G
#$ -pe onenode 1
#$ -cwd
#$ -j y
#
# submit_shards.sh — SGE array wrapper for scan_shard.sh.
#
# One slot per task. The XML path streams off a buffered reader rather than
# slurping the filing, so peak RSS tracks the worker count and the decoder
# buffer, not the 200 MB filing.
#
# Submit ALL shards:
#   cd /scratch/nyu/$USER/parse_npx
#   qsub -t 1-$(grep -c '' filelists/shards/chunks.txt) sge/submit_shards.sh
#
# Subset first — always. Eight shards is a short smoke test:
#   qsub -t 1-8 sge/submit_shards.sh
#
# SGE parses #$ directives before the shell runs, so a variable in one is a
# literal. Redirect logs with `qsub -o <dir>` rather than editing the block
# above.

set -u

export PARSE_NPX_ROOT="${PARSE_NPX_ROOT:-/scratch/${WRDS_INST:-nyu}/$(whoami)/parse_npx}"
export SHARD_LIST="${SHARD_LIST:-$PARSE_NPX_ROOT/filelists/shards/chunks.txt}"
export SHARD_DIR="${SHARD_DIR:-$PARSE_NPX_ROOT/filelists/shards}"
export OUT_DIR="${OUT_DIR:-$PARSE_NPX_ROOT/out}"
export BIN="${BIN:-$PARSE_NPX_ROOT/bin/parse_npx_go}"
export ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"

mkdir -p "$OUT_DIR"

exec "$PARSE_NPX_ROOT/sge/scan_shard.sh"
