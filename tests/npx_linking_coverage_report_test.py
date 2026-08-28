#!/usr/bin/env python3
"""Contract for the per-tier coverage report.

WHY THIS EXISTS
    The ladder's headline has always been one number -- "80.8% of vote rows
    linked" -- which silently mixes exact identifiers with global fuzzy matches.
    That number cannot answer the question a precision-first build is for: how
    much of the panel rests on an identifier, and how much on a guess.

    So the report states each tier separately and REFUSES to publish a single
    blended total. Exact and fuzzy are reported as distinct figures; a caller
    that wants a sum can add them, having seen both.

    Measured 2026-08-28 for the exact tiers: 63.5% of vote rows from the seriesid
    pass and 0.41% from the CIK single-portfolio tier.

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_coverage_report_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import coverage_report as cr


@pytest.fixture
def linked():
    return pd.DataFrame([
        {"fundid": 1, "tier": "exact_seriesid", "n": 600, "exclusion": None},
        {"fundid": 2, "tier": "exact_seriesid", "n": 400, "exclusion": None},
        {"fundid": 3, "tier": "cik_single_portfolio", "n": 100, "exclusion": None},
        {"fundid": 4, "tier": "sec_name", "n": 200, "exclusion": None},
        {"fundid": 5, "tier": "crsp_name_global", "n": 50, "exclusion": None},
        {"fundid": 6, "tier": None, "n": 150, "exclusion": None},
        # structurally unlinkable -- must not sit in the unlinked residue
        {"fundid": 7, "tier": None, "n": 500, "exclusion": "asset_owner"},
    ])


def test_reports_each_tier_separately(linked):
    rep = cr.build(linked, weight="n")
    by = {r["tier"]: r for r in rep["tiers"]}
    assert by["exact_seriesid"]["vote_rows"] == 1000
    assert by["cik_single_portfolio"]["vote_rows"] == 100
    assert by["sec_name"]["vote_rows"] == 200


def test_separates_exact_from_fuzzy(linked):
    rep = cr.build(linked, weight="n")
    assert rep["exact"]["vote_rows"] == 1100        # 1000 + 100
    assert rep["fuzzy"]["vote_rows"] == 250         # 200 + 50


def test_publishes_no_blended_total(linked):
    """The defect this report exists to remove: one number hiding the mix.

    The first version of this test asserted `"linked_pct" not in rep` and
    `"total_linked" not in rep` -- two key names the module never emitted under
    any implementation. An auditor patched build() to publish a real blended
    total under `linked`/`pct_linked` and the test stayed green. It was
    tautological: it named a guard and exercised nothing.

    The behaviour, stated so it can fail: no top-level value in the report may
    equal exact + fuzzy. That catches a blended total under ANY key name.
    """
    rep = cr.build(linked, weight="n")
    blended_rows = rep["exact"]["vote_rows"] + rep["fuzzy"]["vote_rows"]
    blended_pct = rep["exact"]["pct"] + rep["fuzzy"]["pct"]

    for key, val in rep.items():
        if key in ("exact", "fuzzy", "tiers"):
            continue
        if isinstance(val, dict):
            assert val.get("vote_rows") != blended_rows, (
                f"rep[{key!r}] publishes the blended exact+fuzzy total")
            assert val.get("pct") != blended_pct, (
                f"rep[{key!r}] publishes the blended exact+fuzzy pct")
        elif isinstance(val, (int, float)) and not isinstance(val, bool):
            assert val != blended_rows, f"rep[{key!r}] is the blended total"
            assert val != blended_pct, f"rep[{key!r}] is the blended pct"


def test_excluded_filers_are_not_counted_as_unlinked(linked):
    """CalPERS is not a matching failure; counting it as one understates precision."""
    rep = cr.build(linked, weight="n")
    assert rep["unlinked"]["vote_rows"] == 150
    assert rep["excluded"]["vote_rows"] == 500


def test_denominator_excludes_the_unlinkable(linked):
    """Percentages are of the LINKABLE universe, else the ceiling is unreachable."""
    rep = cr.build(linked, weight="n")
    assert rep["vote_rows_linkable"] == 1500        # 1750 total - 500 excluded
    assert abs(rep["exact"]["pct"] - 100 * 1100 / 1500) < 1e-9


def test_every_vote_row_is_accounted_for(linked):
    rep = cr.build(linked, weight="n")
    seen = (rep["exact"]["vote_rows"] + rep["fuzzy"]["vote_rows"]
            + rep["unlinked"]["vote_rows"] + rep["excluded"]["vote_rows"])
    assert seen == int(linked["n"].sum())
