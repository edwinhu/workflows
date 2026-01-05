# Multi-Kernel Setup

## Contents

- [Available Kernels](#available-kernels)
- [Python Kernel](#python-kernel)
- [R Kernel](#r-kernel)
- [Stata Kernel](#stata-kernel)
- [SAS Kernel](#sas-kernel)
- [Multi-Kernel Project Setup](#multi-kernel-project-setup)
- [Kernel Management](#kernel-management)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

Configure Jupyter kernels for Python, R, Stata, and SAS to enable cross-language data science workflows.

## Available Kernels

| Language | Kernel | Package | Notes |
|----------|--------|---------|-------|
| Python | `ipykernel` | `ipykernel` | Default, most mature |
| Python | `xeus-python` | `xeus-python` | Debugger support |
| R | `IRkernel` | `IRkernel` | Traditional R kernel |
| R | `xeus-r` | `xeus-r` | Modern, xeus-based |
| Stata | `stata_kernel` | `stata_kernel` | Requires Stata license |
| Stata | `pystata` | `pystata` | Official Stata kernel |
| SAS | `saspy` | `saspy` | Requires SAS installation |
| SAS | `sas_kernel` | `sas_kernel` | Alternative SAS kernel |

## Python Kernel

### Standard IPython Kernel

```bash
# Install
pip install ipykernel

# Register kernel
python -m ipykernel install --user --name python3 --display-name "Python 3"

# With specific environment
conda activate myenv
python -m ipykernel install --user --name myenv --display-name "Python (myenv)"
```

### Xeus Python (with Debugger)

```bash
# Install via conda (recommended)
conda install -c conda-forge xeus-python

# Or pip
pip install xeus-python
```

## R Kernel

### IRkernel (Traditional)

```r
# In R console
install.packages('IRkernel')
IRkernel::installspec()

# System-wide installation
IRkernel::installspec(user = FALSE)

# Custom name
IRkernel::installspec(name = 'ir44', displayname = 'R 4.4')
```

### Xeus-R (Modern)

```bash
# Install via conda
conda install -c conda-forge xeus-r

# Verify installation
jupyter kernelspec list
```

### R Kernel Configuration

Create `~/.jupyter/kernels/ir/kernel.json`:

```json
{
  "argv": ["R", "--slave", "-e", "IRkernel::main()", "--args", "{connection_file}"],
  "display_name": "R",
  "language": "R",
  "env": {
    "R_LIBS_USER": "~/R/library"
  }
}
```

## Stata Kernel

### Option 1: stata_kernel (Community)

```bash
# Install
pip install stata_kernel

# Configure (creates ~/.stata_kernel.conf)
python -m stata_kernel.install

# Verify Stata path in ~/.stata_kernel.conf
```

Configuration file (`~/.stata_kernel.conf`):

```ini
[stata_kernel]
# Path to Stata executable
stata_path = /usr/local/stata17/stata-mp

# Or on macOS
# stata_path = /Applications/Stata/StataMP.app/Contents/MacOS/stata-mp

# Graph settings
graph_format = svg
graph_width = 600
graph_height = 400
```

### Option 2: PyStata (Official)

Requires Stata 17+ with Python integration enabled.

```python
# In Python
import stata_setup
stata_setup.config("/usr/local/stata17", "mp")

# Register as Jupyter kernel
from pystata import config
config.init("mp")
```

### Stata Kernel for Jupytext

```stata
* %% [markdown]
* # Stata Analysis

* %%
sysuse auto, clear
summarize price mpg weight

* %%
regress price mpg weight foreign
```

## SAS Kernel

### SASPy Setup

```bash
# Install
pip install saspy

# Create configuration
mkdir -p ~/.config/saspy
```

Configuration file (`~/.config/saspy/sascfg_personal.py`):

```python
SAS_config_names = ['default']

default = {
    'saspath': '/opt/sas/SASFoundation/9.4/bin/sas_u8',
    'options': ['-nodms'],
    'encoding': 'utf-8'
}

# For SAS Viya
viya = {
    'ip': 'your-viya-server.com',
    'port': 443,
    'protocol': 'https',
    'context': 'SAS Studio compute context'
}
```

### SAS Kernel Registration

```bash
# Install sas_kernel
pip install sas_kernel

# Register kernel
jupyter kernelspec install sas_kernel --user
```

### SAS Kernel for Jupytext

```sas
* %% [markdown];
* # SAS Analysis;

* %%;
proc import datafile="data.csv"
    out=work.mydata
    dbms=csv;
run;

* %%;
proc means data=work.mydata;
    var x1 x2 y;
run;
```

## Multi-Kernel Project Setup

### Directory Structure

```
project/
├── jupytext.toml
├── environment.yml      # Conda environment with all kernels
├── notebooks/
│   ├── 01_python_prep.py    # Python percent format
│   ├── 02_r_analysis.R      # R percent format
│   ├── 03_stata_models.do   # Stata script
│   └── 04_sas_reports.sas   # SAS script
├── data/
│   ├── raw/
│   └── processed/
└── results/
```

### Environment Configuration

`environment.yml`:

```yaml
name: multikernel
channels:
  - conda-forge
  - defaults
dependencies:
  # Python
  - python=3.11
  - ipykernel
  - pandas
  - pyarrow
  - jupytext

  # R
  - r-base=4.3
  - r-irkernel
  - r-tidyverse
  - r-arrow

  # Optional: xeus kernels
  - xeus-python
  - xeus-r

  # Jupyter
  - jupyterlab
  - jupyter

  # pip dependencies
  - pip:
    - stata_kernel  # If using Stata
    - saspy         # If using SAS
```

### Kernel Selection in Jupytext

Specify kernel in file header:

```python
# ---
# jupyter:
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Python Analysis
```

```r
# ---
# jupyter:
#   kernelspec:
#     display_name: R
#     language: R
#     name: ir
# ---

# %% [markdown]
# # R Analysis
```

## Kernel Management

### List Installed Kernels

```bash
jupyter kernelspec list
```

### Remove Kernel

```bash
jupyter kernelspec remove kernel_name
```

### Verify Kernel Works

```bash
# Python
python -c "import ipykernel; print('OK')"

# R
Rscript -e "library(IRkernel); print('OK')"

# Stata (if stata_kernel installed)
python -c "import stata_kernel; print('OK')"
```

## Troubleshooting

### R Kernel Not Found

```r
# Reinstall IRkernel
install.packages('IRkernel', repos='https://cloud.r-project.org')
IRkernel::installspec(user = TRUE)
```

### Stata Kernel Connection Issues

```bash
# Check Stata path
which stata-mp

# Verify configuration
cat ~/.stata_kernel.conf

# Test Stata directly
stata-mp -b -e "display 'test'"
```

### SAS Connection Timeout

```python
# In Python, test SASPy connection
import saspy
sas = saspy.SASsession(cfgname='default')
print(sas.sasver())
sas.endsas()
```

### Kernel Crashes on Import

```bash
# Check for conflicting packages
pip check

# Reinstall kernel
pip uninstall ipykernel
pip install ipykernel
python -m ipykernel install --user
```

## Best Practices

1. **Use conda environments**: Isolate kernel dependencies
2. **Version pin**: Lock kernel versions in environment.yml
3. **Test kernels**: Verify each kernel works before starting project
4. **Document requirements**: Note kernel versions in README
5. **Use jupytext.toml**: Standardize format across team
