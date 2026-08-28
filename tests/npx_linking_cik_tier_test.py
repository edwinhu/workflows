#!/usr/bin/env python3
"""Contract for the CIK exact tier (Tier 2) in the ISS->CRSP ladder.

WHY THIS EXISTS
    A closed-end fund registers on Form N-2 as a SINGLE-PORTFOLIO registrant, so
    it carries no series ID and needs none: the CIK *is* the fund. Measured
    2026-08-28 over ISS voteanalysis_npx, 162 such fundids carry 987,107 vote
    rows (0.41% of all) -- Royce Micro-Cap Trust, Calamos Strategic Total
    Return, Cohen & Steers Total Return Realty, Neuberger Berman Real Estate.
    They currently reach the fuzzy tiers, which is both wasteful and risky:
    an exact identifier was available the whole time.

    THE GUARD IS THE WHOLE TIER. `fundcik` names a REGISTRANT, and a registrant
    may hold dozens of portfolios -- a Vanguard trust CIK resolves to many
    crsp_portno, and picking one would attribute a fund's votes to an arbitrary
    sibling. So the tier fires only where the CIK maps to exactly ONE portfolio;
    everything else must fall through to the name tiers untouched.

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_cik_tier_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import cik_tier as ct


@pytest.fixture
def funds():
    return pd.DataFrame([
        # single-portfolio registrant: a closed-end fund. CIK is the fund.
        {"fundid": 1, "fundcik": 1084991, "seriesid": None,
         "fundname": "ROYCE MICRO-CAP TRUST, INC"},
        # multi-portfolio registrant: must NOT be linked by CIK
        {"fundid": 2, "fundcik": 36405, "seriesid": None,
         "fundname": "Vanguard 500 Index Fund"},
        # already resolved by Tier 1 -- this tier must leave it alone
        {"fundid": 3, "fundcik": 1084991, "seriesid": "S000012345",
         "fundname": "Some Tagged Fund"},
        # no CIK at all
        {"fundid": 4, "fundcik": None, "seriesid": None,
         "fundname": "Nameless Trust"},
    ])


@pytest.fixture
def cik_map():
    """crsp_cik_map joined to portnomap: comp_cik -> (crsp_fundno, crsp_portno)."""
    return pd.DataFrame([
        {"comp_cik": 1084991, "crsp_fundno": 1001, "crsp_portno": 7001},
        # one portfolio, two share classes -- still ONE portfolio
        {"comp_cik": 1084991, "crsp_fundno": 1002, "crsp_portno": 7001},
        # a multi-portfolio registrant
        {"comp_cik": 36405, "crsp_fundno": 2001, "crsp_portno": 8001},
        {"comp_cik": 36405, "crsp_fundno": 2002, "crsp_portno": 8002},
    ])


def test_links_a_single_portfolio_registrant(funds, cik_map):
    out = ct.link_by_cik(funds, cik_map)
    row = out.loc[out["fundid"] == 1].iloc[0]
    assert row["crsp_portno"] == 7001
    assert row["tier"] == "cik_single_portfolio"


def test_share_classes_do_not_make_a_registrant_multi_portfolio(funds, cik_map):
    """Two crsp_fundno on ONE crsp_portno is a share-class pair, not two funds.

    Counting fundno instead of portno would refuse the tier for most CEFs.
    """
    out = ct.link_by_cik(funds, cik_map)
    assert out.loc[out["fundid"] == 1, "crsp_portno"].notna().all()


def test_refuses_a_multi_portfolio_registrant(funds, cik_map):
    """The guard. Picking one of many siblings would be a silent mis-attribution."""
    out = ct.link_by_cik(funds, cik_map)
    row = out.loc[out["fundid"] == 2].iloc[0]
    assert pd.isna(row["crsp_portno"])
    assert pd.isna(row["tier"])


def test_does_not_touch_a_fund_already_resolved_by_tier_1(funds, cik_map):
    out = ct.link_by_cik(funds, cik_map)
    row = out.loc[out["fundid"] == 3].iloc[0]
    assert pd.isna(row["tier"])


def test_handles_a_missing_cik(funds, cik_map):
    out = ct.link_by_cik(funds, cik_map)
    row = out.loc[out["fundid"] == 4].iloc[0]
    assert pd.isna(row["crsp_portno"])


def test_preserves_every_input_row(funds, cik_map):
    """A tier classifies; it never drops the residue the next tier needs."""
    out = ct.link_by_cik(funds, cik_map)
    assert len(out) == len(funds)
    assert set(out["fundid"]) == set(funds["fundid"])


def test_null_portno_does_not_make_a_registrant_look_single_portfolio():
    """`nunique()` drops NaN, so a registrant with one real portno and one null
    counted as ONE portfolio and the exact tier fired on a MULTI-portfolio
    registrant -- a silent mis-attribution in the guard that is the whole tier.
    Found by audit 0828-npx-linking-tiers-audit (CRITICAL).
    """
    funds = pd.DataFrame([
        {"fundid": 1, "fundcik": 999, "seriesid": None, "fundname": "Ambiguous Trust"},
    ])
    cik_map = pd.DataFrame([
        {"comp_cik": 999, "crsp_fundno": 1, "crsp_portno": 5001},
        {"comp_cik": 999, "crsp_fundno": 2, "crsp_portno": None},
    ])
    out = ct.link_by_cik(funds, cik_map)
    assert pd.isna(out.loc[out["fundid"] == 1, "crsp_portno"].iloc[0]), \
        "a registrant with an unmapped portfolio is not single-portfolio"
    assert pd.isna(out.loc[out["fundid"] == 1, "tier"].iloc[0])


def test_a_registrant_whose_only_portno_is_null_is_not_linked():
    """Nothing to link to: every portfolio row is unmapped."""
    funds = pd.DataFrame([
        {"fundid": 1, "fundcik": 888, "seriesid": None, "fundname": "Unmapped Trust"},
    ])
    cik_map = pd.DataFrame([
        {"comp_cik": 888, "crsp_fundno": 3, "crsp_portno": None},
    ])
    out = ct.link_by_cik(funds, cik_map)
    assert pd.isna(out.loc[out["fundid"] == 1, "crsp_portno"].iloc[0])
    assert pd.isna(out.loc[out["fundid"] == 1, "tier"].iloc[0])


def test_missing_cik_guard_is_load_bearing():
    """test_handles_a_missing_cik passed with the fundcik null-guard deleted,
    because no row in that fixture had a null CIK that ALSO matched a mapped
    registrant. Audit finding (MAJOR). Here the null CIK would join if unguarded.
    """
    funds = pd.DataFrame([
        {"fundid": 1, "fundcik": None, "seriesid": None, "fundname": "No CIK Fund"},
    ])
    cik_map = pd.DataFrame([
        {"comp_cik": None, "crsp_fundno": 9, "crsp_portno": 6001},
    ])
    out = ct.link_by_cik(funds, cik_map)
    assert pd.isna(out.loc[out["fundid"] == 1, "crsp_portno"].iloc[0])
