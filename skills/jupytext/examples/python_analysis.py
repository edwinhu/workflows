# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Data Analysis Template
#
# This template demonstrates jupytext percent format conventions.
# Use as starting point for Python data analysis notebooks.

# %% tags=["parameters"]
# Parameters cell - compatible with papermill
INPUT_FILE = "data/raw/input.csv"
OUTPUT_DIR = "data/processed"
ANALYSIS_DATE = "2024-01-01"

# %%
# Standard imports
import pandas as pd
import numpy as np
from pathlib import Path

# Ensure output directory exists
Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

# %% [markdown]
# ## Data Loading

# %%
# Load and inspect data
df = pd.read_csv(INPUT_FILE)
print(f"Loaded {len(df):,} rows, {len(df.columns)} columns")
df.head()

# %%
# Data types and missing values
df.info()

# %% [markdown]
# ## Data Cleaning

# %%
# Clean column names
df.columns = df.columns.str.lower().str.replace(' ', '_')

# Handle missing values
df = df.dropna(subset=['id'])  # Required columns
df = df.fillna({'optional_col': 0})  # Default values

# Type conversions
if 'date' in df.columns:
    df['date'] = pd.to_datetime(df['date'])

# %% [markdown]
# ## Feature Engineering

# %%
# Create derived features
# df['log_value'] = np.log1p(df['value'])
# df['year'] = df['date'].dt.year

# %% [markdown]
# ## Data Export
#
# Export to parquet for cross-kernel compatibility.

# %%
# Save processed data
output_path = Path(OUTPUT_DIR) / "processed.parquet"
df.to_parquet(output_path, engine='pyarrow')
print(f"Saved to {output_path}")

# Also save Stata format if needed for downstream analysis
stata_path = Path(OUTPUT_DIR) / "processed.dta"
df.to_stata(stata_path, write_index=False, version=118)
print(f"Saved to {stata_path}")

# %% [markdown]
# ## Summary Statistics

# %%
df.describe()
