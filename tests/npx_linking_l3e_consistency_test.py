#!/usr/bin/env python3
"""L3e's in-place update must leave the row self-consistent.

WHY THIS EXISTS

`update_in_place` fills a handful of columns on the rows it resolves, and it has
now shipped TWICE having updated the fields its author was thinking about while
leaving a dependent one stale:

    2026-08-29  `wficn` left NULL beside a freshly written `crsp_fundno`, so the
                1,333 new links were invisible to the S12/holdings path (fixed
                in 524dbb03). It survived review because the waterfall that
                checked it RECOMPUTED wficn from mflink1_cache instead of
                reading the column, so the verification bypassed the exact
                field that was broken.
    2026-08-29  `match_tier` left at "unresolved" beside a freshly written
                `seriesid`. A downstream build asserted on that pair and refused
                the table; a consumer that did not assert would have silently
                counted 1,333 resolved funds as unresolved.

Both are the same failure, not two coincidences: a partial update publishing a
row that contradicts itself. So the invariant under test is not "wficn is
filled" or "match_tier is set" — it is that NO COLUMN DISAGREES WITH ANOTHER
ABOUT WHETHER THE ROW IS RESOLVED. A third such column would fail this too.

    uv run --with polars,pytest python3 -m pytest tests/npx_linking_l3e_consistency_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

L3E_TIERS = ("header_name", "header_name_confirmed")


def test_l3e_tiers_are_declared_in_both_coverage_vocabularies():
    """coverage.py raises on an undeclared tier, and L3e shipped without one.

    `_assert_tiers_classified` is a drift alarm over every tier the link master
    carries. L3e writes its label into BOTH tier columns, so a tier missing from
    either list makes the alarm fire on the table the stage itself produced.

    Imported PACKAGE-QUALIFIED: `coverage.py` does `from ._config import cfg`,
    so loading it as a top-level module is `ImportError: attempted relative
    import with no known parent package` — and a bare `import coverage` would
    otherwise find the PyPI coverage package on a machine that has one.
    """
    sys.path.insert(0, str(SCRIPTS.parent))
    cov = pytest.importorskip(
        "npx_linking.coverage",
        reason="needs the package's own deps (numpy/polars); the gate has them")

    for tier in L3E_TIERS:
        assert tier in cov.LINKED_SERIESID_TIERS, (
            f"{tier} missing from LINKED_SERIESID_TIERS — coverage.py will raise "
            f"on any link master L3e has touched")
        assert tier in cov.LINKED_CRSP_TIERS, (
            f"{tier} missing from LINKED_CRSP_TIERS")
        assert tier in cov.KNOWN_TIERS["match_tier"]
        assert tier in cov.KNOWN_TIERS["crsp_match_tier"]


def _link_frame(rows):
    return pl.DataFrame(rows, schema={
        "fundid": pl.Float64, "seriesid": pl.Utf8, "crsp_fundno": pl.Float64,
        "wficn": pl.Float64, "match_tier": pl.Utf8, "crsp_match_tier": pl.Utf8,
        "iss_nonregistrant": pl.Boolean, "n_vote_rows": pl.UInt32,
    })


def _self_contradictions(df):
    """Rows whose columns disagree about whether the fund resolved."""
    return df.filter(
        # a seriesid with an `unresolved` label, or the reverse
        (pl.col("seriesid").is_not_null() & (pl.col("match_tier") == "unresolved"))
        | (pl.col("seriesid").is_null() & pl.col("match_tier").is_in(L3E_TIERS))
        # a CRSP link labelled unlinked, or the reverse
        | (pl.col("crsp_fundno").is_not_null()
           & (pl.col("crsp_match_tier") == "unlinked"))
        | (pl.col("crsp_fundno").is_null()
           & pl.col("crsp_match_tier").is_in(L3E_TIERS))
    )


def test_detects_the_match_tier_defect_that_shipped():
    """The exact row L3e published: seriesid written, match_tier left behind."""
    bad = _link_frame([{
        "fundid": 1.0, "seriesid": "S000000042", "crsp_fundno": 100.0,
        "wficn": 5.0, "match_tier": "unresolved", "crsp_match_tier": "header_name",
        "iss_nonregistrant": False, "n_vote_rows": 10,
    }])
    assert _self_contradictions(bad).height == 1


def test_detects_a_tier_without_the_id_it_claims():
    """The mirror defect: labelled resolved, no seriesid to show for it."""
    bad = _link_frame([{
        "fundid": 1.0, "seriesid": None, "crsp_fundno": 100.0, "wficn": 5.0,
        "match_tier": "header_name", "crsp_match_tier": "header_name",
        "iss_nonregistrant": False, "n_vote_rows": 10,
    }])
    assert _self_contradictions(bad).height == 1


def test_a_correctly_updated_row_passes():
    good = _link_frame([{
        "fundid": 1.0, "seriesid": "S000000042", "crsp_fundno": 100.0,
        "wficn": 5.0, "match_tier": "header_name",
        "crsp_match_tier": "header_name", "iss_nonregistrant": False,
        "n_vote_rows": 10,
    }])
    assert _self_contradictions(good).height == 0


def test_an_untouched_unresolved_row_passes():
    """L3e must not disturb a fund it did not resolve."""
    good = _link_frame([{
        "fundid": 2.0, "seriesid": None, "crsp_fundno": None, "wficn": None,
        "match_tier": "unresolved", "crsp_match_tier": "unlinked",
        "iss_nonregistrant": False, "n_vote_rows": 3,
    }])
    assert _self_contradictions(good).height == 0


@pytest.mark.parametrize("col", ["match_tier", "wficn"])
def test_update_in_place_writes_every_dependent_column(col):
    """The source must MENTION each column a resolved row depends on.

    Not a behavioural test — `update_in_place` needs the full parquet stack to
    run. It is a cheap guard against the specific regression that happened
    twice: adding a column to the fill set and forgetting a sibling.
    """
    src = (SCRIPTS / "build_npx_crsp_link_headers.py").read_text()
    body = src[src.index("def update_in_place"):]
    assert f"{col}=" in body, (
        f"update_in_place does not assign {col}; a resolved row will carry a "
        f"stale value and contradict the columns that were updated")
