def _excerpt_1670_1742():  # excerpt wrapper: source lines 1670-1742 sit inside a function
    for name, (df, cols) in need.items():
        missing = [c for c in cols if c not in df.columns]
        if missing:
            raise KeyError(f"panel_vs_agk_universe: `{name}` is missing {missing}; "
                           f"have {sorted(df.columns)}")

    pw = panel.select(key).filter(pl.col("rdate").is_between(first, last))
    aw = agk.select(key).filter(pl.col("rdate").is_between(first, last))
    wk = widening.select([*key, "shrcd", "sharetype", "issuertype"]).filter(
        pl.col("rdate").is_between(first, last))
    assert_unique_keys(pw.height, pw.select(key).n_unique(),
                       "ownership_panel inside the AGK window (permno, rdate)")
    assert_unique_keys(aw.height, aw.select(key).n_unique(), "ownership_agk (permno, rdate)")
    assert_unique_keys(wk.height, wk.select(key).n_unique(),
                       "the AGK universe widening keys (permno, rdate)")

    only_agk = aw.join(pw, on=key, how="anti")
    only_panel = pw.join(aw, on=key, how="anti")
    attributed = only_agk.join(wk, on=key, how="inner")
    unattributed = only_agk.join(wk, on=key, how="anti")
    widening_outside_gap = wk.join(only_agk, on=key, how="anti")
    attributed = attributed.filter(pl.col("shrcd").is_not_null())
    added_pairs = set(AGK_UNIVERSE_PAIRS_ADDED)
    wrong_pair = attributed.filter(
        ~pl.struct(["sharetype", "issuertype"]).map_elements(
            lambda r: (r["sharetype"], r["issuertype"]) in added_pairs,
            return_dtype=pl.Boolean))

    if only_panel.height:
        raise AssertionError(
            f"{only_panel.height:,} (permno, rdate) keys are in ownership_panel.parquet and not in "
            f"ownership_agk.parquet inside {first}..{last}; the AGK predicate contains the panel "
            f"predicate ({AGK_UNIVERSE_PAIRS} contains {CIZ_COMMON_PAIRS}), so the AGK file cannot "
            "be missing a key the panel carries unless one of the two builds dropped rows")
    if unattributed.height:
        raise AssertionError(
            f"{unattributed.height:,} of the {only_agk.height:,} (permno, rdate) keys that "
            "ownership_agk.parquet carries and ownership_panel.parquet does not are NOT in the "
            "server-side widening set, so the difference between the two declared outputs is not "
            "fully explained by the universe clause; first keys: "
            f"{unattributed.head(5).to_dicts()}")
    if widening_outside_gap.height:
        raise AssertionError(
            f"{widening_outside_gap.height:,} keys the widening predicate adds are not in the "
            "difference between the two files, so one of the builds dropped a row its universe "
            f"admits; first keys: {widening_outside_gap.head(5).to_dicts()}")
    if wrong_pair.height:
        raise AssertionError(
            f"{wrong_pair.height:,} attributed keys carry a CIZ (sharetype, issuertype) outside "
            f"{sorted(added_pairs)}, so the difference is not the REIT clause it is recorded as; "
            f"first rows: {wrong_pair.head(5).to_dicts()}")

    def _counts(df, col):
        if not df.height:
            return {}
        g = df.group_by(col).len().sort(col)
        return {str(k): int(n) for k, n in zip(g[col].to_list(), g["len"].to_list(), strict=True)}

    by_september = []
    for d in sorted(dates):
        pn = int(pw.filter(pl.col("rdate") == d).height)
        an = int(aw.filter(pl.col("rdate") == d).height)
        gap = attributed.filter(pl.col("rdate") == d)
        by_september.append({
            "year": d.year, "rdate": d.isoformat(),
            "n_ownership_panel": pn, "n_ownership_agk": an,
            "n_agk_not_in_panel": int(only_agk.filter(pl.col("rdate") == d).height),
            "n_panel_not_in_agk": int(only_panel.filter(pl.col("rdate") == d).height),
            "n_attributed_to_the_reit_clause": int(gap.height),
            "n_unattributed": int(unattributed.filter(pl.col("rdate") == d).height),
            "by_legacy_shrcd": _counts(gap, "shrcd"),
        })

    pair_counts = {}
