#!/bin/bash
#$ -t 1994-2024   # override at submit time: qsub -t 2005-2025 run_insider_array.sh
#$ -l m_mem_free=8G
#$ -cwd
#$ -j y
# Year-parallel TR-insiders extract for Volkova-style blockholder panel.
#
# Submit:   qsub run_insider_array.sh            (default 1994-2024)
#           qsub -t 2005-2025 run_insider_array.sh
#
# The -t range is an SGE directive, so it cannot read a shell variable — the
# directive block is parsed before the shell runs. Override on the qsub line
# instead; -t there wins over the one in the file.
# Stitch:   after completion, run sas -log logs/stack.log stack_insider_panel.sas

mkdir -p logs

year=$SGE_TASK_ID
LOGNAME="logs/pull_tr_insiders-${year}"

sas -sysparm "$year" \
    -log  "${LOGNAME}.log" \
    -print "${LOGNAME}.lst" \
    pull_tr_insiders.sas
