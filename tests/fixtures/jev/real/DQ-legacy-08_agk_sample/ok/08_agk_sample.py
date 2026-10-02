# --- excerpt: source lines 313-381 ---
def _reproduce_step5(membership: pl.DataFrame, own: pl.DataFrame,
                     band: pl.DataFrame, label: str) -> tuple[pl.DataFrame, dict]:
    """step5's sample rule, applied to whatever September ownership panel it is handed.

    step5 is a PERMNO-grain sample: russell_membership inner-joined to the September ownership
    panel on (permno, year), restricted to window A and to the float-weight band, then AGK's two
    exclusions, then the complete case on the outcome and the bridge controls
    (src/first_stage.py `bridge_samples`).
    """
    y0, y1 = config.AGK_SAMPLE_YEARS
    merged = membership.join(
        own.select(["permno", "recon_year", "fund_agk", "mf_total", "agk_exclude"]),
        on=["permno", "recon_year"], how="inner")
    win = merged.filter(pl.col("recon_year").is_between(y0, y1))
    in_band = win.join(band, on=["recon_year", "permco"], how="inner")
    after_excl = in_band.filter(~pl.col("agk_exclude").fill_null(True))
    final = after_excl.drop_nulls(
        subset=["fund_agk", "mcap_may", "float_proxy", "permno", "permco", "r2000"])
    print(f"[step5] {label}: window A matched {len(win):,} permno-rows -> float-weight band "
          f"{len(in_band):,} -> AGK exclusions {len(after_excl):,} -> complete case "
          f"{len(final):,}; {final['permco'].n_unique():,} firms, "
          f"{final['permno'].n_unique():,} share classes")
    audit = {"label": label, "n_window_a_matched": len(win),
             "n_in_band_permno_rows": len(in_band), "n_after_exclusions": len(after_excl),
             "n_final": len(final), "n_firms": int(final["permco"].n_unique()),
             "n_permno": int(final["permno"].n_unique())}
    return final, audit


def step5_counts(membership: pl.DataFrame, agk: pl.DataFrame,
                 co: pl.DataFrame) -> tuple[dict[str, int], dict]:
    """Per-year N of the PUBLISHED step5 sample, so the chain can show the gap it closes.

    THE UNIVERSE step5 RAN ON IS NOT THE ONE THIS TASK SHIPS. step5 was estimated before
    ownership_agk.parquet's September universe was widened to the Russell rank-eligible share
    codes, so reproducing its rule on the CURRENT panel does not reproduce its N — it reproduces
    what step5 would have been had the universe already been fixed. Both are computed:

      * the reproduction on step5's OWN universe, recovered read-only from the untouched
        data/processed/ownership_panel.parquet, whose window-A (permno, rdate) rows ARE the old
        narrow universe. That is what the n_step5 column carries, and it is checked against the N
        data/output/agk_bridge.csv publishes, so the column is a reproduction this run verified
        rather than a number copied across;
      * the reproduction on the CURRENT panel, reported as a diagnostic. The difference between
        the two is an INDEPENDENT measurement of what the universe fix recovers, arrived at
        through step5's rule rather than through T11's chain.
    """
    y0, y1 = config.AGK_SAMPLE_YEARS
    own = agk.with_columns(pl.col("rdate").dt.year().cast(pl.Int64).alias("recon_year"))
    band = co.filter(pl.col("in_band")).select(["year", "permco"]).rename({"year": "recon_year"})
    print(f"[step5] in-band firm-years before dropping null permcos: {band.height:,}")
    band = band.drop_nulls(subset=["permco"])
    print(f"[step5] in-band firm-years after dropping null permcos: {band.height:,}")

    # step5's own universe, recovered from the panel this task does not touch (read-only)
    panel = pl.read_parquet(PANEL_PARQUET, columns=["permno", "rdate"])
    old_keys = (panel.filter(pl.col("rdate").dt.year().is_between(y0, y1))
                     .with_columns(pl.col("rdate").dt.year().cast(pl.Int64).alias("recon_year"))
                     .select(["permno", "recon_year"]).unique())
    own_old = own.join(old_keys, on=["permno", "recon_year"], how="inner")
    print(f"[step5] step5's own September universe, from ownership_panel.parquet (read-only): "
          f"{len(old_keys):,} (permno, year) keys; the current panel carries {len(own):,}, so the "
          f"universe fix adds {len(own) - len(old_keys):,} "
          f"({(len(own) - len(old_keys)) / len(old_keys):.2%} of {len(old_keys):,})")
    if len(own_old) != len(old_keys):
        raise AssertionError(
            f"the current AGK panel is missing {len(old_keys) - len(own_old):,} of the "
            f"{len(old_keys):,} (permno, year) keys step5 ran on; widening a universe must only add")

    final, audit = _reproduce_step5(membership, own_old, band, "reproduction on step5's universe")
    _cur, audit_cur = _reproduce_step5(membership, own, band,
                                       "the same rule on the CURRENT widened universe")
