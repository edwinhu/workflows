#!/bin/bash
#$ -t 1994-2024
#$ -l m_mem_free=8G
#$ -cwd
#$ -j y
# Year-parallel TR-insiders extract for Volkova-style blockholder panel.
#
# Submit:   qsub run_insider_array.sh
# Stitch:   after completion, run sas -log logs/stack.log stack_insider_panel.sas

mkdir -p logs

year=$SGE_TASK_ID
LOGNAME="logs/pull_tr_insiders-${year}"

sas -sysparm "$year" \
    -log  "${LOGNAME}.log" \
    -print "${LOGNAME}.lst" \
    pull_tr_insiders.sas
