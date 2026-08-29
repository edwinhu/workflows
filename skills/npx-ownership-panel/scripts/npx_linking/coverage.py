"""L4 coverage report — vote-row link coverage by year x tier x block.

Two denominators, always:

* **all rows** — every N-PX vote row;
* **registrant-only** — excluding ISS non-registrants (public pension plans and
  non-US managers, marked with a trailing ``*`` on `institutionname`, which
  have no SEC identifier *by construction*). They are a distinct population,
  not link failures.

Coverage is **row-weighted and is a conservative FLOOR** on power-weighted
coverage, never an estimate of it. Power weighting is not identified before
2023: `totalsharesvoted` is 2024+ only, and CRSP `tna_latest` is reachable only
*through* a link, so a TNA-weighted table returns ~100% in every year by
construction — selection, not coverage. The floor framing is earned by two
measured checks: in 2024, 3.0% of rows are unresolved but only 0.2% of shares
voted, and on the sliver where TNA is observed for both, median TNA is $169.8M
resolved against $6.2M unresolved (27x). The residual is systematically the
*smaller* funds, so row-weighting can only understate power coverage.

`n_vote_rows` on the link master is **uint32**; every aggregation here casts to
Float64 first and the reconciliation is asserted. A naive pandas/polars sum on
that dtype under-reports silently — it once put the index block at 6.3% when
the truth is 36.1%.

Outputs
-------
`data/output/l4_coverage.csv`          long: year x block x tier_system x tier
`data/output/l4_coverage_by_year.csv`  wide: the headline coverage table
`data/output/l4_coverage_by_tier.csv`  panel-wide tier ladder with yields
"""
import polars as pl

from ._config import cfg

__all__ = ["build_coverage", "COVERAGE_LONG", "COVERAGE_BY_YEAR", "COVERAGE_BY_TIER",
           "LINKED_SERIESID_TIERS", "LINKED_CRSP_TIERS"]

COVERAGE_LONG = cfg.OUT / "l4_coverage.csv"
COVERAGE_BY_YEAR = cfg.OUT / "l4_coverage_by_year.csv"
COVERAGE_BY_TIER = cfg.OUT / "l4_coverage_by_tier.csv"

# Everything except the terminal "did not resolve" label counts as linked.
#
# `linked` is computed as the COMPLEMENT of these labels, never as membership
# in an allow-list of linked tiers. That distinction is not stylistic: this file
# once carried a hand-maintained allow-list of six CRSP tiers, L3c and L3d added
# `digit_split_name` and `via_sec_ticker` to the master, and the two new tiers
# — 178 fundids, 721,567 vote rows — were silently counted as UNLINKED,
# understating panel coverage by 0.50pp. An allow-list fails open on exactly the
# event it is supposed to track; the complement fails closed.
UNLINKED_LABELS = frozenset({"unresolved", "unlinked", None})
# polars `is_in` takes a sequence; a null tier is terminal too and is handled
# by the explicit `is_not_null()` alongside it.
_UNLINKED_STRS = sorted(x for x in UNLINKED_LABELS if x is not None)

# The tiers each system is KNOWN to emit. These are documentation and a drift
# alarm, not the rule — `_assert_tiers_classified` raises on any tier absent
# from this vocabulary, so a new tier stops the run instead of being quietly
# misclassified in either direction.
# L3e's two tiers appear in BOTH lists on purpose: that stage resolves
# fundid->seriesId (a match_tier event) and attaches the crsp_fundno in the same
# pass (a crsp_match_tier event), so one row carries the same label in both
# columns. They were added here after L3e shipped without them — the alarm below
# would have fired on the very table the stage produced.
_L3E_TIERS = ("header_name", "header_name_confirmed")
LINKED_SERIESID_TIERS = ("iss_seriesid", "propagated", "cik_scoped_name",
                         "inst_scoped_name", "crsp_name", "global_name",
                         *_L3E_TIERS)
LINKED_CRSP_TIERS = ("via_seriesid", "via_ticker", "via_l2_crsp_name",
                     "crsp_name_scoped", "crsp_name_global", "feeder_master_name",
                     "digit_split_name", "via_sec_ticker", *_L3E_TIERS)
KNOWN_TIERS = {"match_tier": frozenset(LINKED_SERIESID_TIERS) | UNLINKED_LABELS,
               "crsp_match_tier": frozenset(LINKED_CRSP_TIERS) | UNLINKED_LABELS}


def _assert_tiers_classified(df, col):
    """Every observed tier must be a known linked tier or a known terminal one."""
    observed = set(df[col].unique().to_list())
    unknown = observed - KNOWN_TIERS[col]
    assert not unknown, (
        f"unclassified {col} value(s) {sorted(map(str, unknown))} — a new tier "
        f"reached the link master without being declared in coverage.py. Add it "
        f"to LINKED_{'SERIESID' if col == 'match_tier' else 'CRSP'}_TIERS (if it "
        f"is a link) or to UNLINKED_LABELS (if it is terminal) before trusting "
        f"any coverage number.")


def _fundid_year_rows():
    """Vote rows per (fundid, meeting year) — the coverage denominator.

    `pl.len()` returns **UInt32** and this column is the panel's 144.3M vote
    rows: 29.8x of headroom under the 4.29e9 UInt32 ceiling, so the hazard is
    LATENT rather than live, and a caller that sums it before the cast in
    `build_coverage` would be silently wrong at ~30x the current panel. The
    cast is therefore made where the column is CREATED, not where it is first
    used, so no future call site has to remember."""
    return (
        pl.scan_parquet(cfg.NPX_SERIESID)
        .select("fundid", year=pl.col("meetingdate").dt.year())
        .group_by(["fundid", "year"]).agg(n=pl.len().cast(pl.Float64))
        .filter(pl.col("year").is_between(cfg.SAMPLE_START, cfg.SAMPLE_END))
        .collect()
    )


def build_coverage(write=True, verbose=True):
    """Build the L4 coverage tables. Returns (long, by_year, by_tier)."""
    link = pl.read_parquet(cfg.NPX_CRSP_LINK).with_columns(
        # uint32 -> Float64 before ANY aggregation (see module docstring)
        n_vote_rows=pl.col("n_vote_rows").cast(pl.Float64),
        match_tier=pl.col("match_tier").fill_null("unresolved"),
        crsp_match_tier=pl.col("crsp_match_tier").fill_null("unlinked"),
    )
    # Guard the two casts above and in `_fundid_year_rows` — if either is ever
    # dropped, every sum below silently wraps past the UInt32 ceiling.
    assert link.schema["n_vote_rows"] == pl.Float64, (
        f"n_vote_rows is {link.schema['n_vote_rows']}, not Float64 — the "
        "uint32 cast was dropped; every aggregation below is unreliable")
    fy = _fundid_year_rows()
    assert fy.schema["n"] == pl.Float64, (
        f"per-(fundid, year) row count is {fy.schema['n']}, not Float64 — "
        "the uint32 cast in _fundid_year_rows was dropped")
    fy = fy.join(
        link.select("fundid", "block", "match_tier", "crsp_match_tier",
                    "iss_nonregistrant"),
        on="fundid", how="left",
    ).with_columns(
        n=pl.col("n").cast(pl.Float64),
        block=pl.col("block").fill_null("unknown"),
        match_tier=pl.col("match_tier").fill_null("unresolved"),
        crsp_match_tier=pl.col("crsp_match_tier").fill_null("unlinked"),
        iss_nonregistrant=pl.col("iss_nonregistrant").fill_null(False),
    )

    total_rows = fy["n"].sum()
    link_total = link["n_vote_rows"].sum()
    if verbose:
        print(f"vote rows in the coverage panel : {total_rows:,.0f}")
        print(f"vote rows on the link master    : {link_total:,.0f}")

    year_tot = fy.group_by("year").agg(
        rows_year_all=pl.col("n").sum(),
        rows_year_reg=pl.col("n").filter(~pl.col("iss_nonregistrant")).sum(),
    )

    long = []
    for system, col in (("seriesid", "match_tier"), ("crsp_fundno", "crsp_match_tier")):
        _assert_tiers_classified(link, col)
        _assert_tiers_classified(fy, col)
        g = (
            fy.group_by(["year", "block", col])
            .agg(n_vote_rows=pl.col("n").sum(),
                 n_vote_rows_reg=pl.col("n").filter(~pl.col("iss_nonregistrant")).sum(),
                 n_fundids=pl.col("fundid").n_unique())
            .rename({col: "tier"})
            .with_columns(tier_system=pl.lit(system),
                          # complement of the terminal labels — see UNLINKED_LABELS
                          linked=(pl.col("tier").is_not_null()
                                  & ~pl.col("tier").is_in(_UNLINKED_STRS)))
        )
        long.append(g)

    long = (
        pl.concat(long)
        .join(year_tot, on="year", how="left")
        .with_columns(
            pct_of_year_all=100 * pl.col("n_vote_rows") / pl.col("rows_year_all"),
            pct_of_year_reg=100 * pl.col("n_vote_rows_reg") / pl.col("rows_year_reg"),
            weighting=pl.lit("row"),
            coverage_kind=pl.lit("floor_on_power_weighted"),
        )
        .select("year", "tier_system", "tier", "linked", "block",
                "n_fundids", "n_vote_rows", "n_vote_rows_reg",
                "rows_year_all", "rows_year_reg",
                "pct_of_year_all", "pct_of_year_reg",
                "weighting", "coverage_kind")
        .sort(["tier_system", "year", "block", "tier"])
    )

    # --- reconciliation: the uint32 trap, and the join must not fan out ------
    for system in ("seriesid", "crsp_fundno"):
        s = long.filter(pl.col("tier_system") == system)["n_vote_rows"].sum()
        assert abs(s - total_rows) < 1.0, (
            f"{system} tier rows sum to {s:,.0f}, not {total_rows:,.0f} — "
            "n_vote_rows aggregation did not reconcile")
    for y, tot in year_tot.select("year", "rows_year_all").iter_rows():
        s = long.filter((pl.col("year") == y)
                        & (pl.col("tier_system") == "seriesid"))["n_vote_rows"].sum()
        assert abs(s - tot) < 1.0, f"year {y} does not reconcile ({s:,.0f} vs {tot:,.0f})"

    # --- headline: linked share per year, both systems, both denominators ---
    by_year = (
        long.group_by(["year", "tier_system"]).agg(
            rows_all=pl.col("n_vote_rows").sum(),
            rows_reg=pl.col("n_vote_rows_reg").sum(),
            linked_all=pl.col("n_vote_rows").filter(pl.col("linked")).sum(),
            linked_reg=pl.col("n_vote_rows_reg").filter(pl.col("linked")).sum(),
        )
        .with_columns(pct_linked_all=100 * pl.col("linked_all") / pl.col("rows_all"),
                      pct_linked_reg=100 * pl.col("linked_reg") / pl.col("rows_reg"))
        .sort(["tier_system", "year"])
        .pivot(on="tier_system",
               index=["year", "rows_all", "rows_reg"],
               values=["pct_linked_all", "pct_linked_reg"])
        .sort("year")
        .with_columns(weighting=pl.lit("row"),
                      coverage_kind=pl.lit("floor_on_power_weighted"))
    )

    by_tier = (
        long.group_by(["tier_system", "tier", "linked"]).agg(
            # fundid-years; see note below. `n_unique()` is UInt32, and this is
            # the one place it is SUMMED, so the cast belongs here (casting in
            # the agg would change the dtype written to `l4_coverage.csv`).
            n_fundids=pl.col("n_fundids").cast(pl.Float64).sum(),
            n_vote_rows=pl.col("n_vote_rows").sum(),
        )
        .with_columns(pct_vote_rows=100 * pl.col("n_vote_rows") / total_rows)
        .sort(["tier_system", "n_vote_rows"], descending=[False, True])
    )
    # `n_fundids` above double-counts a fundid that votes in several years or
    # blocks; the fundid-grain count is taken straight off the link master.
    fundid_counts = pl.concat([
        link.group_by("match_tier").agg(fundids=pl.len())
            .rename({"match_tier": "tier"})
            .with_columns(tier_system=pl.lit("seriesid")),
        link.group_by("crsp_match_tier").agg(fundids=pl.len())
            .rename({"crsp_match_tier": "tier"})
            .with_columns(tier_system=pl.lit("crsp_fundno")),
    ])
    by_tier = (by_tier.drop("n_fundids")
               .join(fundid_counts, on=["tier_system", "tier"], how="left")
               .select("tier_system", "tier", "linked", "fundids",
                       "n_vote_rows", "pct_vote_rows"))

    if write:
        cfg.OUT.mkdir(parents=True, exist_ok=True)
        long.write_csv(COVERAGE_LONG)
        by_year.write_csv(COVERAGE_BY_YEAR)
        by_tier.write_csv(COVERAGE_BY_TIER)
        if verbose:
            print(f"\nwrote {COVERAGE_LONG}  ({long.height:,} rows)")
            print(f"wrote {COVERAGE_BY_YEAR}  ({by_year.height:,} rows)")
            print(f"wrote {COVERAGE_BY_TIER}  ({by_tier.height:,} rows)")

    if verbose:
        with pl.Config(tbl_rows=60, tbl_cols=12, fmt_float="mixed"):
            print("\n--- linked share of vote rows, by year (row-weighted FLOOR) ---")
            print(by_year.select(
                "year", "rows_all",
                pct_seriesid_all=pl.col("pct_linked_all_seriesid").round(1),
                pct_seriesid_reg=pl.col("pct_linked_reg_seriesid").round(1),
                pct_crsp_all=pl.col("pct_linked_all_crsp_fundno").round(1),
                pct_crsp_reg=pl.col("pct_linked_reg_crsp_fundno").round(1),
            ))
            print("\n--- tier ladder, panel-wide ---")
            print(by_tier.with_columns(pl.col("pct_vote_rows").round(2)))

    return long, by_year, by_tier
