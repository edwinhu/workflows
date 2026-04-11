#!/bin/bash
#
# Voting + Ownership Pipeline (all-SAS with SGE parallelism)
#
# DAG:
#   meetings ─────────────────────────────────────┐
#   inst_own ─────────────────────────────────────┤
#   mflinks ──┐                                    │
#   split_s12 ┼→ tfn_holdings (×9 parallel) ───────┤
#   (PG read) ┘  (reads /scratch partitions)       └→ merge_panel
#
# Usage: bash run_pipeline.sh

set -e
cd "$(dirname "$0")"
mkdir -p logs

echo "=========================================="
echo "Voting + Ownership Pipeline"
echo "Start: $(date)"
echo "=========================================="

# --- Step 1: meetings + inst_own + mflinks (all parallel) ---
echo "Step 1: Submitting parallel build jobs..."

JOB_MTG=$(qsub -N meetings -o logs/build_meetings.log -j y \
    run_sas.sh build_meetings.sas | awk '{print $3}')
echo "  meetings:  job $JOB_MTG (~12 sec)"

JOB_IO=$(qsub -N inst_own -o logs/build_inst_own.log -j y \
    run_sas.sh build_inst_own.sas | awk '{print $3}')
echo "  inst_own:  job $JOB_IO (~3 min)"

JOB_MFL=$(qsub -N mflinks -o logs/build_mflinks.log -j y \
    run_sas.sh build_mflinks.sas | awk '{print $3}')
echo "  mflinks:   job $JOB_MFL (~1 min)"

JOB_SPLIT=$(qsub -N split_s12 -o logs/split_s12.log -j y \
    run_sas.sh split_s12.sas | awk '{print $3}')
echo "  split_s12: job $JOB_SPLIT (~15 min, PostgreSQL read → partitions on /scratch)"

# --- Step 2: TFN holdings (parallel, after mflinks + split_s12) ---
echo ""
echo "Step 2: TFN holdings (after mflinks + split_s12)..."
YEAR_RANGES=("2003-2010" "2011-2016" "2017-2018" "2019-2019" "2020-2020" "2021-2021" "2022-2022" "2023-2023" "2024-2024")
TFN_JOBS=""

for range in "${YEAR_RANGES[@]}"; do
    JOB=$(qsub -N tfn_${range} -hold_jid "$JOB_MFL,$JOB_SPLIT" \
        -o logs/tfn_holdings-${range}.log -j y \
        run_sas.sh tfn_holdings_parallel.sas "$range" | awk '{print $3}')
    echo "  tfn_holdings ${range}: job $JOB"
    TFN_JOBS="${TFN_JOBS:+$TFN_JOBS,}$JOB"
done

# --- Step 3: Merge (after ALL jobs) ---
echo ""
ALL_DEPS="$JOB_MTG,$JOB_IO,$TFN_JOBS"
echo "Step 3: Merge (after $ALL_DEPS)..."
JOB_MERGE=$(qsub -N merge -hold_jid "$ALL_DEPS" \
    -o logs/merge_panel.log -j y \
    run_sas.sh merge_panel.sas | awk '{print $3}')
echo "  merge: job $JOB_MERGE"

echo ""
echo "=========================================="
echo "All jobs submitted. Monitor with: qstat -u $USER"
echo "=========================================="
echo ""
echo "Expected timeline:"
echo "  meetings:              ~12 sec"
echo "  inst_own:              ~3 min"
echo "  mflinks:               ~1 min"
echo "  split_s12 (PG read):   ~15 min (single PostgreSQL read, writes ~40GB to /scratch)"
echo "  tfn_holdings (9x):     ~5 min each (parallel, reads /scratch partitions)"
echo "  merge:                 ~5 sec (after everything)"
echo "  TOTAL:                 ~20 min wall time"
echo ""
echo "Output: out.pass (SAS dataset)"
