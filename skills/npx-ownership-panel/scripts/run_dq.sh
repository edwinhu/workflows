#!/bin/bash
#$ -cwd
#$ -q all.q
#$ -l m_mem_free=16G
#
# SGE wrapper for the post-merge detector sweep. Seconds against a ~35 minute DAG.
#
# This job REPORTS and does not gate: it is the last node, holds nothing, and no
# detector count fails it. Its exit status still matters for a missing module or
# a missing panel, which are operator errors rather than data findings.
#
# OWNERSHIP_DQ is passed through so a deployment that does not carry the `wrds`
# skill alongside can point at the module wherever it landed. dq_panel.py falls
# back to the repo layout and then to its own directory.
export OWNERSHIP_DQ="${OWNERSHIP_DQ:-}"
export YEAR2="${YEAR2:-2025}"
/usr/local/bin/python3 dq_panel.py
