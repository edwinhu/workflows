# WRDS + Polars Data Pipeline on HPC

## Overview

Replace SAS data pipelines with direct WRDS PostgreSQL → polars → Parquet workflows on UVA HPC. This eliminates SAS entirely and produces faster, more portable output.

## Setup

### Prerequisites (one-time)

1. **`.pgpass`** on HPC (`~/.pgpass`, chmod 600):
   ```
   wrds-pgdata.wharton.upenn.edu:9737:wrds:USERNAME:PASSWORD
   ```

2. **pixi dependencies** (`pixi.toml`):
   ```toml
   polars = "*"
   psycopg2 = "*"
   connectorx = "*"
   pyarrow = "*"
   ```

3. **Connection helper** (`wrds_conn.py`):
   ```python
   from wrds_conn import read_wrds
   df = read_wrds("SELECT * FROM crsp.msf WHERE date >= '2020-01-01'")
   ```
   See `examples/wrds_conn.py` — parses `.pgpass` for connectorx (which doesn't read it natively).

## Pipeline Pattern

### Old (SAS on WRDS grid)
```
WRDS SAS libraries → build_crsp.sas → build_taq.sas → build_residuals.sas
  → .sas7bdat (7GB) → Python HDF5 conversion → .h5 (390MB)
  → est.py reads HDF5
```
- Requires SAS license on WRDS
- Slow: SAS jobs submitted via SGE, sequential phases
- Fragile: hardcoded paths, SAS macro debugging

### New (polars on HPC)
```
WRDS PostgreSQL → polars (connectorx) → .parquet
  → est.py reads Parquet (or polars directly)
```
- No SAS needed
- Single step: SQL → DataFrame → Parquet
- Portable: Parquet works everywhere

## Examples

### Simple query
```python
from wrds_conn import read_wrds

df = read_wrds("""
    SELECT permno, date, ret, prc, shrout
    FROM crsp.msf
    WHERE date >= '2020-01-01'
""")
df.write_parquet("/scratch/vwh7mb/data/crsp_msf.parquet")
```

### Large query with partitioned output
```python
import polars as pl
from wrds_conn import read_wrds

# Pull TAQ data year by year, write partitioned Parquet
for year in range(2003, 2025):
    df = read_wrds(f"""
        SELECT *
        FROM taqmsec.ctm_{year}
        WHERE date_trunc('year', date) = '{year}-01-01'
    """)
    df.write_parquet(f"/scratch/vwh7mb/data/taq_{year}.parquet")
```

### Joins and transformations
```python
# CRSP-Compustat merge in polars (replaces SAS PROC SQL merge)
crsp = read_wrds("SELECT permno, date, ret FROM crsp.msf WHERE date >= '2003-01-01'")
link = read_wrds("SELECT gvkey, lpermno as permno, linkdt, linkenddt FROM crsp.ccmxpf_lnkhist WHERE linktype IN ('LU','LC')")

merged = crsp.join(link, on="permno", how="inner").filter(
    (pl.col("date") >= pl.col("linkdt")) &
    ((pl.col("date") <= pl.col("linkenddt")) | pl.col("linkenddt").is_null())
)
```

## connectorx vs psycopg2

| Feature | connectorx | psycopg2 |
|---------|-----------|----------|
| Speed | **Fast** (Rust, parallel partitioned reads) | Slower (Python, single-threaded) |
| .pgpass support | No (needs URI with password) | Yes (native) |
| polars integration | `pl.read_database_uri()` | `pl.read_database()` |
| Best for | Large queries (>100K rows) | Small queries, DDL, metadata |

Use `wrds_conn.py` to bridge connectorx's lack of .pgpass support.

## Submitting as a Slurm Job

For large data pulls, submit as a batch job rather than running on the login node:

```bash
#!/bin/bash
#SBATCH --job-name=wrds_pull
#SBATCH --partition=standard
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=2:00:00
#SBATCH --output=logs/wrds_pull-%j.log

PYTHON=$HOME/projects/pin-code/.pixi/envs/default/bin/python
$PYTHON -u build_data.py
```

Remember: large queries (pulling full TAQ, multi-year CRSP) are compute-intensive and should use sbatch, not the login node.
