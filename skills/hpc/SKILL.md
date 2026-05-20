---
name: hpc
version: 1.0
description: "Use when submitting jobs to UVA HPC (Rivanna/Afton), writing Slurm scripts (sbatch/srun/squeue), converting SGE to Slurm, running compute on any Slurm-managed cluster, or building WRDS data pipelines with polars on HPC. Triggers: 'submit to HPC', 'sbatch', 'squeue', 'slurm job', 'run on Rivanna', 'run on Afton', 'HPC array job', 'convert SGE to Slurm', 'polars on HPC', 'WRDS from HPC'."
user-invocable: false
---

## Contents

- [When to Use What](#when-to-use-what)
- [Login Node Enforcement](#login-node-enforcement)
- [Cluster Reference](#cluster-reference)
- [Slurm Job Submission](#slurm-job-submission)
- [Array Jobs](#array-jobs)
- [SGE to Slurm Translation](#sge-to-slurm-translation)
- [Environment Variables](#environment-variables)
- [WRDS Data Access](#wrds-data-access)
- [Monitoring & Debugging](#monitoring--debugging)
- [Resource Billing](#resource-billing)

## When to Use What

Three compute environments, each with a clear role:

| Environment | Use For | Examples |
|-------------|---------|----------|
| **Local / RJDS** | Exploration, prototyping, notebooks | EDA, quick plots, marimo/Jupyter, test on small samples, iterate on code |
| **WRDS (SGE)** | Data access, SAS ETL, file parsing | SAS jobs against WRDS libraries, SEC filing parsers on `/wrds/sec/`, scan_covers, ad-hoc SQL |
| **UVA HPC (Slurm)** | Scale compute | Model estimation (PIN), large polars pipelines, anything needing >10 cores or >1 hour |

### The Workflow

```
1. EXPLORE (local/RJDS)     →  Prototype code, test on 5-10 items
2. BUILD DATA (WRDS)        →  SAS ETL or PostgreSQL queries (data lives there)
3. ESTIMATE AT SCALE (HPC)  →  sbatch when you need 100+ cores
4. ANALYZE RESULTS (local)  →  Pull results back, notebooks, regressions, tables
```

### Decision Rules

- **Does it need WRDS filesystem access?** (`/wrds/sec/`, SAS libraries) → WRDS
- **Is it CPU-intensive and embarrassingly parallel?** → HPC
- **Is it exploratory or iterative?** → Local / RJDS
- **Is it a quick SQL query?** → Either WRDS or HPC (both have PostgreSQL access)

### HPC Interactive Partition

The `interactive` partition (42 nodes, 12h max) is for **testing sbatch scripts on one chunk before submitting 176 tasks**, not for replacing local dev work:

```bash
salloc -p interactive --cpus-per-task=4 --mem=16G --time=1:00:00
# test your script, then exit and sbatch the real job
```

### Why This Split Matters

PIN estimation proved it: WRDS SGE has 10 concurrent slots and took 8+ hours without starting OWR. UVA HPC ran 70+ OWR tasks simultaneously and finished in 30 minutes. But WRDS is still the right place to build the data — the SAS libraries and SEC filings live there.

## Login Node Enforcement

### IRON LAW: NEVER RUN COMPUTE ON THE LOGIN NODE

<EXTREMELY-IMPORTANT>
The login node is shared infrastructure. Running estimation, bulk processing, or any CPU-intensive work directly via SSH will get the account flagged and the process killed.

**ALWAYS** write a Slurm submission script and submit via `sbatch`. No exceptions.

- `ssh uva-hpc 'python3 est.py owr 2020'` → **WRONG. Use sbatch.**
- `ssh uva-hpc 'nohup ./process &'` → **WRONG. Still the login node. Use sbatch.**
- `ssh uva-hpc 'for year in 2003..2024; do python3 ...; done'` → **WRONG. Use sbatch --array.**
- `sbatch run_est.sh owr` → **CORRECT.**

The login node is for: `sbatch`, `squeue`, `scancel`, `sinfo`, `scp`, `ls`, `head`, short queries.
</EXTREMELY-IMPORTANT>

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "It's a quick test, just one stock" | One stock becomes 5,000 when you forget to change the args | Write the sbatch script first, test with `--array=1-1` |
| "nohup makes it background, so it's fine" | nohup is still the login node — same shared CPU | sbatch, not nohup |
| "I'll run the real job via sbatch later" | You'll forget. The 'test' run flags the account | sbatch from the start |
| "It only takes 30 seconds" | You don't know that until it runs | If in doubt, sbatch |

### Red Flags — STOP If You're About To

- **Write `ssh uva-hpc 'python3 ... > output'`** → STOP. Write a submit script.
- **Write `ssh uva-hpc 'nohup ... &'`** → STOP. Use sbatch.
- **Run a loop over years/permnos interactively** → STOP. Use `--array`.

## Cluster Reference

### UVA HPC (Rivanna/Afton)

- **SSH**: `ssh uva-hpc` (configured with ProxyJump through Mac via tailnet)
- **User**: `vwh7mb`
- **Home**: `/home/vwh7mb` (GPFS, 12PB shared, no per-user quota displayed)
- **Scratch**: `/scratch/vwh7mb/` (Weka, 12TB)
- **Allocation**: 10M SUs (service units ≈ weighted CPU-core-hours)

### Partitions

| Partition | Nodes | CPUs/Node | RAM/Node | MaxTime | MinNodes | MaxNodes | Use For |
|-----------|-------|-----------|----------|---------|----------|----------|---------|
| `standard` | 301 | 40+ | 384GB+ | 7 days | 0 | **1** | Single-node jobs, array tasks |
| `parallel` | 179 | 96 | 768GB | 3 days | **2** | 64 | Multi-node MPI jobs only |
| `gpu` | 44 | 36+ | 257GB+ | 3 days | — | — | GPU workloads |
| `interactive` | 42 | 32+ | 128GB+ | 12 hrs | — | — | Interactive/debugging |

### CRITICAL: Partition Selection

<EXTREMELY-IMPORTANT>
**Use `standard` for embarrassingly parallel array jobs** (PIN estimation, file processing, per-year/per-stock tasks).

The `parallel` partition requires **MinNodes=2** — it will reject single-node jobs with "Node count specification invalid". It is designed for MPI jobs that span multiple nodes.

**Wrong:** `#SBATCH --partition=parallel` for array jobs → submission fails
**Right:** `#SBATCH --partition=standard` for array jobs → 301 nodes available
</EXTREMELY-IMPORTANT>

### When to Use Each Partition

**`standard`** (default choice for most research computing):
- Embarrassingly parallel work: array jobs where each task is independent (PIN estimation, file parsing, per-stock/per-year processing)
- Single-node Python/R with `ProcessPoolExecutor`, `multiprocessing`, `mclapply`
- Any job where tasks don't communicate with each other
- MaxNodes=1, so each array element runs on exactly one node

**`parallel`** (multi-node distributed computing):
- MPI jobs where processes on different nodes exchange messages (`mpi4py`, OpenMPI, MVAPICH)
- Dask distributed or Ray clusters spanning multiple nodes
- Large linear algebra / matrix factorizations that exceed single-node RAM (ScaLAPACK, PETSc)
- Simulations with inter-process communication (CFD, molecular dynamics)
- Key requirement: your code must explicitly coordinate across nodes (MPI, Dask scheduler, etc.) — `ProcessPoolExecutor` and `multiprocessing` are single-node only
- MinNodes=2, 96 CPUs and 768GB RAM per node — use when one node isn't enough

**`gpu`** (GPU-accelerated workloads):
- Deep learning training/inference (PyTorch, TensorFlow, JAX)
- GPU-accelerated linear algebra (CuPy, RAPIDS)
- LLM inference or fine-tuning

**`interactive`** (debugging and development):
- Testing job scripts before full submission: `salloc -p interactive --cpus-per-task=4 --mem=16G --time=1:00:00`
- Debugging segfaults or data loading issues
- 12-hour max — not for production runs

### Python/R Environment

- **pixi**: Install to `$HOME/.pixi/bin/pixi` via `curl -fsSL https://pixi.sh/install.sh | bash`
- **Project envs**: `$HOME/projects/<name>/.pixi/envs/default/bin/python`
- **Modules** (alternative): `module load python` — but pixi preferred for reproducibility
- **NEVER** install Jupyter kernels globally on HPC

## Slurm Job Submission

### Basic Submit Script

```bash
#!/bin/bash
#SBATCH --job-name=my_job
#SBATCH --partition=standard
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=3:00:00
#SBATCH --output=logs/job-%A_%a.log

mkdir -p logs

export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

PYTHON=$HOME/projects/my-project/.pixi/envs/default/bin/python
$PYTHON -u my_script.py --workers ${SLURM_CPUS_PER_TASK:-8}
```

### Submission

```bash
sbatch script.sh              # submit
sbatch script.sh arg1 arg2    # args passed to script as $1, $2
```

Note: unlike SGE's `qsub run.sh <model>`, Slurm passes arguments after the script name directly. Use `${1:?Usage: sbatch script.sh <arg>}` to enforce.

## Array Jobs

### Pattern

```bash
#SBATCH --array=1-176           # tasks 1 through 176
#SBATCH --array=1-176%50        # max 50 concurrent tasks
#SBATCH --array=1,5,9,13        # specific tasks only
```

### Year × Chunk Sharding (PIN estimation pattern)

```bash
#SBATCH --array=1-176
# 22 years × 8 chunks = 176 tasks
# Decode: year = START_YEAR + (id-1)/NCHUNKS, chunk = (id-1)%NCHUNKS

NCHUNKS=8
START_YEAR=2003

idx=$((SLURM_ARRAY_TASK_ID - 1))
year=$((START_YEAR + idx / NCHUNKS))
chunk=$((idx % NCHUNKS))
```

### Task List Sharding (file processing pattern)

```bash
# Equivalent to SGE's sed -n "${SGE_TASK_ID}p" pattern
ITEM=$(sed -n "${SLURM_ARRAY_TASK_ID}p" "$TASK_LIST")
```

### Re-running Failed Tasks

```bash
# Re-run specific tasks
sbatch --array=5,12,87 script.sh

# Re-run a range
sbatch --array=10-20 script.sh
```

## SGE to Slurm Translation

### Directives

| SGE | Slurm | Notes |
|-----|-------|-------|
| `#$ -N job_name` | `#SBATCH --job-name=job_name` | |
| `#$ -cwd` | (default behavior) | Slurm runs from submit dir by default |
| `#$ -l m_mem_free=4G` | `#SBATCH --mem=4G` | Per-node memory |
| `#$ -pe onenode N` | `#SBATCH --ntasks=1 --cpus-per-task=N` | Single-node parallel |
| `#$ -j y` | (default behavior) | Slurm merges stderr into stdout by default |
| `#$ -o logs/out-$TASK_ID.log` | `#SBATCH --output=logs/out-%A_%a.log` | `%A`=job, `%a`=array task |
| `#$ -t 1-176` | `#SBATCH --array=1-176` | |
| (no equivalent) | `#SBATCH --partition=standard` | **Required** — no default partition |
| (no equivalent) | `#SBATCH --time=3:00:00` | Default 5h, max 7d on standard |

### Environment Variables

| SGE | Slurm | Description |
|-----|-------|-------------|
| `$SGE_TASK_ID` | `$SLURM_ARRAY_TASK_ID` | Array task index |
| `$JOB_ID` | `$SLURM_JOB_ID` | Job ID |
| `$NSLOTS` | `$SLURM_CPUS_PER_TASK` | Allocated CPUs |
| `$HOSTNAME` | `$SLURM_NODELIST` | Assigned node(s) |
| `$SGE_TASK_FIRST` | `$SLURM_ARRAY_TASK_MIN` | First array index |
| `$SGE_TASK_LAST` | `$SLURM_ARRAY_TASK_MAX` | Last array index |

### Commands

| SGE | Slurm | Description |
|-----|-------|-------------|
| `qsub script.sh` | `sbatch script.sh` | Submit job |
| `qstat -u $USER` | `squeue -u $USER` | List running jobs |
| `qdel job_id` | `scancel job_id` | Cancel job |
| `qstat -j job_id` | `scontrol show job job_id` | Job details |
| `qacct -j job_id` | `sacct -j job_id` | Job accounting |
| (no equivalent) | `sinfo -p partition` | Partition info |

### Conversion Checklist

When converting an SGE script to Slurm:

1. Replace `#$` directives with `#SBATCH` equivalents (see table above)
2. Add `#SBATCH --partition=standard` (SGE has no equivalent — partition is implicit)
3. Add `#SBATCH --time=` (SGE defaults to unlimited on WRDS)
4. Replace `$SGE_TASK_ID` → `$SLURM_ARRAY_TASK_ID`
5. Replace `$NSLOTS` → `$SLURM_CPUS_PER_TASK`
6. Replace `$JOB_ID` → `$SLURM_JOB_ID`
7. Remove `#$ -cwd` and `#$ -j y` (Slurm defaults)
8. Update log path variables: `$TASK_ID` → `%a`, `$JOB_ID` → `%A`
9. Update data paths from WRDS scratch to HPC scratch

## Monitoring & Debugging

### Check Job Status

```bash
squeue -u $USER                              # all my jobs
squeue -j 12345678                           # specific job
squeue -j 12345678 -t R | wc -l             # count running tasks
squeue -j 12345678 -t PD                     # show pending tasks + reasons
squeue -u $USER --format='%.10i %.9P %.12j %.2t %.10M %.4C %R'  # detailed
```

### Common Pending Reasons

| Reason | Meaning |
|--------|---------|
| `(Priority)` | Lower priority than other queued jobs — will run eventually |
| `(Resources)` | Not enough free nodes/CPUs — waiting for running jobs to finish |
| `(QOSMaxCpuPerUserLimit)` | Hit per-user CPU limit on this QOS |
| `(AssocMaxJobsLimit)` | Hit max concurrent jobs for this account |

### Job Accounting (after completion)

```bash
sacct -j 12345678 --format=JobID,State,ExitCode,Elapsed,MaxRSS,NCPUS
sacct -j 12345678 -a --format=JobID,State,ExitCode  # all array tasks
```

### Log Files

Output goes to `--output` path. With `%A_%a` pattern:
- `logs/est-12345678_1.log` — job 12345678, array task 1
- Check for errors: `grep -rl 'Error\|Traceback' logs/est-12345678_*.log`

## Resource Billing

UVA HPC bills in **Service Units (SUs)**, which are weighted CPU-core-hours:

```
SU = (CPU_cores × 4.6369 + Memory_GB × 0.2842) × hours
```

### Cost Examples (standard partition)

| Config | SU/hour | 176 tasks × 3 hrs |
|--------|---------|-------------------|
| 1 CPU, 4GB | ~5.8 | ~3,062 |
| 8 CPU, 32G | ~46.2 | ~24,404 |
| 40 CPU, 160G | ~231 | ~121,968 |

With 10M SUs allocated, even aggressive usage (8 CPU × 176 tasks × 3 hrs = ~24K SUs) is negligible (<0.25% of allocation).

### Check Balance

```bash
allocations                    # show allocation balance
allocations -a myallocation    # specific allocation
```

## WRDS Data Access

WRDS PostgreSQL is accessible from HPC compute nodes. Use polars + connectorx for fast data pipelines that replace SAS entirely.

### Connection

- **Host**: `wrds-pgdata.wharton.upenn.edu:9737`
- **Credentials**: `~/.pgpass` (chmod 600)
- **User**: `edwin_hu` (UVA account)

### Quick Start

```python
from wrds_conn import read_wrds

# WRDS SQL → polars DataFrame in one line
df = read_wrds("SELECT * FROM crsp.msf WHERE date >= '2020-01-01'")

# Write to Parquet for reuse
df.write_parquet("/scratch/vwh7mb/data/crsp_msf.parquet")
```

`wrds_conn.py` (see `examples/wrds_conn.py`) parses `.pgpass` and builds a connectorx-compatible URI — connectorx doesn't read `.pgpass` natively.

### Pipeline: SQL → polars → Parquet (replaces SAS)

```
Old: WRDS SAS → .sas7bdat (7GB) → Python HDF5 conversion → .h5 (390MB)
New: WRDS PostgreSQL → polars/connectorx → .parquet
```

No SAS license needed. Single step. Portable output.

See `references/wrds-polars-pipeline.md` for full examples (joins, partitioned output, Slurm submission for large queries).
