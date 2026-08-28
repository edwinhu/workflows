#!/usr/bin/env python3
"""Contract for the claim check: one fundid per crsp_portno per period.

WHY THIS EXISTS
    Resolving a fund is not the same as being allowed to add it. Measured on the
    MFLINKS rebuild: 27.4% of newly-resolved funds land on a `crsp_portno` that
    another already-bridged fund claims. That is a live double-count -- either
    the resolution is wrong, or the vendor carries one portfolio twice (share
    classes, duplicate records). A bridge that raises coverage while quietly
    doubling portfolios is worse than no bridge.

    So a collision is not resolved by admitting both: the higher-confidence link
    keeps the portfolio and the loser goes back to unresolved for a later tier or
    for the unlinked report. Confidence is the TIER, in ladder order -- an exact
    identifier beats a name match, always.

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_claim_check_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import claim_check as cc


@pytest.fixture
def links():
    return pd.DataFrame([
        # uncontested
        {"fundid": 1, "crsp_portno": 7001, "period": 2015, "tier": "sec_name"},
        # collision in 2015: exact must beat fuzzy
        {"fundid": 2, "crsp_portno": 7002, "period": 2015, "tier": "sec_name"},
        {"fundid": 3, "crsp_portno": 7002, "period": 2015, "tier": "exact_seriesid"},
        # the SAME portno in a DIFFERENT period is not a collision
        {"fundid": 4, "crsp_portno": 7002, "period": 2016, "tier": "sec_name"},
        # collision between two equal-confidence fuzzy links: both must yield
        {"fundid": 5, "crsp_portno": 7003, "period": 2015, "tier": "crsp_name_global"},
        {"fundid": 6, "crsp_portno": 7003, "period": 2015, "tier": "crsp_name_global"},
        # unresolved rows must pass through untouched
        {"fundid": 7, "crsp_portno": None, "period": 2015, "tier": None},
    ])


def test_leaves_an_uncontested_claim(links):
    out = cc.enforce(links)
    assert out.loc[out["fundid"] == 1, "crsp_portno"].iloc[0] == 7001


def test_exact_tier_wins_a_collision(links):
    out = cc.enforce(links)
    assert out.loc[out["fundid"] == 3, "crsp_portno"].iloc[0] == 7002
    assert out.loc[out["fundid"] == 3, "claim"].iloc[0] == "kept"


def test_loser_is_pushed_back_to_unresolved(links):
    """Not dropped -- a later tier or the unlinked report still needs the row."""
    out = cc.enforce(links)
    row = out.loc[out["fundid"] == 2].iloc[0]
    assert pd.isna(row["crsp_portno"])
    assert row["claim"] == "ceded"


def test_same_portno_in_another_period_is_not_a_collision(links):
    """The grain is (crsp_portno, period). A fund may inherit a portfolio later."""
    out = cc.enforce(links)
    assert out.loc[out["fundid"] == 4, "crsp_portno"].iloc[0] == 7002
    assert out.loc[out["fundid"] == 4, "claim"].iloc[0] == "kept"


def test_equal_confidence_collision_yields_both(links):
    """With no tiebreak, admitting either would be a coin flip presented as data."""
    out = cc.enforce(links)
    got = out.loc[out["fundid"].isin([5, 6])]
    assert got["crsp_portno"].isna().all()
    assert set(got["claim"]) == {"ceded"}


def test_unresolved_rows_pass_through(links):
    out = cc.enforce(links)
    row = out.loc[out["fundid"] == 7].iloc[0]
    assert pd.isna(row["crsp_portno"])
    assert pd.isna(row["claim"])


def test_no_portno_is_claimed_twice_in_a_period(links):
    """The invariant the whole check exists to establish."""
    out = cc.enforce(links)
    kept = out[out["crsp_portno"].notna()]
    assert not kept.duplicated(["crsp_portno", "period"]).any()


def test_preserves_every_input_row(links):
    out = cc.enforce(links)
    assert len(out) == len(links)
