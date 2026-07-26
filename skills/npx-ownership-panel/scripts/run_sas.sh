#!/bin/bash
#$ -cwd
# SGE wrapper for SAS scripts. Usage: qsub run_sas.sh script.sas [sysparm]
# Directs SAS log to logs/ with unique name per job to avoid lock conflicts.

SCRIPT="$1"
SYSPARM="${2:-}"

if [ -z "$SCRIPT" ]; then
    echo "Usage: $0 <script.sas> [sysparm]"
    exit 1
fi

mkdir -p logs
BASENAME=$(basename "$SCRIPT" .sas)
LOGNAME="logs/${BASENAME}"
if [ -n "$SYSPARM" ]; then
    LOGNAME="logs/${BASENAME}-${SYSPARM}"
fi

if [ -n "$SYSPARM" ]; then
    sas -sysparm "$SYSPARM" -log "${LOGNAME}.log" -print "${LOGNAME}.lst" "$SCRIPT"
else
    sas -log "${LOGNAME}.log" -print "${LOGNAME}.lst" "$SCRIPT"
fi
