#!/bin/bash
#
# scan_shard.sh — SGE worker for parse_npx_go, one byte-balanced shard per task.
#
# Environment (all overridable):
#   SGE_TASK_ID    required — 1-based row index into SHARD_LIST
#   PARSE_NPX_ROOT default: /scratch/${WRDS_INST:-nyu}/$(whoami)/parse_npx
#   SHARD_LIST     default: $ROOT/filelists/shards/chunks.txt
#   SHARD_DIR      default: $ROOT/filelists/shards
#                  expects per-shard files named "chunk_${SHARD_ID}.txt"
#   OUT_DIR        default: $ROOT/out
#   BIN            default: $ROOT/bin/parse_npx_go
#   ARCHIVE_ROOT   default: /wrds/sec/archives
#   CONCURRENCY    default: NSLOTS*8 (floor 8)
#
# N-PX filings are 10-200 MB and the XML path streams, so per-worker memory is
# bounded by the decoder buffer rather than by filing size. Concurrency is set
# above the slot grant because /wrds/sec/archives is NFS and open latency, not
# CPU, is what a worker waits on.
#
# GOMAXPROCS and CONCURRENCY are different knobs. GOMAXPROCS is pinned to
# $NSLOTS so the Go runtime sizes its thread pool from the slot grant instead of
# the host's core count, and does not take cores the scheduler promised other
# jobs. CONCURRENCY is the throughput lever.

set -uo pipefail

ROOT="${PARSE_NPX_ROOT:-/scratch/${WRDS_INST:-nyu}/$(whoami)/parse_npx}"
SHARD_LIST="${SHARD_LIST:-$ROOT/filelists/shards/chunks.txt}"
SHARD_DIR="${SHARD_DIR:-$ROOT/filelists/shards}"
OUT_DIR="${OUT_DIR:-$ROOT/out}"
BIN="${BIN:-$ROOT/bin/parse_npx_go}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"

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
OUT_FILE="$OUT_DIR/${SHARD_ID}.votes.tsv.gz"
MANIFEST_FILE="$OUT_DIR/${SHARD_ID}.manifest.tsv.gz"
LOG_FILE="$OUT_DIR/${SHARD_ID}.log"

echo "[scan_shard] task=$TASK_ID shard=$SHARD_ID slots=${NSLOTS:-1} gomaxprocs=$GOMAXPROCS concurrency=$CONCURRENCY start=$(date -Is)" >"$LOG_FILE"

if [[ ! -x "$BIN" ]]; then
    echo "ERROR: parse_npx_go binary missing or not executable: $BIN" >>"$LOG_FILE"
    exit 3
fi
if [[ ! -f "$FILELIST" ]]; then
    echo "ERROR: filelist missing: $FILELIST" >>"$LOG_FILE"
    exit 4
fi

# grep -c '' counts the final line even when the filelist has no trailing
# newline, which wc -l would drop.
FILES_IN=$(grep -c '' <"$FILELIST")
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

VOTE_ROWS=$(gzip -dc "$OUT_FILE" 2>/dev/null | grep -c '')
MANIFEST_ROWS=$(gzip -dc "$MANIFEST_FILE" 2>/dev/null | grep -c '')

# The manifest carries one row per input filing, including the ones that parsed
# to zero rows (parse_status ok with n_rows=0) and the ones that failed
# (parse_status error). A short manifest therefore means filings went missing
# rather than that they had nothing to report. Fail the task: a silently short
# shard becomes a silently short panel, and nothing downstream can tell the
# difference.
if [[ "$STATUS" -ne 0 || "$MANIFEST_ROWS" -ne "$FILES_IN" ]]; then
    echo "[scan_shard] FAIL task=$TASK_ID shard=$SHARD_ID status=$STATUS files_in=$FILES_IN manifest_rows=$MANIFEST_ROWS" >>"$LOG_FILE"
    exit 5
fi

echo "[scan_shard] task=$TASK_ID shard=$SHARD_ID status=$STATUS files=$FILES_IN vote_rows=$VOTE_ROWS manifest_rows=$MANIFEST_ROWS wall=$((END-START))s end=$(date -Is)" >>"$LOG_FILE"
exit 0
