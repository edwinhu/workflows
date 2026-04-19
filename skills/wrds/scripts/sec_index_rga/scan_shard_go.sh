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
#   GO_BIN        — path to scan_shard_go (default: /scratch/nyu/eddyhu/bin/scan_shard_go)
#   GO_CONCURRENCY — worker goroutines (default: $NSLOTS*8, min 16)

set -uo pipefail

SHARD_LIST="${SHARD_LIST:-shards.txt}"
OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/sec_index}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"
GO_BIN="${GO_BIN:-/scratch/nyu/eddyhu/bin/scan_shard_go}"

# Default: 8 goroutines per SGE slot, floor 16 — NFS opens are I/O-bound so
# over-subscription is desirable.
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
