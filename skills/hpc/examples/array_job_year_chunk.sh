#!/bin/bash
#SBATCH --job-name=pin_est
#SBATCH --partition=standard
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=3:00:00
#SBATCH --output=logs/est-%A_%a.log
#SBATCH --array=1-176
#
# Example: year × chunk sharded array job (PIN estimation).
#
# 22 years × 8 chunks = 176 tasks.
# Each task estimates one model for one chunk of permnos in one year.
# Workers use ProcessPoolExecutor with cpus-per-task cores.
#
# Submit:
#   cd ~/projects/pin-code
#   sbatch run_est_slurm.sh owr     # OWR model, all years
#   sbatch run_est_slurm.sh gpin    # GPIN model, all years
#
# Re-run specific tasks:
#   sbatch --array=5,12,87 run_est_slurm.sh owr
#
# Limit concurrency:
#   sbatch --array=1-176%50 run_est_slurm.sh owr   # max 50 simultaneous

mkdir -p logs

# Suppress internal threading — workers handle parallelism
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

model=${1:?Usage: sbatch run_est_slurm.sh <model>}
NCHUNKS=8
START_YEAR=2003

idx=$((SLURM_ARRAY_TASK_ID - 1))
year=$((START_YEAR + idx / NCHUNKS))
chunk=$((idx % NCHUNKS))

DATA=/scratch/vwh7mb/pin-code/taqdfx_all6.h5
PYTHON=$HOME/projects/pin-code/.pixi/envs/default/bin/python
WORKERS=${SLURM_CPUS_PER_TASK:-8}
$PYTHON -u est.py $model $year --chunk $chunk --nchunks $NCHUNKS --workers $WORKERS --data $DATA
