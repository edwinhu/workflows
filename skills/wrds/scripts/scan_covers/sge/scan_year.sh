#!/bin/bash
#
# scan_year.sh — SGE worker for scan_covers, sharded by year.
#
# Mirrors scan_shard_go.sh but operates on a filelist (one year's worth of
# filings) instead of walking an archive shard directory.
#
# Environment (all overridable):
#   SGE_TASK_ID       required — row index into YEARS_LIST (1-based)
#   YEARS_LIST        default: /scratch/nyu/eddyhu/blockholders_13dg/years.txt
#   FILELIST_DIR      default: /scratch/nyu/eddyhu/blockholders_13dg/filelists
#                     expects per-year files named "${YEAR}.txt"
#   OUT_DIR           default: /scratch/nyu/eddyhu/blockholders_13dg/out
#   BIN               default: /scratch/nyu/eddyhu/bin/scan_covers
#   PROFILE           default: blockholders_13dg
#   CONCURRENCY       default: NSLOTS*8 (floor 16)

set -uo pipefail

YEARS_LIST="${YEARS_LIST:-/scratch/nyu/eddyhu/blockholders_13dg/years.txt}"
FILELIST_DIR="${FILELIST_DIR:-/scratch/nyu/eddyhu/blockholders_13dg/filelists}"
OUT_DIR="${OUT_DIR:-/scratch/nyu/eddyhu/blockholders_13dg/out}"
BIN="${BIN:-/scratch/nyu/eddyhu/bin/scan_covers}"
PROFILE="${PROFILE:-blockholders_13dg}"
TASK_ID="${SGE_TASK_ID:?SGE_TASK_ID must be set}"

# Go uses threads not multiprocessing — pin to 1 core per SGE slot.
export GOMAXPROCS="${NSLOTS:-1}"

_default_concurrency=$(( ${NSLOTS:-1} * 16 ))
if (( _default_concurrency < 16 )); then _default_concurrency=16; fi
CONCURRENCY="${CONCURRENCY:-$_default_concurrency}"

mkdir -p "$OUT_DIR"

YEAR=$(sed -n "${TASK_ID}p" "$YEARS_LIST")
if [[ -z "$YEAR" ]]; then
    echo "ERROR: no year at line $TASK_ID of $YEARS_LIST" >&2
    exit 2
fi

FILELIST="$FILELIST_DIR/${YEAR}.txt"
OUT_FILE="$OUT_DIR/${YEAR}.tsv.gz"
LOG_FILE="$OUT_DIR/${YEAR}.log"

echo "[scan_year] task=$TASK_ID year=$YEAR concurrency=$CONCURRENCY start=$(date -Is)" >"$LOG_FILE"

if [[ ! -x "$BIN" ]]; then
    echo "ERROR: scan_covers binary missing or not executable: $BIN" >>"$LOG_FILE"
    exit 3
fi
if [[ ! -f "$FILELIST" ]]; then
    echo "ERROR: filelist missing: $FILELIST" >>"$LOG_FILE"
    : | gzip >"$OUT_FILE"
    exit 0
fi

FILES_IN=$(wc -l <"$FILELIST")
echo "[scan_year] filelist=$FILELIST files=$FILES_IN" >>"$LOG_FILE"

"$BIN" -profile "$PROFILE" -files-from "$FILELIST" -concurrency "$CONCURRENCY" \
    2>>"$LOG_FILE" | gzip >"$OUT_FILE"

STATUS=${PIPESTATUS[0]}
ROWS=$(gzip -dc "$OUT_FILE" | wc -l)
echo "[scan_year] task=$TASK_ID year=$YEAR status=$STATUS rows=$ROWS end=$(date -Is)" >>"$LOG_FILE"
exit 0
