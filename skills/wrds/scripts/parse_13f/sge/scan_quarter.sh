#!/bin/bash
#
# scan_quarter.sh — SGE worker for parse_13f_go, sharded by year-quarter.
#
# Environment (all overridable):
#   SGE_TASK_ID       required — row index into BUCKETS_LIST (1-based)
#   BUCKETS_LIST      default: /scratch/uva/edwin_hu/parse_13f/filelists/buckets.txt
#   FILELIST_DIR      default: /scratch/uva/edwin_hu/parse_13f/filelists
#                     expects per-quarter files named "filelist_${YYYYQQ}.txt"
#   OUT_DIR           default: /scratch/uva/edwin_hu/parse_13f/out
#   BIN               default: /scratch/uva/edwin_hu/bin/parse_13f_go
#   ARCHIVE_ROOT      default: /wrds/sec/archives
#   CONCURRENCY       default: NSLOTS*8 (floor 16)

set -uo pipefail

BUCKETS_LIST="${BUCKETS_LIST:-/scratch/nyu/eddyhu/parse_13f/filelists/buckets.txt}"
FILELIST_DIR="${FILELIST_DIR:-/scratch/nyu/eddyhu/parse_13f/filelists}"
OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/parse_13f/out}"
BIN="${BIN:-/scratch/nyu/eddyhu/bin/parse_13f_go}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"

# Go regex parsing is CPU-bound: GOMAXPROCS scales linearly (2 cores = 2x).
# Goroutine count barely matters (NFS is not the bottleneck).
# Benchmarked 2026-05-09: PROCS=1 35s, PROCS=2 18s, PROCS=4 9s (2K filings).
export GOMAXPROCS="${NSLOTS:-2}"

_default_concurrency=$(( ${NSLOTS:-2} * 8 ))
if (( _default_concurrency < 16 )); then _default_concurrency=16; fi
CONCURRENCY="${CONCURRENCY:-$_default_concurrency}"

mkdir -p "$OUT_DIR"

BUCKET=$(sed -n "${TASK_ID}p" "$BUCKETS_LIST")
if [[ -z "$BUCKET" ]]; then
    echo "ERROR: no bucket at line $TASK_ID of $BUCKETS_LIST" >&2
    exit 2
fi

FILELIST="$FILELIST_DIR/filelist_${BUCKET}.txt"
OUT_FILE="$OUT_DIR/${BUCKET}.tsv.gz"
MANIFEST_FILE="$OUT_DIR/${BUCKET}.manifest.tsv.gz"
LOG_FILE="$OUT_DIR/${BUCKET}.log"

echo "[scan_quarter] task=$TASK_ID bucket=$BUCKET concurrency=$CONCURRENCY start=$(date -Is)" >"$LOG_FILE"

if [[ ! -x "$BIN" ]]; then
    echo "ERROR: parse_13f_go binary missing or not executable: $BIN" >>"$LOG_FILE"
    exit 3
fi
if [[ ! -f "$FILELIST" ]]; then
    echo "WARNING: filelist missing: $FILELIST — emitting empty output" >>"$LOG_FILE"
    : | gzip >"$OUT_FILE"
    : | gzip >"$MANIFEST_FILE"
    exit 0
fi

FILES_IN=$(wc -l <"$FILELIST")
echo "[scan_quarter] filelist=$FILELIST files=$FILES_IN" >>"$LOG_FILE"

"$BIN" \
    -files-from "$FILELIST" \
    -archive-root "$ARCHIVE_ROOT" \
    -out "$OUT_FILE" \
    -manifest "$MANIFEST_FILE" \
    -concurrency "$CONCURRENCY" \
    2>>"$LOG_FILE"

STATUS=$?
ROWS=$(gzip -dc "$OUT_FILE" 2>/dev/null | wc -l)
MANIFEST_ROWS=$(gzip -dc "$MANIFEST_FILE" 2>/dev/null | wc -l)
echo "[scan_quarter] task=$TASK_ID bucket=$BUCKET status=$STATUS holdings_rows=$ROWS manifest_rows=$MANIFEST_ROWS end=$(date -Is)" >>"$LOG_FILE"
exit 0
