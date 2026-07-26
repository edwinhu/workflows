#!/bin/bash
#
# scan_shard.sh — SGE worker for parse_13f_go, one byte-balanced shard per task.
#
# Replaces the one-task-per-quarter, four-slots-per-task shape of
# scan_quarter.sh. Both numbers were wrong for this grid; see MEASURED below.
#
# Environment (all overridable):
#   SGE_TASK_ID    required — row index into SHARD_LIST (1-based)
#   SHARD_LIST     default: $ROOT/filelists/shards/chunks.txt
#   SHARD_DIR      default: $ROOT/filelists/shards
#                  expects per-shard files named "chunk_${SHARD_ID}.txt"
#   OUT_DIR        default: $ROOT/out
#   BIN            default: $ROOT/bin/parse_13f_go
#   ARCHIVE_ROOT   default: /wrds/sec/archives
#   CONCURRENCY    default: NSLOTS*8 (floor 8)
#
# MEASURED on wrds-cloud (2026-07-25, 2024Q2, 8,114 filings, 1.44 GB):
#
#   slots  wall     filings/s  filings/s/slot  cpu/wall
#       1  90.9 s        89.3            89.3      0.94
#       2  54.4 s       149.3            74.6      1.78
#       4  27.9 s       291.2            72.8      3.56
#       8  17.5 s       462.7            57.8      5.94
#
# Per-SLOT throughput is highest at ONE slot and decays to 65% of that by
# eight, because ~8% of the work is serial (the single gzip writer goroutine —
# compress/flate was 9.2% of CPU samples). The binding constraint on this grid
# is an RQS cap of 10 slots per user in all.q, so the throughput-maximising
# shape is ten 1-slot tasks, not two 4-slot ones. `qsub -pe onenode N` also
# rejects N > 8, and ssdwork.q is blocked by the server JSV, so all.q's 10
# slots is the whole budget.
#
# There is no rclone staging stage and there should not be: /wrds/sec/archives
# is mounted directly on the compute nodes. Reading it in place is the fused
# design and copying first would only add a pass over 45 GB.

set -uo pipefail

ROOT="${PARSE13F_ROOT:-/scratch/nyu/hue/parse_13f}"
SHARD_LIST="${SHARD_LIST:-$ROOT/filelists/shards/chunks.txt}"
SHARD_DIR="${SHARD_DIR:-$ROOT/filelists/shards}"
OUT_DIR="${OUT_DIR:-$ROOT/out}"
BIN="${BIN:-$ROOT/bin/parse_13f_go}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"

# Go regex/XML parsing is CPU-bound: GOMAXPROCS tracks the slot grant.
export GOMAXPROCS="${NSLOTS:-1}"

_default_concurrency=$(( ${NSLOTS:-1} * 8 ))
if (( _default_concurrency < 8 )); then _default_concurrency=8; fi
CONCURRENCY="${CONCURRENCY:-$_default_concurrency}"

mkdir -p "$OUT_DIR"

SHARD_ID=$(sed -n "${TASK_ID}p" "$SHARD_LIST")
if [[ -z "$SHARD_ID" ]]; then
    echo "ERROR: no shard at line $TASK_ID of $SHARD_LIST" >&2
    exit 2
fi

FILELIST="$SHARD_DIR/chunk_${SHARD_ID}.txt"
OUT_FILE="$OUT_DIR/${SHARD_ID}.tsv.gz"
MANIFEST_FILE="$OUT_DIR/${SHARD_ID}.manifest.tsv.gz"
LOG_FILE="$OUT_DIR/${SHARD_ID}.log"

echo "[scan_shard] task=$TASK_ID shard=$SHARD_ID slots=${NSLOTS:-1} concurrency=$CONCURRENCY start=$(date -Is)" >"$LOG_FILE"

if [[ ! -x "$BIN" ]]; then
    echo "ERROR: parse_13f_go binary missing or not executable: $BIN" >>"$LOG_FILE"
    exit 3
fi
if [[ ! -f "$FILELIST" ]]; then
    echo "ERROR: filelist missing: $FILELIST" >>"$LOG_FILE"
    exit 4
fi

FILES_IN=$(wc -l <"$FILELIST")
echo "[scan_shard] filelist=$FILELIST files=$FILES_IN" >>"$LOG_FILE"

START=$(date +%s)
"$BIN" \
    -files-from "$FILELIST" \
    -archive-root "$ARCHIVE_ROOT" \
    -out "$OUT_FILE" \
    -manifest "$MANIFEST_FILE" \
    -concurrency "$CONCURRENCY" \
    2>>"$LOG_FILE"
STATUS=$?
END=$(date +%s)

ROWS=$(gzip -dc "$OUT_FILE" 2>/dev/null | wc -l)
MANIFEST_ROWS=$(gzip -dc "$MANIFEST_FILE" 2>/dev/null | wc -l)

# A shard whose manifest is short parsed fewer filings than it was given.
# Fail loudly: a silently short shard becomes a silently short panel.
if [[ "$STATUS" -ne 0 || "$MANIFEST_ROWS" -ne "$FILES_IN" ]]; then
    echo "[scan_shard] FAIL task=$TASK_ID shard=$SHARD_ID status=$STATUS files_in=$FILES_IN manifest_rows=$MANIFEST_ROWS" >>"$LOG_FILE"
    exit 5
fi

echo "[scan_shard] task=$TASK_ID shard=$SHARD_ID status=$STATUS files=$FILES_IN holdings_rows=$ROWS manifest_rows=$MANIFEST_ROWS wall=$((END-START))s end=$(date -Is)" >>"$LOG_FILE"
exit 0
