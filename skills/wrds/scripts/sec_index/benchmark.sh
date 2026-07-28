#!/bin/bash
#
# benchmark.sh — Run all three scanners on shard 000000 and report
# wall/CPU/row-count + parity against the baseline output.
#
# Intended to run on WRDS directly (not via qsub) so we can time the
# unconstrained NFS walk. Use --task-id N to target a different shard.
#
# Results land in $BENCH_DIR (default $WRDS_SCRATCH/sec_index_bench) along with the gzipped
# outputs for each variant.
#
# Usage (on WRDS):
#   cd "$WRDS_SCRATCH/sec_index"
#   bash bin/benchmark.sh                # default task_id=1 (shard 000000)
#   bash bin/benchmark.sh --task-id 3

set -uo pipefail

WRDS_SCRATCH="${WRDS_SCRATCH:-/scratch/${WRDS_INST:-nyu}/$(whoami)}"
BENCH_DIR="${BENCH_DIR:-$WRDS_SCRATCH/sec_index_bench}"
SHARD_LIST="${SHARD_LIST:-$WRDS_SCRATCH/sec_index/shards.txt}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/wrds/sec/archives}"
BIN_DIR="${BIN_DIR:-$WRDS_SCRATCH/sec_index/bin}"
BASELINE_OUT="${BASELINE_OUT:-$WRDS_SCRATCH/sec_index/prototype_backup/shard_0001.tsv.gz}"
TASK_ID=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --task-id) TASK_ID="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

mkdir -p "$BENCH_DIR"
SUMMARY="$BENCH_DIR/summary.txt"
: > "$SUMMARY"

SHARD=$(sed -n "${TASK_ID}p" "$SHARD_LIST")
SHARD_DIR="$ARCHIVE_ROOT/$SHARD"
FILE_COUNT=$(find "$SHARD_DIR" -type f -name '*.txt' | wc -l)
echo "shard=$SHARD task_id=$TASK_ID files=$FILE_COUNT" | tee -a "$SUMMARY"

run_variant() {
    local name="$1" script="$2"
    local out="$BENCH_DIR/${name}.tsv.gz"
    local log="$BENCH_DIR/${name}.log"
    local timefile="$BENCH_DIR/${name}.time"

    echo "===== $name =====" | tee -a "$SUMMARY"

    # Bash's `time` reserved word requires the simple command form, and can
    # only prefix a pipeline (no env-var assignments). Export via env then call.
    local t0 t1 wall rc
    t0=$(date +%s.%N)
    export SGE_TASK_ID="$TASK_ID"
    export SHARD_LIST="$SHARD_LIST"
    export OUT_DIR="$BENCH_DIR/${name}_out"
    export ARCHIVE_ROOT="$ARCHIVE_ROOT"
    TIMEFORMAT='real=%R user=%U sys=%S'
    { time bash "$script" >"$log" 2>&1; } 2>"$timefile"
    rc=$?
    t1=$(date +%s.%N)
    wall=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.2fs", b-a}')

    if (( rc != 0 )); then
        echo "  FAILED (rc=$rc) — see $log and $timefile" | tee -a "$SUMMARY"
        return
    fi

    local produced
    produced=$(ls "$BENCH_DIR/${name}_out"/shard_*.tsv.gz 2>/dev/null | head -1)
    if [[ -z "$produced" ]]; then
        echo "  FAILED: no output produced" | tee -a "$SUMMARY"
        return
    fi
    mv "$produced" "$out"

    local rows
    rows=$(gzip -dc "$out" | wc -l)
    local size
    size=$(stat -c '%s' "$out" 2>/dev/null || stat -f '%z' "$out")
    local timings
    timings=$(tr '\n' ' ' < "$timefile" | sed 's/  */ /g')

    {
        printf "  rows:    %s\n" "$rows"
        printf "  size:    %s bytes\n" "$size"
        printf "  wall:    %s\n" "$wall"
        printf "  times:   %s\n" "$timings"
    } | tee -a "$SUMMARY"
}

run_variant baseline   "$BIN_DIR/scan_shard.sh"
run_variant rg_awk     "$BIN_DIR/scan_shard_rg_awk.sh"
run_variant go_helper  "$BIN_DIR/scan_shard_go.sh"

echo "===== parity =====" | tee -a "$SUMMARY"

# Build a (path, role, cik) fingerprint per variant and compare sizes / diffs.
for v in baseline rg_awk go_helper; do
    gzip -dc "$BENCH_DIR/${v}.tsv.gz" \
        | awk -F'\t' '{print $1"|"$5"|"$6}' \
        | sort -u > "$BENCH_DIR/${v}.fp"
    wc -l "$BENCH_DIR/${v}.fp" | tee -a "$SUMMARY"
done

echo "-- baseline vs rg_awk diff counts --" | tee -a "$SUMMARY"
comm -23 "$BENCH_DIR/baseline.fp" "$BENCH_DIR/rg_awk.fp" | wc -l | \
    awk '{printf "  only_in_baseline: %d\n", $1}' | tee -a "$SUMMARY"
comm -13 "$BENCH_DIR/baseline.fp" "$BENCH_DIR/rg_awk.fp" | wc -l | \
    awk '{printf "  only_in_rg_awk:   %d\n", $1}' | tee -a "$SUMMARY"

echo "-- baseline vs go_helper diff counts --" | tee -a "$SUMMARY"
comm -23 "$BENCH_DIR/baseline.fp" "$BENCH_DIR/go_helper.fp" | wc -l | \
    awk '{printf "  only_in_baseline:  %d\n", $1}' | tee -a "$SUMMARY"
comm -13 "$BENCH_DIR/baseline.fp" "$BENCH_DIR/go_helper.fp" | wc -l | \
    awk '{printf "  only_in_go_helper: %d\n", $1}' | tee -a "$SUMMARY"

echo
echo "Summary written to $SUMMARY"
