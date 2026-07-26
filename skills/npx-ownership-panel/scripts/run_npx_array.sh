#!/bin/bash
#$ -cwd
#$ -N npx_cells
#$ -j y
#$ -l m_mem_free=4G
#
# run_npx_array.sh — SGE array wrapper for build_npx.sas. One task per year.
#
# The year range is NOT baked in with `#$ -t 2005-2025` (as the original
# npx_agreement.sh did) so the same script can smoke-test two years:
#
#   qsub -t 2023-2024 run_npx_array.sh      # TEST BEFORE SCALING
#   qsub -t 2005-2025 run_npx_array.sh      # full panel, 21 tasks
#   qsub -t 2011-2011 run_npx_array.sh      # re-run one failed year
#
# SGE_TASK_ID *is* the year — that is why -t takes the year range directly.
#
# 4G is ample: the 329 GB source streams through the PDV, and the two hashes
# (849K item keys + 27K crosswalk keys + ~100K accumulator cells) are a few
# tens of MB. This is the memory profile the original ran at.

set -u

year=$SGE_TASK_ID
mkdir -p logs

echo "task=$year host=$(hostname) started=$(date -Is)"

sas -nodms -noterminal -nosyntaxcheck \
    -sysparm "$year" \
    -log   "logs/build_npx_${year}.log" \
    -print "logs/build_npx_${year}.lst" \
    build_npx.sas
rc=$?

# The SAS log is where the row counts live; surface them into the SGE log so
# `grep NPXSTAT logs/*` reconciles the whole array without opening 21 files.
grep -hE "NPXSTAT|NPXDONE|^ERROR" "logs/build_npx_${year}.log" || true

# SAS exit codes: 0 = clean, 1 = WARNINGS ONLY, >=2 = errors. Propagating 1
# makes SGE mark a task failed when it merely emitted a warning — observed on
# every S12 task in the 2026-07-25 end-to-end run, which all produced correct
# partitions. Treat 1 as success, surface it, and fail only on >=2.
if [ "$rc" -le 1 ]; then
    [ "$rc" -eq 1 ] && echo "NOTE: SAS returned 1 (warnings only) — not a failure"
    rc=0
fi

echo "task=$year finished=$(date -Is) rc=$rc"
exit $rc
