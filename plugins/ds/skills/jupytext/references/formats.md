# Jupytext Formats

Jupytext supports multiple text representations of Jupyter notebooks. Choose based on your workflow needs.

## Format Comparison

| Format | Extension | Cell Markers | Best For |
|--------|-----------|--------------|----------|
| **Percent** | `.py` | `# %%` | Production code, multi-kernel |
| **Light** | `.py` | Comments only | Simple scripts |
| **Sphinx** | `.py` | `# %%` + RST | Documentation |
| **Markdown** | `.md` | Code fences | Literate programming |
| **MyST** | `.md` | MyST syntax | Jupyter Book |
| **R Markdown** | `.Rmd` | Chunk syntax | R workflows |
| **Quarto** | `.qmd` | Quarto syntax | Cross-language publishing |

## Percent Format (Recommended)

The percent format is the most versatile and widely supported.

### Python (py:percent)

```python
# %% [markdown]
# # Analysis Title
#
# This is a markdown cell describing the analysis.

# %%
import pandas as pd
import numpy as np

# Load data
df = pd.read_csv("data.csv")

# %% [markdown]
# ## Data Exploration

# %%
# Display summary statistics
df.describe()

# %% tags=["parameters"]
# Cell with tags (e.g., for papermill)
input_file = "data.csv"
output_dir = "./results"
```

### R (R:percent)

```r
# %% [markdown]
# # R Analysis
#
# Using R kernel with jupytext.

# %%
library(tidyverse)
library(arrow)

# Read parquet from Python pipeline
df <- read_parquet("data/processed.parquet")

# %% [markdown]
# ## Statistical Analysis

# %%
# Summary statistics
summary(df)

# Linear regression
model <- lm(y ~ x1 + x2, data = df)
summary(model)
```

### Stata (stata:percent)

```stata
* %% [markdown]
* # Stata Analysis
*
* Econometric analysis using Stata kernel.

* %%
* Load data from Python pipeline
use "data/processed.dta", clear

* %% [markdown]
* ## Regression Analysis

* %%
* Run regression
regress y x1 x2 x3
estimates store model1

* Robust standard errors
regress y x1 x2 x3, robust
```

### SAS (sas:percent)

```sas
* %% [markdown];
* # SAS Analysis;
* ;
* Statistical analysis using SAS kernel.;

* %%;
/* Import data */
proc import datafile="data/processed.csv"
    out=work.mydata
    dbms=csv
    replace;
run;

* %% [markdown];
* ## Descriptive Statistics;

* %%;
proc means data=work.mydata n mean std min max;
    var x1 x2 y;
run;
```

## Light Format

Minimal format that preserves notebook structure through strategic comments.

```python
# This is a markdown cell (implicit from comment structure)

# +
import pandas as pd

# Multiple line code cell
df = pd.read_csv("data.csv")
df.head()
# -

# Another markdown cell

print("Single expression cells don't need markers")
```

### When to Use Light Format

- Quick scripts that may become notebooks
- Minimal visual noise preferred
- Simple linear workflows

## Markdown Format

Standard markdown with fenced code blocks.

```markdown
# Analysis Title

This is a markdown cell.

```python
import pandas as pd
df = pd.read_csv("data.csv")
```

## Data Summary

```python
df.describe()
```
```

### Limitations

- No cell metadata support
- Language inference from fences
- Best for documentation-first workflows

## MyST Markdown Format

MyST (Markedly Structured Text) for Jupyter Book projects.

````markdown
---
jupytext:
  formats: md:myst,ipynb
  text_representation:
    extension: .md
    format_name: myst
kernelspec:
  display_name: Python 3
  language: python
  name: python3
---

# Analysis with MyST

This uses MyST markdown syntax.

```{code-cell} ipython3
import pandas as pd
df = pd.read_csv("data.csv")
```

```{code-cell} ipython3
:tags: [hide-input]

# This cell's input is hidden in output
df.describe()
```
````

### MyST Features

- Rich directive syntax
- Cross-references
- Jupyter Book integration
- Cell tags in code fence options

## R Markdown Format

For R-centric workflows.

```markdown
---
title: "Analysis"
output: html_document
---

```{r setup, include=FALSE}
library(tidyverse)
```

# Introduction

This is text content.

```{r}
data <- read_csv("data.csv")
summary(data)
```
```

## Quarto Format

Modern cross-language publishing format.

```markdown
---
title: "Multi-Language Analysis"
format: html
jupyter: python3
---

## Python Section

```{python}
import pandas as pd
df = pd.read_csv("data.csv")
```

## R Section

```{r}
library(tidyverse)
# Can share data via files
```
```

## Format Specification Syntax

When using jupytext commands, specify format precisely:

```bash
# Language and format
jupytext --to py:percent notebook.ipynb
jupytext --to py:light notebook.ipynb
jupytext --to R:percent notebook.ipynb

# Markdown variants
jupytext --to markdown notebook.ipynb
jupytext --to myst notebook.ipynb
jupytext --to md:myst notebook.ipynb

# R Markdown
jupytext --to Rmd notebook.ipynb
```

## Cell Metadata

Metadata can be preserved in different formats:

### Percent Format

```python
# %% tags=["parameters", "hide-input"]
# Cell with tags

# %% language="R"
# Run R code in Python notebook
```

### MyST Format

````markdown
```{code-cell} ipython3
:tags: [parameters]

param = "value"
```
````

## Configuration Options

### jupytext.toml Full Example

```toml
# Default format pairing
formats = "ipynb,py:percent"

# Metadata filtering
notebook_metadata_filter = "-all"
cell_metadata_filter = "-all"

# Or selective filtering
# notebook_metadata_filter = "kernelspec,jupytext"
# cell_metadata_filter = "tags,-all"

# Custom folder pairing
[formats]
"notebooks/" = "ipynb,scripts//py:percent"
"analysis/" = "ipynb,py:percent"

# R notebooks
[formats."*.Rmd"]
formats = "Rmd,ipynb"
```

### Per-Notebook Configuration

Add to notebook metadata:

```json
{
  "jupytext": {
    "formats": "ipynb,py:percent",
    "notebook_metadata_filter": "-all"
  }
}
```

## Format Selection Guide

| Scenario | Recommended Format |
|----------|-------------------|
| Production data pipelines | py:percent |
| Multi-kernel projects | py:percent, R:percent |
| Documentation/tutorials | md:myst |
| R-centric workflows | Rmd |
| Quick exploration | py:light |
| Publishing | qmd (Quarto) |
| Git-friendly | py:percent with metadata filtering |
