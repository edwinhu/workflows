#!/bin/bash
#$ -cwd
#$ -N s12_split
#$ -j y
#$ -l m_mem_free=8G
#$ -tc 6
#
# run_s12_array.sh — S12 partitions as an SGE array, one task per range.
#
#   qsub -t 1-$(wc -l < s12ranges.txt) -tc 6 -o logs/ -j y run_s12_array.sh
#
# Replaces the sequential loop in split_s12.sas, which wrote all nine partitions
# from one job (measured 910s / 15m10s). Two waves of <=6 recover most of that.
#
# -tc 6 IS LOAD-BEARING, NOT TUNING. Each task opens its own PostgreSQL
# connection and the WRDS per-role cap is 7:
#     select rolconnlimit from pg_roles where rolname = current_user;   -- 7
# Nine concurrent tasks exceed it. 6 leaves one connection of headroom, so the
# array does not fail whenever an interactive session or a stray psql is also
# connected — sizing to exactly 7 turns that into an intermittent failure that
# passes on the run where you test it.

set -u
mkdir -p logs

RANGES="${RANGES:-s12ranges.txt}"
R=$(sed -n "${SGE_TASK_ID}p" "$RANGES")
[ -n "$R" ] || { echo "ERROR: no range at line $SGE_TASK_ID of $RANGES" >&2; exit 2; }

echo "task=$SGE_TASK_ID range=$R host=$(hostname) started=$(date -Is)"
S=$(date +%s)

sas -nodms -noterminal -nosyntaxcheck \
    -sysparm "$R" \
    -log   "logs/split_s12_${R}.log" \
    -print "logs/split_s12_${R}.lst" \
    split_s12_one.sas
rc=$?

grep -hE "S12PART|^ERROR" "logs/split_s12_${R}.log" || true
# SAS exit codes: 0 = clean, 1 = WARNINGS ONLY, >=2 = errors. Propagating 1
# makes SGE mark a task failed when it merely emitted a warning — observed on
# every S12 task in the 2026-07-25 end-to-end run, which all produced correct
# partitions. Treat 1 as success, surface it, and fail only on >=2.
if [ "$rc" -le 1 ]; then
    [ "$rc" -eq 1 ] && echo "NOTE: SAS returned 1 (warnings only) — not a failure"
    rc=0
fi

echo "task=$SGE_TASK_ID range=$R wall_s=$(( $(date +%s) - S )) rc=$rc finished=$(date -Is)"
exit $rc
