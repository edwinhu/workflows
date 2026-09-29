#!/bin/bash
#$ -N def14a_sas
#$ -cwd
#$ -j y
#
# run_sas.sh — run one SAS program on a compute node. SAS is not on the login
# host's PATH, and the login host must not run compute at all.
#
#   qsub -pe onenode 2 -l m_mem_free=8G sge/run_sas.sh sge/make_filelists.sas [SYSPARM]
#
# An optional second argument is handed to the program as -sysparm. Log and
# listing names carry a slug of it so two parameterisations of the same program
# do not overwrite each other's log.
set -u
PROG="${1:?usage: run_sas.sh PROGRAM.sas [SYSPARM]}"
SYSPARM="${2:-}"
cd "$(dirname "$PROG")" || exit 1
BASE="$(basename "$PROG" .sas)"
if [[ -n "$SYSPARM" ]]; then
    BASE="${BASE}_$(printf '%s' "$SYSPARM" | tr -c 'A-Za-z0-9' '_' | cut -c1-60)"
fi
exec sas -nodms -nonews -sysin "$(basename "$PROG")" \
     -sysparm "$SYSPARM" \
     -log "${BASE}.log" -print "${BASE}.lst"
