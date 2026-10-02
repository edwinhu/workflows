# --- excerpt: source lines 24-26 ---
import numpy as np
import pandas as pd
import polars as pl

# --- excerpt: source lines 57-98 ---
def build(d: pl.DataFrame) -> pd.DataFrame:
    x = d.filter(pl.col("in_headline")).with_columns(
        mgmt_for=pl.col("mgmtrec").cast(pl.Utf8).str.to_lowercase().str.contains("for"),
        # explicit code map; `!=` inference would count code 3 as disagreement
        iss_disagree=(pl.col("rec_iss_clean") == 0),
        gl_disagree=(pl.col("rec_gl_clean") == 0),
        log_me=pl.when(pl.col("me") > 0).then(pl.col("me").log()).otherwise(None),
        log_ior=pl.when(pl.col("ior") > 0).then(pl.col("ior").log()).otherwise(None),
    )
    keep = ["divergence", "block_n_funds", "log_block_n_funds", "item_category",
            "year", XS_CLUSTER_XS, "block_size"] + COVARS_ME
    return x.select(keep).to_pandas()


def fit(df: pd.DataFrame, spec: str):
    d = df.copy()
    covars = COVARS_ME if spec == "with_me" else COVARS
    if spec == "n_ge_25":
        d = d[d.block_n_funds >= XS_FUND_FLOOR]
    elif spec == "n_ge_50":
        d = d[d.block_n_funds >= 50]
    # complete cases on the covariate block; report what that costs
    d = d.dropna(subset=["divergence", XS_CLUSTER_XS] + covars)
    d = d.dropna(subset=["block_size"])
    X = pd.get_dummies(
        d[["item_category", "year"]].astype(str), drop_first=True, dtype=float
    )
    for c in covars:
        X[c] = d[c].astype(float).values
    # block_size is a multiplicative factor of the DV -- a CONTROL, never excluded
    X["block_size"] = d["block_size"].values
    if spec == "log1p":
        X["log_block_n_funds"] = d["log_block_n_funds"].values
    elif spec == "decile_fe":
        dec = pd.qcut(d["block_n_funds"], 10, labels=False, duplicates="drop")
        X = X.join(pd.get_dummies(dec, prefix="nfd", drop_first=True, dtype=float)
                     .set_index(X.index))
    X = sm.add_constant(X, has_constant="add")
    m = sm.OLS(d["divergence"].values, X.values).fit(
        cov_type="cluster", cov_kwds={"groups": d[XS_CLUSTER_XS].values}
    )
    names = list(X.columns)
    return d, m, names
