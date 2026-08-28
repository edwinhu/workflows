#!/usr/bin/env python3
"""Contract for Tier 1: the exact seriesid pass, run before any fuzzy tier.

WHY THIS EXISTS
    ISS populates `seriesid` only from 2023 (15.0% of 2023 rows, 95.2% of 2024,
    97.7% of 2025) but `fundid` is stable across a fund's life, so a seriesid
    observed once can be carried back over every year that fundid appears.
    Measured 2026-08-28: this reaches 63.5% of all 238,445,215 ISS vote rows
    across 8,645 fundids -- by far the largest tier, and entirely exact.

    It must run as a DISTINCT PASS before the fuzzy tiers, for two reasons:
    a fuzzy tier that fires on a fund whose ID was available is a needless risk,
    and the exact share has to be reportable on its own (a precision claim that
    sums exact and fuzzy coverage into one number is not a precision claim).

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_tier1_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import tier1 as t1


@pytest.fixture
def npx_rows():
    """ISS rows at (fundid, year) grain, as the ladder receives them."""
    return pd.DataFrame([
        # fundid 1: tagged only in 2024, but voted since 2007
        {"fundid": 1, "year": 2007, "seriesid": None, "n": 500},
        {"fundid": 1, "year": 2015, "seriesid": None, "n": 800},
        {"fundid": 1, "year": 2024, "seriesid": "S000000042", "n": 300},
        # fundid 2: never tagged
        {"fundid": 2, "year": 2011, "seriesid": None, "n": 400},
        # fundid 3: tagged in two years, consistently
        {"fundid": 3, "year": 2024, "seriesid": "S000000013", "n": 100},
        {"fundid": 3, "year": 2025, "seriesid": "S000000013", "n": 150},
        # fundid 4: DISAGREEING ids across years -- must not be guessed at
        {"fundid": 4, "year": 2024, "seriesid": "S000000900", "n": 100},
        {"fundid": 4, "year": 2024, "seriesid": "S000000900", "n": 100},
        {"fundid": 4, "year": 2025, "seriesid": "S000000901", "n": 10},
    ])


def test_propagates_a_seriesid_back_over_untagged_years(npx_rows):
    """The whole tier: a 2024 tag resolves the same fund's 2007 votes."""
    out = t1.resolve(npx_rows)
    got = out.loc[out["fundid"] == 1]
    assert set(got["resolved_seriesid"]) == {"S000000042"}
    assert set(got["tier"]) == {"exact_seriesid"}


def test_leaves_an_untagged_fundid_alone(npx_rows):
    out = t1.resolve(npx_rows)
    got = out.loc[out["fundid"] == 2]
    assert got["resolved_seriesid"].isna().all()
    assert got["tier"].isna().all()


def test_takes_the_modal_id_when_a_fundid_disagrees_with_itself(npx_rows):
    """ISS occasionally reports two ids for one fundid; the majority wins.

    Silently taking max() would pick S000000901 on one row against two.
    """
    out = t1.resolve(npx_rows)
    got = out.loc[out["fundid"] == 4]
    assert set(got["resolved_seriesid"]) == {"S000000900"}


def test_flags_that_a_fundid_was_ambiguous(npx_rows):
    """A caller auditing precision must be able to find the guessed ones."""
    out = t1.resolve(npx_rows)
    assert out.loc[out["fundid"] == 4, "seriesid_ambiguous"].all()
    assert not out.loc[out["fundid"] == 1, "seriesid_ambiguous"].any()


def test_reports_exact_coverage_weighted_by_vote_rows(npx_rows):
    """Coverage is vote-row weighted -- a fund that voted twice is not Vanguard."""
    out = t1.resolve(npx_rows)
    cov = t1.coverage(out, weight="n")
    resolved = 500 + 800 + 300 + 100 + 150 + 100 + 100 + 10
    assert cov["vote_rows_total"] == resolved + 400
    assert cov["vote_rows_exact"] == resolved
    assert cov["tier"] == "exact_seriesid"


def test_preserves_every_input_row(npx_rows):
    out = t1.resolve(npx_rows)
    assert len(out) == len(npx_rows)
