#!/bin/bash
#
# scan_shard_go.sh — Variant B wrapper.
#
# Invokes a pre-built Go helper (scan_shard_go) that walks the shard with a
# goroutine pool and writes TSV rows to stdout. Output is gzipped to match
# the baseline scan_shard.sh contract.
#
# Environment:
#   SGE_TASK_ID, SHARD_LIST, OUT_DIR, ARCHIVE_ROOT  — same as baseline
#   WRDS_SCRATCH  — scratch root (default: /scratch/${WRDS_INST:-nyu}/$(whoami))
#   GO_BIN        — path to scan_shard_go (default: $WRDS_SCRATCH/bin/scan_shard_go)
#   GO_CONCURRENCY — worker goroutines (default: $NSLOTS*8, min 16)

set -uo pipefail

WRDS_SCRATCH="${WRDS_SCRATCH:-/scratch/${WRDS_INST:-nyu}/$(whoami)}"
SHARD_LIST="${SHARD_LIST:-shards.txt}"
OUT_DIR="${OUT_DIR:-$WRDS_SCRATCH/sec_index}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"
GO_BIN="${GO_BIN:-$WRDS_SCRATCH/bin/scan_shard_go}"

# THE WORKLOAD IS I/O-BOUND, NOT CPU-BOUND. This comment previously claimed the
# opposite ("Go regex parsing is CPU-bound ... goroutine count barely matters,
# NFS is not the bottleneck"), which contradicted this skill's OWN measurements
# in references/edgar.md §Benchmarks: on shard 000000 (219,196 files) the Go
# helper used 28 s CPU against awk's 68 s CPU, yet ran 22 s wall against 583 s.
# CPU was never the constraint; the 26x win is entirely concurrent NFS opens
# overlapping per-file open latency. Two knobs, two different jobs:
#
#   GOMAXPROCS      OS threads. Pinned to the slot allocation for GRID
#                   CITIZENSHIP: Go otherwise sizes its P count from the HOST's
#                   core count, so a 2-slot job on a 64-core node spawns 64
#                   threads and takes cores the scheduler promised other jobs.
#                   It is NOT the throughput lever here.
#   GO_CONCURRENCY  goroutines. THIS is the throughput lever. Over-subscribing
#                   past the CPU count is deliberate and helps, because the
#                   goroutines are parked on NFS opens, not computing.
export GOMAXPROCS="${NSLOTS:-2}"

_default_concurrency=$(( ${NSLOTS:-2} * 8 ))
if (( _default_concurrency < 16 )); then _default_concurrency=16; fi
GO_CONCURRENCY="${GO_CONCURRENCY:-$_default_concurrency}"

mkdir -p "$OUT_DIR"

SHARD=$(sed -n "${TASK_ID}p" "$SHARD_LIST")
if [[ -z "$SHARD" ]]; then
    echo "ERROR: no shard at line $TASK_ID of $SHARD_LIST" >&2
    exit 2
fi

SHARD_DIR="$ARCHIVE_ROOT/$SHARD"
OUT_FILE="$OUT_DIR/shard_$(printf '%04d' "$TASK_ID").tsv.gz"
LOG_FILE="$OUT_DIR/shard_$(printf '%04d' "$TASK_ID").log"

echo "[scan_shard_go] task=$TASK_ID shard=$SHARD out=$OUT_FILE concurrency=$GO_CONCURRENCY start=$(date -Is)" >"$LOG_FILE"

if [[ ! -x "$GO_BIN" ]]; then
    echo "ERROR: go binary missing or not executable: $GO_BIN" >>"$LOG_FILE"
    exit 3
fi
if [[ ! -d "$SHARD_DIR" ]]; then
    echo "ERROR: shard dir missing: $SHARD_DIR" >>"$LOG_FILE"
    : | gzip >"$OUT_FILE"
    exit 0
fi

"$GO_BIN" -shard "$SHARD_DIR" -concurrency "$GO_CONCURRENCY" | gzip >"$OUT_FILE"

STATUS=${PIPESTATUS[0]}
ROWS=$(gzip -dc "$OUT_FILE" | wc -l)
echo "[scan_shard_go] task=$TASK_ID status=$STATUS rows=$ROWS end=$(date -Is)" >>"$LOG_FILE"
exit 0
