# Cross-Kernel Data Sharing

## Contents

- [Format Comparison](#format-comparison)
- [Recommended: Parquet](#recommended-parquet)
- [Python <-> R Patterns](#python---r-patterns)
- [Python <-> Stata Patterns](#python---stata-patterns)
- [Python <-> SAS Patterns](#python---sas-patterns)
- [DuckDB for Cross-Kernel SQL](#duckdb-for-cross-kernel-sql)
- [Full Pipeline Example](#full-pipeline-example)
- [Best Practices](#best-practices)

Patterns for sharing data between Python, R, Stata, and SAS in multi-kernel jupytext projects.

## Format Comparison

| Format | Python | R | Stata | SAS | Best For |
|--------|--------|---|-------|-----|----------|
| **Parquet** | Native | Native | Via Python | Limited | Large datasets, typed columns |
| **CSV** | Native | Native | Native | Native | Universal compatibility |
| **Feather** | Native | Native | No | No | Python <-> R only |
| **DTA** | Native | Native | Native | Via PROC | Stata interop |
| **SAS7BDAT** | Read | Read | No | Native | SAS source data |
| **DuckDB** | Native | Native | Via ODBC | Via ODBC | SQL queries on files |
| **RDS** | Via rpy2 | Native | No | No | R-specific objects |

## Recommended: Parquet

Parquet is the recommended interchange format for most workflows.

### Python (Writer)

```python
# %%
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Process data
df = pd.read_csv("raw/data.csv")
df['date'] = pd.to_datetime(df['date'])
df['category'] = df['category'].astype('category')

# Write with schema preservation
df.to_parquet("processed/data.parquet", engine='pyarrow')

# Or with explicit schema for stricter typing
table = pa.Table.from_pandas(df)
pq.write_table(table, "processed/data.parquet")
```

### R (Reader)

```r
# %%
library(arrow)

# Read parquet
df <- read_parquet("processed/data.parquet")

# Check types preserved
str(df)

# Perform analysis
model <- lm(y ~ x1 + x2, data = df)

# Write results back
results <- data.frame(
    coefficient = coef(model),
    std_error = summary(model)$coefficients[, 2]
)
write_parquet(results, "results/model_results.parquet")
```

### Stata (Via Python Bridge)

Stata doesn't natively read parquet. Use Python integration:

```stata
* %%
* Method 1: Use Python within Stata (Stata 16+)
python:
import pandas as pd
df = pd.read_parquet("processed/data.parquet")
df.to_stata("processed/data.dta", write_index=False)
end

* Load the converted data
use "processed/data.dta", clear
```

Or convert in a Python cell first:

```python
# %% kernel=python
import pandas as pd
df = pd.read_parquet("processed/data.parquet")
df.to_stata("processed/data.dta", write_index=False, version=118)
```

## Python <-> R Patterns

### Using Parquet (Recommended)

```python
# %% Python: Prepare data
import pandas as pd
import numpy as np

df = pd.DataFrame({
    'id': range(1000),
    'x': np.random.randn(1000),
    'y': np.random.randn(1000),
    'group': np.random.choice(['A', 'B', 'C'], 1000)
})

df.to_parquet("shared/analysis_data.parquet")
```

```r
# %% R: Statistical analysis
library(arrow)
library(tidyverse)

df <- read_parquet("shared/analysis_data.parquet")

# Group analysis
results <- df |>
    group_by(group) |>
    summarise(
        mean_x = mean(x),
        mean_y = mean(y),
        cor_xy = cor(x, y),
        n = n()
    )

write_parquet(results, "shared/group_stats.parquet")
```

```python
# %% Python: Aggregate results
import pandas as pd

results = pd.read_parquet("shared/group_stats.parquet")
print(results)
```

### Using Feather (Alternative)

Feather is slightly faster for Python <-> R but less portable.

```python
# Python
df.to_feather("shared/data.feather")
```

```r
# R
library(arrow)
df <- read_feather("shared/data.feather")
write_feather(results, "shared/results.feather")
```

## Python <-> Stata Patterns

### Using DTA Format

```python
# %% Python: Prepare for Stata
import pandas as pd

df = pd.DataFrame({
    'id': range(100),
    'revenue': [1000 * i for i in range(100)],
    'year': [2020 + i % 5 for i in range(100)]
})

# Write Stata format (version 118 for Stata 14+)
df.to_stata("shared/for_stata.dta", write_index=False, version=118)
```

```stata
* %% Stata: Analysis
use "shared/for_stata.dta", clear

* Panel regression
xtset id year
xtreg revenue i.year, fe

* Save estimates
estimates store model1
esttab model1 using "shared/regression_results.csv", replace csv
```

```python
# %% Python: Read Stata results
import pandas as pd

# Read regression output
results = pd.read_csv("shared/regression_results.csv")
print(results)
```

### Handling Stata Value Labels

```python
# %% Python: Preserve value labels
import pandas as pd

df = pd.DataFrame({
    'status': pd.Categorical(['active', 'inactive', 'pending'] * 100)
})

# Stata needs numeric with labels
df['status_code'] = df['status'].cat.codes

# Create label mapping for Stata
labels = dict(enumerate(df['status'].cat.categories))
print(f"Label mapping: {labels}")

df[['status_code']].to_stata("shared/with_labels.dta",
                              write_index=False,
                              variable_labels={'status_code': 'Status'},
                              version=118)
```

## Python <-> SAS Patterns

### Using CSV (Most Compatible)

```python
# %% Python: Prepare for SAS
import pandas as pd

df = pd.DataFrame({
    'patient_id': range(100),
    'treatment': ['A', 'B'] * 50,
    'outcome': [1.5 * i + 0.5 for i in range(100)]
})

# SAS prefers clean CSV
df.to_csv("shared/for_sas.csv", index=False)
```

```sas
* %% SAS: Import and analyze
proc import datafile="shared/for_sas.csv"
    out=work.analysis_data
    dbms=csv
    replace;
run;

proc glm data=work.analysis_data;
    class treatment;
    model outcome = treatment;
    output out=work.predictions p=predicted;
run;

proc export data=work.predictions
    outfile="shared/sas_predictions.csv"
    dbms=csv
    replace;
run;
```

```python
# %% Python: Read SAS results
import pandas as pd

predictions = pd.read_csv("shared/sas_predictions.csv")
print(predictions.head())
```

### Reading SAS7BDAT Files

```python
# %% Python: Read SAS data
import pandas as pd

# Read SAS dataset
df = pd.read_sas("data/sasdata.sas7bdat", format='sas7bdat')

# Handle SAS dates (days since 1960-01-01)
sas_epoch = pd.Timestamp('1960-01-01')
df['date'] = sas_epoch + pd.to_timedelta(df['sas_date'], unit='D')
```

## DuckDB for Cross-Kernel SQL

DuckDB can query parquet files directly, enabling SQL access from any kernel.

### Python with DuckDB

```python
# %%
import duckdb

# Query parquet directly
result = duckdb.sql("""
    SELECT
        group,
        AVG(x) as mean_x,
        COUNT(*) as n
    FROM 'shared/analysis_data.parquet'
    GROUP BY group
""").df()

print(result)
```

### R with DuckDB

```r
# %%
library(duckdb)
library(DBI)

con <- dbConnect(duckdb())

result <- dbGetQuery(con, "
    SELECT
        group,
        AVG(x) as mean_x,
        COUNT(*) as n
    FROM 'shared/analysis_data.parquet'
    GROUP BY group
")

dbDisconnect(con, shutdown=TRUE)
print(result)
```

## Full Pipeline Example

### Step 1: Python Data Preparation

```python
# %% [markdown]
# # Step 1: Data Preparation (Python)

# %%
import pandas as pd
import numpy as np
from pathlib import Path

# Create output directory
Path("pipeline/").mkdir(exist_ok=True)

# Load and clean raw data
df = pd.read_csv("raw/survey.csv")
df = df.dropna(subset=['income', 'age'])
df['log_income'] = np.log(df['income'])

# Save for downstream kernels
df.to_parquet("pipeline/clean_data.parquet")
df.to_stata("pipeline/clean_data.dta", write_index=False, version=118)

print(f"Saved {len(df)} records")
```

### Step 2: R Statistical Analysis

```r
# %% [markdown]
# # Step 2: Statistical Analysis (R)

# %%
library(arrow)
library(tidyverse)
library(broom)

df <- read_parquet("pipeline/clean_data.parquet")

# Run models
model1 <- lm(log_income ~ age + education, data = df)
model2 <- lm(log_income ~ age + education + region, data = df)

# Tidy results
results <- bind_rows(
    tidy(model1) |> mutate(model = "basic"),
    tidy(model2) |> mutate(model = "with_region")
)

write_parquet(results, "pipeline/model_coefficients.parquet")
```

### Step 3: Stata Robustness Checks

```stata
* %% [markdown]
* # Step 3: Robustness Checks (Stata)

* %%
use "pipeline/clean_data.dta", clear

* Quantile regression for robustness
qreg log_income age education, quantile(0.5)
estimates store median_reg

* Export results
esttab median_reg using "pipeline/quantile_results.csv", replace csv
```

### Step 4: Python Final Report

```python
# %% [markdown]
# # Step 4: Aggregate Results (Python)

# %%
import pandas as pd

# Load all results
ols_results = pd.read_parquet("pipeline/model_coefficients.parquet")
quantile_results = pd.read_csv("pipeline/quantile_results.csv")

print("OLS Results:")
print(ols_results)

print("\nQuantile Regression Results:")
print(quantile_results)
```

## Best Practices

### 1. Establish Data Contract

Document expected columns and types:

```python
# data_contract.py
CLEAN_DATA_SCHEMA = {
    'id': 'int64',
    'date': 'datetime64[ns]',
    'amount': 'float64',
    'category': 'category'
}
```

### 2. Validate on Read

```python
# %%
def validate_schema(df, expected_schema):
    """Validate dataframe matches expected schema."""
    for col, dtype in expected_schema.items():
        if col not in df.columns:
            raise ValueError(f"Missing column: {col}")
        if str(df[col].dtype) != dtype:
            print(f"Warning: {col} is {df[col].dtype}, expected {dtype}")

df = pd.read_parquet("pipeline/data.parquet")
validate_schema(df, CLEAN_DATA_SCHEMA)
```

### 3. Use Checksums

```python
# %%
import hashlib

def file_checksum(path):
    """Generate MD5 checksum for data file."""
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

checksum = file_checksum("pipeline/clean_data.parquet")
print(f"Data checksum: {checksum}")
```

### 4. Document Pipeline Steps

```python
# %%
import json
from datetime import datetime

pipeline_log = {
    'step': 'python_prep',
    'timestamp': datetime.now().isoformat(),
    'input_files': ['raw/survey.csv'],
    'output_files': ['pipeline/clean_data.parquet'],
    'row_count': len(df),
    'checksum': file_checksum("pipeline/clean_data.parquet")
}

with open("pipeline/step1_log.json", 'w') as f:
    json.dump(pipeline_log, f, indent=2)
```
