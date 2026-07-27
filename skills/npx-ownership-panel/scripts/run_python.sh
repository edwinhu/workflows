#!/bin/bash
#$ -cwd
#$ -q all.q
#$ -l m_mem_free=24G
#
# SGE wrapper: run a Python script with the system Python (has psycopg2, pandas, pyarrow).
# Usage: qsub run_python.sh <script.py> [args...]
#
# m_mem_free IS LOAD-BEARING, NOT TUNING. build_inst_own.py collects the full
# EDGAR 13F panel (172.9M rows across 137 parquet files) into memory before the
# CRSP join. With no memory request at all — which is how this wrapper shipped —
# SGE grants the cgroup default and the job is SIGKILLed mid-load:
#     qacct -j <id>  ->  failed 52 : cgroups enforced memory limit
#                        exit_status 137
#                        ru_maxrss   16774076   (16.0G, killed on the way up)
# 24G is the ceiling this grid allows for a single job, not a chosen value:
# qsub rejects 25G and above with "Too much memory requested. Jobs may not use
# more than 48GB" (the queue prices m_mem_free per slot at 2 slots, so 24G is
# the largest request that fits the 48GB cap).
#
# The other runners in this tree already request memory (run_s12_array.sh 8G,
# run_npx_stage.sh 4G); this wrapper was the only one that requested none.

# BASELINE MODE. A parallel group-by sum reduces in thread-arrival order, so two
# identical runs produce floats differing by 1 ULP — enough that canonical_hash
# reports DIFFERENT at 12 sig digits (measured: 6,048 io_total cells raw, 101
# still differing after rounding, because a 1-ULP nudge flips exact half-way
# ties). Pinning the reduction order makes the digest reproducible: verified
# IDENTICAL across two runs. Costs ~2.1x on this leg, which is off the critical
# path. Unset for production runs; set it for anything that will be frozen.
export POLARS_MAX_THREADS=${POLARS_MAX_THREADS:-1}
/usr/local/bin/python3 "$@"
