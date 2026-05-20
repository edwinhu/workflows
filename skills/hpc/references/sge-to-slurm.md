# SGE to Slurm Migration Reference

Quick-reference for converting WRDS SGE jobs to UVA HPC Slurm jobs.

## Script Header Conversion

### SGE (WRDS)
```bash
#!/bin/bash
#$ -N job_name
#$ -cwd
#$ -pe onenode 1
#$ -l m_mem_free=4G
#$ -j y
#$ -o logs/out-$JOB_ID.$TASK_ID.log
#$ -t 1-176
```

### Slurm (UVA HPC)
```bash
#!/bin/bash
#SBATCH --job-name=job_name
#SBATCH --partition=standard
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=3:00:00
#SBATCH --output=logs/out-%A_%a.log
#SBATCH --array=1-176
```

## Key Differences

1. **Partition is required** — SGE routes implicitly; Slurm needs `--partition=`
2. **Time limit is required** — SGE has no default limit on WRDS; Slurm defaults to 5h on standard (max 7d)
3. **`-cwd` is default** — Slurm runs from submit directory; no directive needed
4. **`-j y` is default** — Slurm merges stderr into stdout by default
5. **Log path substitution** — SGE uses shell variables (`$TASK_ID`); Slurm uses `%` patterns (`%a`, `%A`)
6. **Arguments** — SGE: `qsub script.sh` reads `$1` from the submit command; Slurm: `sbatch script.sh arg1` passes args directly

## Path Mapping

| Location | WRDS | UVA HPC |
|----------|------|---------|
| Home | `/home/nyu/eddyhu` | `/home/vwh7mb` |
| Scratch | `/scratch/nyu/hue/` | `/scratch/vwh7mb/` |
| Python | `$HOME/projects/<name>/.pixi/envs/default/bin/python` | Same pattern |
| Data | `/scratch/nyu/hue/taqdfx_all6.h5` | `/scratch/vwh7mb/pin-code/taqdfx_all6.h5` |

## Capacity Comparison

| Metric | WRDS SGE | UVA HPC Slurm |
|--------|----------|---------------|
| Max concurrent slots | 10 per user | Hundreds (allocation-limited) |
| CPUs per node | 2-4 (shared) | 40-96 (dedicated) |
| RAM per node | 4G requested | Up to 768GB |
| Workers per task | 1 (practical) | 8+ (cpus-per-task) |
| Throughput | ~8-12 tasks/hr | All tasks can run simultaneously |

## Common Gotcha: SSH Variable Expansion

When submitting via SSH heredoc, use single quotes to prevent local variable expansion:

```bash
# WRONG — $HOME and $PYTHON expand locally (empty on RJDS)
ssh uva-hpc "sbatch << 'EOF'
PYTHON=$HOME/projects/...   # expands to RJDS $HOME, not HPC $HOME
EOF"

# RIGHT — use single-quoted SSH command
ssh uva-hpc 'cd ~/projects/pin-code && sbatch run_est_slurm.sh owr'

# RIGHT — scp script first, then sbatch
scp run_est_slurm.sh uva-hpc:~/projects/pin-code/
ssh uva-hpc 'cd ~/projects/pin-code && sbatch run_est_slurm.sh owr'
```

This bit us on WRDS: the first OWR full run (job 34554274) failed all 152 tasks with exit code 127 because `$PYTHON` expanded to empty on RJDS inside a double-quoted SSH heredoc.
