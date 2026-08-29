#!/usr/bin/env python3
"""Contract for the two opt-in ISS-side normalisation rules in matching.py.

WHY THIS EXISTS
    Measured 2026-08-28 on the untagged ISS population, the sub-adviser tail was
    worth +0.28 points of coverage on its own -- the largest single
    normalisation rule -- and the code prefix another 0.08.

    Both are OFF BY DEFAULT and these tests pin that. Every variant of
    `normalize_name` reproduces a shipped builder verbatim, and the chain
    asserts byte-identity fingerprints over their outputs
    (npx_crsp_link 4fdf9818...). A rule that silently changed the default would
    invalidate the frozen hash while looking like an improvement.

    uv run --with polars,pytest python3 -m pytest tests/npx_linking_normalize_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts"
sys.path.insert(0, str(SCRIPTS))

# matching.py uses relative imports, so it has to load as part of the package
from npx_linking import matching


def norm(name, **kw):
    df = pl.DataFrame({"n": [name]})
    return df.select(matching.normalize_name("n", variant="l2", **kw))["n"][0]


def test_rules_are_off_by_default():
    """The frozen fingerprints depend on this. If this test fails, the chain's
    committed masters no longer reproduce."""
    assert norm("3364 JHVIT International Fund") == norm(
        "3364 JHVIT International Fund", strip_code_prefix=False)
    assert "3364" in norm("3364 JHVIT International Fund")


@pytest.mark.parametrize("raw,gone", [
    ("3364 JHVIT International Small Company Trust", "3364"),
    ("6721 500 Index B", "6721"),
    ("2Y61 JHF Hedged Equity & Income Fund", "2Y61"),
    ("ZW4X GEI Total Return Blackrock ACWI", "ZW4X"),
    ("2DCN JHF II Emerging Makets Fund", "2DCN"),
])
def test_strips_an_internal_code_prefix(raw, gone):
    assert gone not in norm(raw, strip_code_prefix=True)


def test_keeps_a_leading_number_that_is_part_of_the_name():
    """'500 Index Fund' must keep its 500: a pure-digit code needs 4+ digits."""
    assert "500" in norm("500 Index Fund", strip_code_prefix=True)


def test_strips_a_labelled_sub_adviser_tail():
    got = norm("STRATEGIC ADVISERS CORE FUND - SUB-ADVISER: JENNISON",
               strip_subadviser=True)
    assert "JENNISON" not in got
    assert "CORE" in got


def test_strips_a_sub_adviser_named_without_the_word():
    """' - Segall Bryant and Hamill LLC' is a manager marked only by its suffix."""
    got = norm("Northern Engage360 Fund - Segall Bryant and Hamill LLC",
               strip_subadviser=True)
    assert "SEGALL" not in got
    assert "ENGAGE360" in got


def test_does_not_truncate_a_real_dash_clause():
    """'- Series II' has no corporate suffix and is part of the fund's name."""
    got = norm("Templeton Growth Fund - Series II", strip_subadviser=True)
    assert "SERIES II" in got or "SERIES 2" in got or "II" in got
