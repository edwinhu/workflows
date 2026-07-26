#!/bin/bash
#
# run_npx_pipeline.sh — the fund-level N-PX leg. Runs ON the WRDS grid.
#
#   stage_npx_link ──→ build_npx ×N (SGE array, one task per year) ──→ to_parquet
#   (crosswalk +          (329 GB source, hash-merged and              (one small
#    item universe)        reduced in place)                            file out)
#
# Prereqs on the grid:
#   - autoexec.sas providing libnames `out` (on /scratch) and `risk`
#   - npx_link.csv staged next to these scripts — push it from your laptop:
#       ./npx_link_to_csv.py --in npx_crsp_link.parquet --out npx_link.csv
#       scp npx_link.csv wrds:~/projects/myproject/
#
# Usage (on the grid):
#   bash run_npx_pipeline.sh 2023 2024      # TEST BEFORE SCALING — 2 years
#   bash run_npx_pipeline.sh 2005 2025      # full panel, 21 tasks
#
# Retrieval is deliberately NOT in here: the output is one file, so it is one
# scp from your laptop. See the README.

set -e
cd "$(dirname "$0")"
mkdir -p logs

# The year range here only sizes the SGE array (-t). The item UNIVERSE — window,
# meeting types, vote results — comes from pipeline_config.sas, which both legs
# read. Keep them consistent; merge_panel.sas fails the run if the legs disagree.
Y1="${1:-2005}"
Y2="${2:-2025}"
LINKCSV="${LINKCSV:-$(pwd)/npx_link.csv}"
NTASKS=$(( Y2 - Y1 + 1 ))

if [ ! -f "$LINKCSV" ]; then
    echo "ERROR: crosswalk not found at $LINKCSV" >&2
    echo "       Build it locally with npx_link_to_csv.py and scp it here." >&2
    exit 1
fi

echo "=========================================="
echo "N-PX fund-level leg: ${Y1}-${Y2} (${NTASKS} tasks)"
echo "Crosswalk: $LINKCSV ($(du -h "$LINKCSV" | cut -f1))"
echo "Start: $(date)"
echo "=========================================="

# --- Step 1: stage the two hash inputs (crosswalk + item universe) ---
JOB_STAGE=$(qsub -terse -N npx_stage -o logs/stage_npx_link.sge.log -j y \
    -v "LINKCSV=${LINKCSV}" \
    run_npx_stage.sh | cut -d. -f1)
echo "Step 1  stage_npx_link: job $JOB_STAGE (~30 sec)"

# --- Step 2: the array. SGE_TASK_ID is the year. ---
# -hold_jid: every task opens out.npx_link and out.npx_items read-only, so they
# must exist first. Without the hold, all N tasks start, fail to open the hash
# dataset, and exit 0 with an empty output — the worst failure mode there is.
JOB_ARRAY=$(qsub -terse -N npx_cells -hold_jid "$JOB_STAGE" \
    -t "${Y1}-${Y2}" \
    -o logs/ -j y \
    run_npx_array.sh | cut -d. -f1)
echo "Step 2  build_npx array: job $JOB_ARRAY (${NTASKS} tasks)"

# --- Step 3: stack + reconcile into one parquet ---
JOB_PQ=$(qsub -terse -N npx_pq -hold_jid "$JOB_ARRAY" \
    -o logs/npx_cells_to_parquet.log -j y \
    run_python.sh npx_cells_to_parquet.py --expect-years "$Y1" "$Y2" \
    | cut -d. -f1)
echo "Step 3  npx_cells_to_parquet: job $JOB_PQ"

echo ""
echo "=========================================="
echo "Submitted. Monitor: qstat -u $USER"
echo ""
echo "Reconcile the array without opening 21 logs:"
echo "  grep -h NPXSTAT logs/build_npx_*.log"
echo ""
echo "Result: \$out/npx_block_direction.parquet"
echo "Fetch:  scp wrds:<out>/npx_block_direction.parquet ."
echo "=========================================="
