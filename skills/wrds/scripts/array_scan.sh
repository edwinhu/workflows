#!/usr/bin/env bash
# Run a python scan over a filing list as a PARALLEL SGE array job.
#
#   skills/wrds/scripts/array_scan.sh <name> <remote-list> <shards> <python-file>
#
# The python file is given SHARD and NSHARD in the environment and must read the
# list itself, striding by NSHARD. Per-shard output lands in
# $D/scanout/<name>.<task>.txt; this script waits, then cats them in order.
#
# A qsub job is not automatically a parallel job. Measured 2026-08-29: six scans
# over a 26,749-filing, 63.5 GB pile each ran as ONE serial task because the
# submit script omitted -t. Sharding needed no other change.
#
# qsub is fed on STDIN: a script PATH under /scratch is rejected with
# "Unable to run job: No such file". The list must live under /scratch too --
# a path in the login node's /tmp is invisible to grid nodes.
set -uo pipefail
NAME="${1:?name}"; LIST="${2:?remote list path}"; N="${3:-50}"; PY="${4:?python file}"
D="${WRDS_SCRATCH:?set WRDS_SCRATCH to the /scratch dir holding the filing list}"
ssh -n wrds "mkdir -p $D/scanout && rm -f $D/scanout/$NAME.*.txt"
scp -q "$PY" "wrds:$D/scanout/$NAME.py"
ssh wrds "cd $D && qsub -sync y -t 1-$N -N $NAME -l m_mem_free=6G -pe onenode 1 \
          -o $D/sge_logs -j y -v LIST='$LIST',NSHARD=$N,SCANNAME='$NAME'" <<SGE >/dev/null 2>&1
#!/bin/bash
set -u
D=$D
export SHARD=\$((SGE_TASK_ID - 1))
python3 "\$D/scanout/\$SCANNAME.py" > "\$D/scanout/\$SCANNAME.\$SHARD.txt" 2>&1
SGE
ssh -n wrds "cat $D/scanout/$NAME.*.txt"
