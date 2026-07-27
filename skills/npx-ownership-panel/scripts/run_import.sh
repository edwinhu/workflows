#!/bin/bash
#$ -cwd
#$ -N imp_io
#$ -j y
#$ -l m_mem_free=8G
#
# run_import.sh — SGE wrapper for import_inst_own.sas.
#
# Not run_sas.sh, for the same reason run_npx_stage.sh is not: run_sas.sh builds
# the log filename from the sysparm, and this sysparm is a PATH. Passing it
# through run_sas.sh produces
#   logs/import_inst_own-/scratch/.../inst_own.csv.log
# and SAS fails with "Physical file does not exist" before reading a single row.
#
#   qsub -v "INST_OWN_CSV=$PWD/../data/processed/inst_own.csv" run_import.sh

set -u
mkdir -p logs

CSV="${INST_OWN_CSV:-$(pwd)/../data/processed/inst_own.csv}"
echo "import host=$(hostname) csv=${CSV} started=$(date -Is)"

sas -nodms -noterminal -nosyntaxcheck \
    -sysparm "${CSV}" \
    -log   logs/import_inst_own.log \
    -print logs/import_inst_own.lst \
    import_inst_own.sas
rc=$?

grep -hE "IMPORTSTAT|IMPORT header|^ERROR" logs/import_inst_own.log || true
echo "import finished=$(date -Is) rc=$rc"
exit $rc
