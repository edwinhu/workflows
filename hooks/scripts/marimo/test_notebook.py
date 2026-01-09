import marimo

__generated_with = "0.10.9"
app = marimo.App()


@app.cell
def _():
    import pandas as pd
    import numpy as np
    return pd, np


@app.cell
def _(pd)  # SYNTAX ERROR: Missing colon - will be caught by marimo check
    df = pd.DataFrame({'a': [1, 2, 3]})
    return df,


@app.cell
def _(df):
    print(df.head())
    return


if __name__ == "__main__":
    app.run()
