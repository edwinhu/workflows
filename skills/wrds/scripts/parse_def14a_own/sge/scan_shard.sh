#!/bin/bash
#
# scan_shard.sh — SGE worker for parse_def14a_own, one byte-balanced shard per task.
#
# Environment (all overridable):
#   SGE_TASK_ID    required — row index into SHARD_LIST (1-based)
#   SHARD_LIST     default: $ROOT/filelists/shards/chunks.txt
#   SHARD_DIR      default: $ROOT/filelists/shards
#                  expects per-shard files named "chunk_${SHARD_ID}.tsv"
#   OUT_DIR        default: $ROOT/out
#   BIN            default: $ROOT/bin/parse_def14a_own_go
#   ARCHIVE_ROOT   default: /wrds/sec/archives
#   CONCURRENCY    default: NSLOTS*8 (floor 8)
#
# Ten slots, total, per user in all.q — not ten tasks. Submit the whole array
# and let the scheduler meter it; `-pe onenode N` also rejects N > 8.
#
# There is no rclone staging stage and there should not be: /wrds/sec/archives
# is mounted directly on the compute nodes.

set -uo pipefail

ROOT="${DEF14A_ROOT:-/scratch/nyu/eddyhu/parse_def14a_own}"
SHARD_LIST="${SHARD_LIST:-$ROOT/filelists/shards/chunks.txt}"
SHARD_DIR="${SHARD_DIR:-$ROOT/filelists/shards}"
OUT_DIR="${OUT_DIR:-$ROOT/out}"
BIN="${BIN:-$ROOT/bin/parse_def14a_own_go}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"

# HTML DOM parsing is CPU-bound: GOMAXPROCS tracks the slot grant.
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

FILELIST="$SHARD_DIR/chunk_${SHARD_ID}.tsv"
OUT_FILE="$OUT_DIR/${SHARD_ID}.tsv.gz"
MANIFEST_FILE="$OUT_DIR/${SHARD_ID}.manifest.tsv.gz"
LOG_FILE="$OUT_DIR/${SHARD_ID}.log"

echo "[scan_shard] task=$TASK_ID shard=$SHARD_ID slots=${NSLOTS:-1} concurrency=$CONCURRENCY start=$(date -Is)" >"$LOG_FILE"

if [[ ! -x "$BIN" ]]; then
    echo "ERROR: parse_def14a_own_go binary missing or not executable: $BIN" >>"$LOG_FILE"
    exit 3
fi
if [[ ! -f "$FILELIST" ]]; then
    echo "ERROR: filelist missing: $FILELIST" >>"$LOG_FILE"
    exit 4
fi

FILES_IN=$(grep -cve '^[[:space:]]*$' "$FILELIST")
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

# Subtract the header line from both counts.
ROWS=$(( $(gzip -dc "$OUT_FILE" 2>/dev/null | wc -l) - 1 ))
MANIFEST_ROWS=$(( $(gzip -dc "$MANIFEST_FILE" 2>/dev/null | wc -l) - 1 ))

# A shard whose manifest is short parsed fewer filings than it was given.
# Fail loudly: a silently short shard becomes a silently short panel.
if [[ "$STATUS" -ne 0 || "$MANIFEST_ROWS" -ne "$FILES_IN" ]]; then
    echo "[scan_shard] FAIL task=$TASK_ID shard=$SHARD_ID status=$STATUS files_in=$FILES_IN manifest_rows=$MANIFEST_ROWS" >>"$LOG_FILE"
    exit 5
fi

echo "[scan_shard] task=$TASK_ID shard=$SHARD_ID status=$STATUS files=$FILES_IN ownership_rows=$ROWS manifest_rows=$MANIFEST_ROWS wall=$((END-START))s end=$(date -Is)" >>"$LOG_FILE"
exit 0
