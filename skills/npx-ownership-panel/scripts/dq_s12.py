"""dq_s12.py — the S12 data-quality controls, in one place.

S12's defects were diagnosed but the controls were being re-derived (or forgotten)
per analysis. This is the single declaration. Import it; do not retype 20171231.

None of these is a repair. S12's problems are either genuine source changes that
cannot be undone or vendor defects WRDS says have no clean fix, so what is on offer
is *controls* — flags that let an analysis state what it excluded and why.

Measured on mirror's own bridged, wficn-level panel (data/wrds_pass/tfn_holdings),
not taken on faith from the note.
"""

from __future__ import annotations

import polars as pl

# ---------------------------------------------------------------------------
# D5. The 2017Q4 feed change.
#
# From 2017Q4 the S12 feed switched from legacy SP to "strategic collection"
# (Thomson/Refinitiv, backfilled 2022Q4). WRDS reports +613% CUSIPs, +113% funds,
# and 34,385 funds that did not exist in the old feed.
#
# Measured here, on OUR panel, after the MFLINKS bridge:
#
#   quarter        funds   index funds     rows    cusips
#   2017-09-30     5,468           875     601K    16,826
#   2017-12-31     7,962         1,266   1,428K    26,122
#                 +45.6%        +44.7%    +138%     +55%
#
# It never reverts. And it is NOT a universe artifact that a fund filter removes:
# restricting to funds present before the break leaves index-fund counts flat
# (875 -> 922, inside the normal 872-928 band) but holdings rows still jump 601K ->
# 1,124K, because the SAME funds report ~60% more of their book. Median positions
# per fund goes 36 -> 58 with a duplicate factor of exactly 1.000. That is genuine
# reporting completeness, so there is nothing to repair.
#
# CONSEQUENCE: no level comparison may span this date. Count-based measures
# (num_mf_owners, breadth) are unusable across it. Share-based measures
# (index_pct, mf_pct) are mildly contaminated — the excess over trend was ~0.8pp,
# about 7% of level, because the new funds are numerous but small in US equity.
S12_FEED_CHANGE_RDATE = 20171231

# ---------------------------------------------------------------------------
# S12 coverage ends. tfn_holdings' last quarter is 2024-12-31, so any window
# declared through 2025 silently truncates rather than erroring.
S12_COVERAGE_END_RDATE = 20241231

# ---------------------------------------------------------------------------
# D5b / MFLINKS. The bridge was not backfilled for 2017Q4-2020Q2, so wficn match
# rates fall exactly where the feed expanded: ~77% pre-2017 to ~58-66% after.
# Coverage moves in opposite directions on the two sides of the same break, which
# is why a raw row count is a bad completeness check across it.
S12_MFLINKS_GAP = (20171231, 20200630)

# Measures that must NOT be compared across S12_FEED_CHANGE_RDATE at all.
S12_COUNT_MEASURES = ("num_mf_owners", "numowners", "dbreadth", "n_funds")

# Measures that MAY be compared across it, with the contamination stated.
S12_SHARE_MEASURES = ("mf_pct", "passive_pct", "index_pct", "pure_index_total")


def add_s12_flags(df: pl.DataFrame, rdate_col: str = "rdate") -> pl.DataFrame:
    """Attach the S12 control flags. Flags only — nothing is dropped or altered.

    s12_post_feed_change  observation is on the strategic-collection feed
    s12_beyond_coverage   observation is past S12's last quarter, so any
                          S12-derived column on it is absent rather than zero
    s12_mflinks_gap       observation falls in the un-backfilled MFLINKS window,
                          where the wficn bridge rate is structurally depressed
    """
    return df.with_columns(
        (pl.col(rdate_col) >= S12_FEED_CHANGE_RDATE).alias("s12_post_feed_change"),
        (pl.col(rdate_col) > S12_COVERAGE_END_RDATE).alias("s12_beyond_coverage"),
        (
            pl.col(rdate_col).is_between(*S12_MFLINKS_GAP)
        ).alias("s12_mflinks_gap"),
    )


def assert_no_level_comparison_spans_break(
    rdate_min: int, rdate_max: int, measure: str
) -> None:
    """Stop a count-based level comparison from straddling the 2017Q4 break.

    Call this from any analysis that reports a level or a trend in an S12 count
    over a window. It refuses rather than warns: the failure it prevents is a
    published number, and a warning in a log is not read at that point.
    """
    if measure not in S12_COUNT_MEASURES:
        return
    if rdate_min < S12_FEED_CHANGE_RDATE <= rdate_max:
        raise ValueError(
            f"{measure} is a count measure and the window {rdate_min}-{rdate_max} "
            f"spans the {S12_FEED_CHANGE_RDATE} S12 feed change (+45.6% funds, "
            f"+44.7% index funds in one quarter, never reverting). The change is "
            f"genuine coverage, not a defect, so it cannot be repaired — split the "
            f"window, or use a share measure from S12_SHARE_MEASURES and state the "
            f"~0.8pp contamination."
        )
