# --- excerpt: source lines 84-130 ---
def russell_float() -> tuple[pl.DataFrame, dict]:
    """Russell's own float-adjusted company capitalisation per (recon_year, permco).

    Read through `src.window_b.taylor_company_frame` -- the committed reader this step's own
    treatment and band side come from -- so no second reading of the constituent file exists. No
    outcome enters an index weight, so the column is LAMBDA-BLIND.
    """
    co, audit = wb.taylor_company_frame()
    need = (RUSSELL_FLOAT_COL, "co_cap")
    missing = [c for c in need if c not in co.columns]
    if missing:
        raise AssertionError(f"{config.AGK_TAYLOR_TARGET_PARQUET.name} carries no {missing}; "
                             "Russell's own float-adjusted capitalisation is not on disk")
    out = co.select(["recon_year", "permco", RUSSELL_FLOAT_COL, "co_cap"])
    both = out.filter(pl.col(RUSSELL_FLOAT_COL).is_not_null() & pl.col("co_cap").is_not_null())
    corr = float(both.select(pl.corr(pl.col(RUSSELL_FLOAT_COL).log(),
                                     pl.col("co_cap").log())).item())
    audit |= {"float_column": RUSSELL_FLOAT_COL, "rows": out.height,
              "log_correlation_with_the_files_own_co_cap": corr,
              "denominator_of_that_correlation": both.height}
    print(f"[float] Russell's own {RUSSELL_FLOAT_COL} on {out.height:,} company-years; "
          f"log-correlation with the file's own co_cap {corr:.8f} over {both.height:,} of them")
    return out.select(["recon_year", "permco", RUSSELL_FLOAT_COL]), audit


def float_swapped(frame: pl.DataFrame, right: pl.DataFrame, grain: str) -> pl.DataFrame:
    """One grain's frame with `ln_float_june_block` rebuilt on Russell's own float capitalisation."""
    if FLOAT_COL not in frame.columns:
        raise AssertionError(f"the {grain} frame carries no {FLOAT_COL}; AGK's float control is not "
                             "on its rows")
    n_in = frame.height
    joined = frame.drop(FLOAT_COL).join(right, on=["recon_year", "permco"], how="left")
    if joined.height != n_in:
        raise AssertionError(f"the {RUSSELL_FLOAT_COL} join fanned out: {n_in} -> {joined.height}")
    n_null = int(joined[RUSSELL_FLOAT_COL].is_null().sum())
    n_nonpos = int(joined.filter(pl.col(RUSSELL_FLOAT_COL) <= 0).height)
    out = (joined.filter(pl.col(RUSSELL_FLOAT_COL).is_not_null()
                         & (pl.col(RUSSELL_FLOAT_COL) > 0))
                 .with_columns(pl.col(RUSSELL_FLOAT_COL).log().alias(FLOAT_COL))
                 .drop(RUSSELL_FLOAT_COL))
    print(f"[{grain}] {n_in:,} rows -> {out.height:,} ({n_null} carry no Russell float, "
          f"{n_nonpos} carry a non-positive one; both leave by the complete case)")
    if out[FLOAT_COL].null_count():
        raise AssertionError(f"the {grain} frame still carries a null {FLOAT_COL}")
    return out


