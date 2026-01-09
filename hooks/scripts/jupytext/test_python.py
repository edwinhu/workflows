# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#       jupytext_version: 1.18.1
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Python Analysis Test

# %%
import pandas as pd
import numpy as np

# %%
# This has a style issue: no spaces around operators
x=1+2
y = x * 3

# %%
df = pd.DataFrame({
    'a': [1, 2, 3],
    'b': [4, 5, 6]
})
print(df.head())
