#!/bin/bash
#$ -N def14a_py
#$ -cwd
#$ -j y
#
# run_python.sh — run one python3 script on a compute node.
#
#   qsub -pe onenode 2 -l m_mem_free=8G sge/run_python.sh sge/scan_sizes.py FILELIST_DIR
#
# Deliberately the system python3: a pixi/conda env under /scratch is not
# durable (a job that ran in August came back rc=127 weeks later when the env
# had been swept), and these scripts are stdlib-only for that reason.
set -u
exec python3 "$@"
