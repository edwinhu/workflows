#!/bin/bash
#
# run_pipeline.sh — THE pipeline. All four legs, one command, submitted and gone.
#
# Runs ON the WRDS cloud. It submits the whole DAG with `qsub -hold_jid` and
# RETURNS: SGE sequences the chain itself, so nothing local needs to stay alive.
# Submit it, disconnect, come back hours later to out.pass_npx.
#
#   ssh wrds "cd ~/projects/myproject && bash run_pipeline.sh"
#   ssh wrds "qstat -u \$USER"            # check on it whenever
#
# DAG (hold_jid edges are real dependencies, not decoration):
#
#   build_meetings ─────────────────────────────────────────────────┐
#   short_interest ──→ build_inst_own ──→ import_inst_own ──────────┤
#                        (EDGAR, py)      (csv → out.inst_own)      │
#   build_mflinks ──┐                                               │
#   split_s12 ──────┴──→ tfn_holdings_parallel ×N ──────────────────┤
#   npx_stage ───────────→ npx_array ×M (one task per year) ────────┤
#                                                                   │
#                                                     ┌─────────────▼─────────────┐
#                                                     │      merge_panel.sas      │
#                                                     │ prereq gate → universe    │
#                                                     │ assert → join → pass_npx  │
#                                                     └───────────────────────────┘
#
# npx_stage gates npx_array: the array hash-merges out.npx_link and out.npx_items,
# and without them every task opens a missing dataset and exits 0 having written
# nothing — the worst failure mode available.
#
# WHY THE SAFETY IS IN SAS, NOT HERE
# ----------------------------------
# `-hold_jid` releases a dependent job when its predecessor FINISHES, regardless
# of exit status. Bash cannot close that gap. So merge_panel.sas asserts its own
# prerequisites and aborts, and pipeline_config.sas is the single universe both
# legs read. Those gates hold for this plain bash run with no supervision of any
# kind — which is the whole point.
#
# Usage: bash run_pipeline.sh [YEAR1 YEAR2]
#   The year range only sizes the N-PX SGE array (-t). The item UNIVERSE — window,
#   meeting types, vote results — lives in pipeline_config.sas and is read by both
#   legs. Keep them consistent; merge_panel fails the run if the legs disagree.

set -e
cd "$(dirname "$0")"
mkdir -p logs

Y1="${1:-2005}"
Y2="${2:-2025}"
LINKCSV="${LINKCSV:-$(pwd)/npx_link.csv}"

# S12 partition ranges come from pipeline_config.sas — the SAME list split_s12.sas
# writes. Hardcoding them separately here is one edit away from submitting
# tfn_holdings jobs for partitions that were never written.
# [^;]* not .* — a %let value ends at the FIRST semicolon, and a greedy match
# swallows any ';' inside a trailing comment. SAS parses it correctly either way,
# so a greedy sed here reintroduces exactly the bash/SAS divergence this shared
# list exists to prevent (observed: 11 tfn jobs submitted for a 2-partition list).
read -r -a YEAR_RANGES <<< "$(sed -n 's/^%let S12_RANGES *= *\([^;]*\);.*/\1/p' pipeline_config.sas)"
[ "${#YEAR_RANGES[@]}" -gt 0 ] || { echo "PREFLIGHT ERROR: no S12_RANGES in pipeline_config.sas" >&2; exit 1; }

# --- Preflight: fail before submitting anything ------------------------------
# Cheap, local, and it costs nothing to be strict. A missing crosswalk discovered
# 40 minutes in is 40 minutes of grid time and a confusing log.
preflight_fail=0
for f in pipeline_config.sas build_meetings.sas build_inst_own.py build_short_interest.py \
         import_inst_own.sas run_import.sh \
         build_mflinks.sas split_s12.sas tfn_holdings_parallel.sas stage_npx_link.sas \
         build_npx.sas merge_panel.sas run_sas.sh run_python.sh run_npx_stage.sh \
         run_npx_array.sh; do
    [ -f "$f" ] || { echo "PREFLIGHT ERROR: missing $f" >&2; preflight_fail=1; }
done

# Legs 2 and 5 are Python and need polars; the SAS legs do not. Check the
# interpreter HERE rather than discovering it in a job log 30 minutes in — a
# missing import is the cheapest possible failure and the most expensive one to
# diagnose late. run_python.sh names the interpreter, so read it from there
# instead of hardcoding a second copy of the path.
PYBIN=$(awk '/^[^#]*python3/ {print $1; exit}' run_python.sh)
PYBIN=${PYBIN:-/usr/local/bin/python3}
if ! "$PYBIN" -c 'import polars, pyarrow, psycopg2' 2>/dev/null; then
    echo "PREFLIGHT ERROR: $PYBIN cannot import polars/pyarrow/psycopg2" >&2
    echo "  Legs 2 (build_inst_own.py) and 5 (build_short_interest.py) need them." >&2
    echo "  Install into that interpreter, or point run_python.sh at one that has them." >&2
    preflight_fail=1
fi
# Leg 2 reads the EDGAR 13F parquet. Absent, it would build an empty panel and
# every downstream ownership column would be silently null.
[ -d "${HOLDINGS_13F:-holdings_13f}" ] || {
    echo "PREFLIGHT ERROR: EDGAR holdings not found at ${HOLDINGS_13F:-holdings_13f}" >&2
    echo "  Set HOLDINGS_13F, or run the 13F scrape first (wrds skill, parse_13f)." >&2
    preflight_fail=1; }
if [ ! -f "$LINKCSV" ]; then
    echo "PREFLIGHT ERROR: crosswalk not found at $LINKCSV" >&2
    echo "  Build it locally (npx_linking/) and scp it here:" >&2
    echo "    ./npx_link_to_csv.py --in npx_crsp_link.parquet --out npx_link.csv" >&2
    preflight_fail=1
fi
[ -f ~/.pgpass ] || { echo "PREFLIGHT ERROR: ~/.pgpass missing (WRDS PG credentials)" >&2; preflight_fail=1; }
[ "$preflight_fail" = "0" ] || { echo "Preflight failed — nothing submitted." >&2; exit 1; }

chmod +x run_sas.sh run_npx_stage.sh run_npx_array.sh run_import.sh 2>/dev/null || true

echo "=========================================="
echo "N-PX x Ownership Pipeline"
echo "N-PX array years: ${Y1}-${Y2}   crosswalk: $LINKCSV"
grep -E '^%let (year1|year2|MEETINGTYPES|VOTERESULTS)' pipeline_config.sas | sed 's/^/  universe: /'
echo "Start: $(date)"
echo "=========================================="

# --- Leg A: item-level vote results ------------------------------------------
JOB_MTG=$(qsub -terse -N meetings -o logs/build_meetings.log -j y \
    run_sas.sh build_meetings.sas | cut -d. -f1)
echo "  [A] build_meetings:  job $JOB_MTG  (~12 sec)"

# --- Leg 2: institutional ownership ------------------------------------------
# Leg 5 first: leg 2 nets securities lending out of ownership using it, so the
# short-interest table has to exist before build_inst_own.py runs.
JOB_SI=$(qsub -terse -N short_int -o logs/build_short_interest.log -j y \
    run_python.sh build_short_interest.py | cut -d. -f1)
echo "  [5] short_interest:  job $JOB_SI  (~10 sec)"

# Leg 2: the CANONICAL builder is build_inst_own.py (SEC EDGAR 13F). It carries
# the data-quality fixes; build_inst_own.sas (Thomson S34) is fallback-only and
# is deliberately NOT in this DAG. Do not swap them back without reading the
# header of the .sas — the two use different cfacshr join dates and each is
# correct for its own source.
JOB_IO=$(qsub -terse -N inst_own -hold_jid "$JOB_SI" \
    -o logs/build_inst_own.log -j y \
    run_python.sh build_inst_own.py | cut -d. -f1)
echo "  [2] build_inst_own:  job $JOB_IO  (~3 min, held on short_interest)"

# Leg 2 writes parquet + CSV; merge_panel reads out.inst_own from the SAS `out`
# library. The SAS leg used to write that directly, and when leg 2 became Python
# nothing replaced it — merge_panel aborted its prerequisite gate on an
# otherwise-clean run. This step is that bridge, and it is a REAL DAG edge:
# merge waits on it, not on build_inst_own.
JOB_IMP=$(qsub -terse -N imp_io -hold_jid "$JOB_IO" \
    -o logs/import_inst_own.sge.log -j y \
    -v "INST_OWN_CSV=$(pwd)/../data/processed/inst_own.csv" \
    run_import.sh | cut -d. -f1)
echo "  [2] import_inst_own: job $JOB_IMP  (held on build_inst_own → out.inst_own)"

# --- Leg 1: mutual-fund holdings ---------------------------------------------
JOB_MFL=$(qsub -terse -N mflinks -o logs/build_mflinks.log -j y \
    run_sas.sh build_mflinks.sas | cut -d. -f1)
echo "  [1] build_mflinks:   job $JOB_MFL  (~1 min)"

# One task per partition, throttled to 6 concurrent: each opens its own
# PostgreSQL connection and the WRDS per-role cap is 7. Replaces a sequential
# 9-partition write measured at 910s.
printf '%s\n' "${YEAR_RANGES[@]}" > s12ranges.txt
JOB_SPLIT=$(qsub -terse -N s12_split -t "1-${#YEAR_RANGES[@]}" -tc 6 \
    -o logs/ -j y run_s12_array.sh | cut -d. -f1)
echo "  [1] s12_split array: job $JOB_SPLIT  (${#YEAR_RANGES[@]} tasks, -tc 6 for the PG cap)"

TFN_JOBS=""
for range in "${YEAR_RANGES[@]}"; do
    J=$(qsub -terse -N "tfn_${range}" -hold_jid "$JOB_MFL,$JOB_SPLIT" \
        -o "logs/tfn_holdings-${range}.log" -j y \
        run_sas.sh tfn_holdings_parallel.sas "$range" | cut -d. -f1)
    TFN_JOBS="${TFN_JOBS:+$TFN_JOBS,}$J"
done
echo "  [1] tfn_holdings:    ${#YEAR_RANGES[@]} jobs (${TFN_JOBS}) — held on mflinks+split_s12"

# --- Leg 4 -> Leg 3: the crosswalk gates the N-PX array ----------------------
JOB_STAGE=$(qsub -terse -N npx_stage -o logs/stage_npx_link.sge.log -j y \
    -v "LINKCSV=${LINKCSV}" \
    run_npx_stage.sh | cut -d. -f1)
echo "  [4] npx_stage:       job $JOB_STAGE  (~30 sec, crosswalk + item frame)"

NTASKS=$(( Y2 - Y1 + 1 ))
JOB_NPX=$(qsub -terse -N npx_cells -hold_jid "$JOB_STAGE" \
    -t "${Y1}-${Y2}" -o logs/ -j y \
    run_npx_array.sh | cut -d. -f1)
echo "  [3] npx_array:       job $JOB_NPX  (${NTASKS} tasks) — held on npx_stage"

# --- Merge: waits on everything ----------------------------------------------
# $JOB_IMP, not $JOB_IO: out.inst_own exists only after the import step, and
# merge_panel's prerequisite gate checks for exactly that dataset.
ALL_DEPS="$JOB_MTG,$JOB_IMP,$TFN_JOBS,$JOB_NPX"
JOB_MERGE=$(qsub -terse -N merge -hold_jid "$ALL_DEPS" \
    -o logs/merge_panel.log -j y \
    run_sas.sh merge_panel.sas | cut -d. -f1)
echo "  [M] merge_panel:     job $JOB_MERGE — held on everything"

cat <<MSG

==========================================
Submitted. Nothing local needs to stay alive — SGE runs the chain.
Expected wall: ~25 min (split_s12 ~15 min and the TFN chunks dominate).

  qstat -u \$USER                                        # progress
  grep -h NPXSTAT logs/build_npx_*.log                   # N-PX per-year reconciliation
  grep -E 'PREREQ|UNIVERSE|ERROR' logs/merge_panel.log   # the gates

Output:
  out.pass      grain = itemonagendaid            (item-level ownership panel)
  out.pass_npx  grain = (itemonagendaid, block)   <- ANALYSIS-READY

If merge_panel fails, read its log before re-running: a PREREQUISITE or UNIVERSE
abort is the pipeline working correctly, and re-running without fixing the cause
will just fail again.
==========================================
MSG
