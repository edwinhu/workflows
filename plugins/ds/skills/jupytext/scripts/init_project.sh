#!/usr/bin/env bash
# Initialize a jupytext multi-kernel project with standard structure
#
# Usage: ./init_project.sh [project_name]
#
# Creates:
#   project_name/
#   ├── jupytext.toml
#   ├── environment.yml
#   ├── .pre-commit-config.yaml
#   ├── .gitignore
#   ├── notebooks/
#   ├── data/raw/
#   ├── data/processed/
#   └── results/

set -euo pipefail

PROJECT_NAME="${1:-my_project}"

echo "Creating jupytext project: $PROJECT_NAME"

# Create directory structure
mkdir -p "$PROJECT_NAME"/{notebooks,data/{raw,processed},results}

# Create jupytext.toml
cat > "$PROJECT_NAME/jupytext.toml" << 'EOF'
# Jupytext configuration
# Pair notebooks with percent-format Python files

formats = "ipynb,py:percent"

# Strip metadata for cleaner git diffs
notebook_metadata_filter = "-all"
cell_metadata_filter = "-all"

# Custom pairing for notebooks directory
[formats]
"notebooks/" = "ipynb,py:percent"
EOF

# Create environment.yml
cat > "$PROJECT_NAME/environment.yml" << 'EOF'
name: analysis
channels:
  - conda-forge
  - defaults
dependencies:
  # Python
  - python=3.11
  - ipykernel
  - pandas
  - numpy
  - pyarrow
  - jupytext

  # Jupyter
  - jupyterlab
  - jupyter

  # R (optional - uncomment if needed)
  # - r-base=4.3
  # - r-irkernel
  # - r-tidyverse
  # - r-arrow

  # Development
  - pre-commit

  # pip dependencies
  - pip:
    - duckdb
EOF

# Create .pre-commit-config.yaml
cat > "$PROJECT_NAME/.pre-commit-config.yaml" << 'EOF'
repos:
  - repo: https://github.com/mwouts/jupytext
    rev: v1.16.0
    hooks:
      - id: jupytext
        args: [--sync]
        files: '\.ipynb$'
EOF

# Create .gitignore
cat > "$PROJECT_NAME/.gitignore" << 'EOF'
# Python
__pycache__/
*.py[cod]
.ipynb_checkpoints/

# Optional: ignore .ipynb files (commit only .py)
# *.ipynb

# Data (usually large, not committed)
data/raw/*
data/processed/*
!data/raw/.gitkeep
!data/processed/.gitkeep

# Results
results/*
!results/.gitkeep

# Environment
.env
*.egg-info/
EOF

# Create .gitkeep files
touch "$PROJECT_NAME/data/raw/.gitkeep"
touch "$PROJECT_NAME/data/processed/.gitkeep"
touch "$PROJECT_NAME/results/.gitkeep"

# Create sample notebook
cat > "$PROJECT_NAME/notebooks/01_analysis.py" << 'EOF'
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
# # Analysis Notebook
#
# Created with jupytext project template.

# %%
import pandas as pd
import numpy as np

# %% [markdown]
# ## Data Loading

# %%
# Load your data here
# df = pd.read_csv("../data/raw/data.csv")

# %% [markdown]
# ## Analysis

# %%
# Your analysis code here
EOF

echo ""
echo "Project created: $PROJECT_NAME/"
echo ""
echo "Next steps:"
echo "  1. cd $PROJECT_NAME"
echo "  2. conda env create -f environment.yml"
echo "  3. conda activate analysis"
echo "  4. pre-commit install"
echo "  5. jupyter lab"
echo ""
echo "Structure:"
find "$PROJECT_NAME" -type f | head -20
