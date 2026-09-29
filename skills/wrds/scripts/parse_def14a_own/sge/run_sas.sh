#!/bin/bash
#$ -N def14a_sas
#$ -cwd
#$ -j y
#
# run_sas.sh — run one SAS program on a compute node. SAS is not on the login
# host's PATH, and the login host must not run compute at all.
#
#   qsub -pe onenode 2 -l m_mem_free=8G sge/run_sas.sh sge/make_filelists.sas
set -u
PROG="${1:?usage: run_sas.sh PROGRAM.sas}"
cd "$(dirname "$PROG")" || exit 1
exec sas -nodms -nonews -sysin "$(basename "$PROG")" \
     -log "$(basename "$PROG" .sas).log" -print "$(basename "$PROG" .sas).lst"
