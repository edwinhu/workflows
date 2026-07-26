#!/bin/bash
#$ -cwd
#$ -q all.q
#
# SGE wrapper: run a Python script with the system Python (has psycopg2, pandas, pyarrow).
# Usage: qsub run_python.sh <script.py> [args...]

/usr/local/bin/python3 "$@"
