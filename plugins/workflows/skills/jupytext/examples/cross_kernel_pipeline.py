# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Cross-Kernel Data Pipeline
#
# This example demonstrates data sharing between Python, R, and Stata
# using jupytext and file-based interchange formats.
#
# ## Pipeline Overview
#
# ```
# Step 1: Python - Data preparation (this file)
#     |
#     v
# Step 2: R - Statistical analysis (r_analysis.R)
#     |
#     v
# Step 3: Stata - Econometric models (stata_models.do)
#     |
#     v
# Step 4: Python - Results aggregation (this file, end section)
# ```

# %% [markdown]
# ## Step 1: Python Data Preparation

# %%
import pandas as pd
import numpy as np
from pathlib import Path

# Create output directories
Path("pipeline/").mkdir(exist_ok=True)
Path("results/").mkdir(exist_ok=True)

# %% [markdown]
# ### Generate Sample Data

# %%
# Sample data for demonstration
np.random.seed(42)
n = 1000

df = pd.DataFrame({
    'id': range(n),
    'year': np.random.choice([2020, 2021, 2022, 2023], n),
    'group': np.random.choice(['A', 'B', 'C'], n),
    'x1': np.random.randn(n),
    'x2': np.random.randn(n) * 2 + 1,
    'treatment': np.random.choice([0, 1], n, p=[0.7, 0.3]),
})

# Create outcome with known relationship
df['y'] = (
    2.5 +
    0.8 * df['x1'] +
    1.2 * df['x2'] +
    0.5 * df['treatment'] +
    np.random.randn(n) * 0.5
)

print(f"Created dataset: {len(df)} observations")
df.head()

# %% [markdown]
# ### Export for Downstream Kernels

# %%
# Parquet for R (best format for Python <-> R)
df.to_parquet("pipeline/analysis_data.parquet", engine='pyarrow')
print("Saved: pipeline/analysis_data.parquet (for R)")

# Stata format for Stata kernel
df.to_stata("pipeline/analysis_data.dta", write_index=False, version=118)
print("Saved: pipeline/analysis_data.dta (for Stata)")

# CSV as universal fallback
df.to_csv("pipeline/analysis_data.csv", index=False)
print("Saved: pipeline/analysis_data.csv (universal)")

# %% [markdown]
# ### Data Contract Documentation

# %%
# Document the data contract for downstream steps
data_contract = """
# Data Contract: analysis_data

## Columns
- id: int64 - Unique identifier
- year: int64 - Year (2020-2023)
- group: string - Group category (A, B, C)
- x1: float64 - Predictor 1 (standardized)
- x2: float64 - Predictor 2 (mean ~1, sd ~2)
- treatment: int64 - Treatment indicator (0/1)
- y: float64 - Outcome variable

## True Model
y = 2.5 + 0.8*x1 + 1.2*x2 + 0.5*treatment + noise

## Files
- pipeline/analysis_data.parquet (for R)
- pipeline/analysis_data.dta (for Stata)
- pipeline/analysis_data.csv (universal)
"""
with open("pipeline/DATA_CONTRACT.md", "w") as f:
    f.write(data_contract)

print("Data contract written to pipeline/DATA_CONTRACT.md")

# %% [markdown]
# ---
# ## Step 4: Results Aggregation
#
# After running R and Stata steps, aggregate results here.

# %%
# Check if downstream results exist
from pathlib import Path

r_results = Path("results/r_coefficients.parquet")
stata_results = Path("results/stata_estimates.csv")

# %%
# Aggregate results (run after R and Stata steps complete)
if r_results.exists():
    r_coef = pd.read_parquet(r_results)
    print("R Results:")
    print(r_coef)

if stata_results.exists():
    stata_est = pd.read_csv(stata_results)
    print("\nStata Results:")
    print(stata_est)

# %%
# Create comparison table if both exist
if r_results.exists() and stata_results.exists():
    comparison = pd.DataFrame({
        'variable': ['x1', 'x2', 'treatment'],
        'true_value': [0.8, 1.2, 0.5],
        'r_estimate': r_coef.set_index('term').loc[['x1', 'x2', 'treatment'], 'estimate'].values,
        'stata_estimate': stata_est.set_index('variable').loc[['x1', 'x2', 'treatment'], 'coef'].values
    })

    print("\nModel Comparison:")
    print(comparison)
    comparison.to_parquet("results/final_comparison.parquet")
