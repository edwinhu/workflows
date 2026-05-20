#!/bin/bash
#SBATCH --job-name=process
#SBATCH --partition=standard
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=1:00:00
#SBATCH --output=logs/process-%A_%a.log
#
# Example: file-list sharded array job.
#
# Slurm equivalent of the SGE pattern:
#   ITEM=$(sed -n "${SGE_TASK_ID}p" "$TASK_LIST")
#
# Submit:
#   N=$(wc -l < items.txt)
#   sbatch --array=1-$N process.sh
#
# Re-run failures:
#   sbatch --array=5,12 process.sh

#SBATCH --array=1-100

TASK_LIST="${TASK_LIST:-items.txt}"
OUT_DIR="${OUT_DIR:-output}"

mkdir -p logs "$OUT_DIR"

ITEM=$(sed -n "${SLURM_ARRAY_TASK_ID}p" "$TASK_LIST")
if [[ -z "$ITEM" ]]; then
    echo "ERROR: no item at line $SLURM_ARRAY_TASK_ID of $TASK_LIST" >&2
    exit 2
fi

echo "[process] task=$SLURM_ARRAY_TASK_ID item=$ITEM start=$(date -Is)"

# Replace with actual processing command
PYTHON=$HOME/projects/my-project/.pixi/envs/default/bin/python
$PYTHON -u process.py "$ITEM" --output "$OUT_DIR"
