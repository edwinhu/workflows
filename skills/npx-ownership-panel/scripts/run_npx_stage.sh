#!/bin/bash
#$ -cwd
#$ -N npx_stage
#$ -j y
#$ -l m_mem_free=4G
#
# run_npx_stage.sh — SGE wrapper for stage_npx_link.sas.
#
# Not run_sas.sh: that builds the log filename from the sysparm, and this
# sysparm contains spaces and a path.
#
#   qsub -v "LINKCSV=$PWD/npx_link.csv" run_npx_stage.sh
#
# The year range and the meeting-type / vote-result filters are NOT parameters:
# they live in pipeline_config.sas, which stage_npx_link.sas %includes and which
# build_meetings.sas reads too. Passing a window here is what let the two legs
# silently disagree about the item universe.

set -u
mkdir -p logs

LINKCSV="${LINKCSV:-$(pwd)/npx_link.csv}"

echo "stage host=$(hostname) csv=${LINKCSV} started=$(date -Is) (universe from pipeline_config.sas)"

sas -nodms -noterminal -nosyntaxcheck \
    -sysparm "${LINKCSV}" \
    -log   logs/stage_npx_link.log \
    -print logs/stage_npx_link.lst \
    stage_npx_link.sas
rc=$?

grep -hE "LINKSTAT|ITEMSTAT|^ERROR" logs/stage_npx_link.log || true
echo "stage finished=$(date -Is) rc=$rc"
exit $rc
