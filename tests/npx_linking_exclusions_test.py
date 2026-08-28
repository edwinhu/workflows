#!/usr/bin/env python3
"""Contract for the Step 0 exclusion pass in the ISS->CRSP ladder.

WHY THIS EXISTS
    Some ISS N-PX filers can NEVER carry a SEC series ID, because they are not
    registered investment companies: public pension plans and other asset owners
    (CalPERS, CalSTRS, Texas TRS, CPP Investment Board, Ontario Teachers) and
    non-US managers (AXA, APG, the CIBC funds). ISS marks non-US managers with a
    trailing asterisk on `institutionname`.

    Measured 2026-08-28 over ISS voteanalysis_npx: 7 asset owners carry 1.04% of
    all vote rows and 170 non-US managers carry 0.99% -- about 2% that is
    structurally unlinkable, not a matching failure.

    They must be classified out BEFORE matching, not filtered from the results.
    Left in the pool they are live inputs to the global fuzzy tier, which will
    bind 'CalPERS' to some fund whose name shares tokens with California. An
    exclusion applied afterwards cannot undo a candidate it already influenced.

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_exclusions_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import exclusions as ex


@pytest.fixture
def funds():
    """Real shapes from ISS, including the ones that must survive."""
    return pd.DataFrame([
        # asset owners / plan sponsors -- never registered investment companies
        {"fundid": 1, "fundname": "CalPERS**", "institutionname": "CalPERS*"},
        {"fundid": 2, "fundname": "CalSTRS**", "institutionname": "CalSTRS*"},
        {"fundid": 3, "fundname": "Retirement Teachers of Texas**",
         "institutionname": "Retirement Teachers of Texas*"},
        {"fundid": 4, "fundname": "CPP Investment Board**",
         "institutionname": "CPP Investment Board*"},
        {"fundid": 5, "fundname": "Ontario Teacher Pension Plan Board**",
         "institutionname": "Ontario Teacher Pension Plan Board*"},
        # non-US managers -- the trailing asterisk is ISS's own marker
        {"fundid": 6, "fundname": "AXA Investment Managers**",
         "institutionname": "AXA Investment Managers*"},
        {"fundid": 7, "fundname": "CIBC European Index Fund*",
         "institutionname": "CIBC Asset Management*"},
        # MUST SURVIVE: ordinary US registered funds
        {"fundid": 8, "fundname": "Vanguard 500 Index Fund",
         "institutionname": "The Vanguard Group, Inc."},
        {"fundid": 9, "fundname": "Fidelity Contrafund",
         "institutionname": "Fidelity Management & Research"},
        # MUST SURVIVE: a real fund whose NAME contains an excluded keyword.
        # 'Retirement' appears in hundreds of target-date fund names.
        {"fundid": 10, "fundname": "T. Rowe Price Retirement 2040 Fund",
         "institutionname": "T. Rowe Price Associates, Inc."},
        {"fundid": 11, "fundname": "Fidelity Freedom Retirement Income Fund",
         "institutionname": "Fidelity Management & Research"},
    ])


def test_flags_asset_owners(funds):
    out = ex.classify(funds)
    got = set(out.loc[out["exclusion"] == "asset_owner", "fundid"])
    assert {1, 2, 3, 4, 5} <= got, got


def test_flags_non_us_managers(funds):
    out = ex.classify(funds)
    got = set(out.loc[out["exclusion"] == "non_us_manager", "fundid"])
    assert {6, 7} <= got, got


def test_keeps_ordinary_us_funds(funds):
    out = ex.classify(funds)
    kept = set(out.loc[out["exclusion"].isna(), "fundid"])
    assert {8, 9} <= kept, kept


def test_does_not_exclude_a_fund_merely_named_retirement(funds):
    """The keyword must be judged on the INSTITUTION, not the fund name.

    'Retirement' is in hundreds of legitimate target-date fund names; matching it
    against fundname would drop a whole product category.
    """
    out = ex.classify(funds)
    kept = set(out.loc[out["exclusion"].isna(), "fundid"])
    assert 10 in kept, "T. Rowe Price Retirement 2040 was excluded"
    assert 11 in kept, "Fidelity Freedom Retirement Income was excluded"


def test_every_row_is_classified(funds):
    out = ex.classify(funds)
    assert len(out) == len(funds)
    assert set(out["exclusion"].dropna()) <= {"asset_owner", "non_us_manager"}


def test_is_idempotent(funds):
    once = ex.classify(funds)
    twice = ex.classify(once)
    pd.testing.assert_series_equal(once["exclusion"], twice["exclusion"])
