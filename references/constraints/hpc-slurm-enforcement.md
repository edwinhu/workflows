# HPC Slurm Enforcement

## Rule

**NEVER run compute-intensive work on the HPC login node.** Always write a Slurm batch script and submit via `sbatch`.

The login node is shared by all cluster users. Running estimation, bulk processing, or any CPU-intensive work will get the account flagged and the process killed.

## What counts as compute-intensive

- Any Python/R script that processes >100 items (files, stocks, rows)
- Model estimation (PIN, regressions, optimization)
- Bulk file reads or data processing
- Any process expected to run >30 seconds

## What's OK on the login node

- `sbatch`, `squeue`, `scancel`, `sinfo` (job management)
- `ls`, `head`, `wc -l` (quick file inspection)
- `scp`, `rsync` (file transfer)
- Short `python -c '...'` checks (import test, data peek)
- `module load`, `pixi install` (environment setup)

## Required pattern

1. Write a Slurm submission script with `#SBATCH --partition=`, `#SBATCH --array=` for array jobs
2. Upload code + data to HPC via `scp`
3. Submit via `sbatch` from the login node
4. Monitor via `squeue -u $USER`
5. Download results via `scp`

## Partition selection

- **`standard`**: Single-node array jobs (embarrassingly parallel). MaxNodes=1, MinNodes=0. **Default choice.**
- **`parallel`**: Multi-node MPI jobs. MinNodes=2 — will reject single-node jobs. Only for true distributed computing.
- **`gpu`**: GPU workloads only.
- **`interactive`**: Debugging, 12h max.

**Common mistake**: Using `parallel` for array jobs → fails with "Node count specification invalid". Use `standard`.

## Existing examples

- `pin-code/run_est_slurm.sh` — PIN model estimation (year × chunk sharding, 8 workers/task)

## Red flags — STOP if you're about to

- `ssh uva-hpc 'python3 estimate.py ...'` → STOP. Use sbatch.
- `ssh uva-hpc 'nohup ... &'` → STOP. Still the login node. Use sbatch.
- `ssh uva-hpc 'for year in ...; do python3 ...; done'` → STOP. Use `--array`.
- Use `#SBATCH --partition=parallel` for an array job → STOP. Use `standard`.
- Request 1 node on `parallel` partition → STOP. MinNodes=2. Use `standard`.
