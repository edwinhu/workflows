#!/usr/bin/env python3
"""Contract for the name matcher: normalisation variants and the accept bar.

WHY THIS EXISTS
    Measured 2026-08-28 on the untagged population, holding everything else
    fixed, the scorer was worth far more than any vocabulary change:

        Jaccard token-set        94.48% of the mutual-fund universe
        char 3-gram TF-IDF       97.81%
        + sparse_dot_topn top-k  98.37%
        + these variant rules    98.84%

    Each rule below earns its place from the residual it was built against, and
    each is a VARIANT of the query rather than a replacement -- the raw form
    still matches for most funds, and substituting it trades one miss for
    another (symmetric-concat did exactly that and cost 50 points).

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_matcher_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import matcher as m


def test_normalises_case_and_punctuation():
    assert m.norm("iSHARES BARCLAYS 3-7 YEAR  TREASURY") == "ishares barclays 3 7 year treasury"


@pytest.mark.parametrize("raw,want", [
    ("3364 JHVIT International Small Company Trust", "jhvit international small company trust"),
    ("6721 500 Index B", "500 index b"),
    ("2Y61 JHF Hedged Equity & Income Fund", "jhf hedged equity income fund"),
    ("ZW4X GEI Total Return Blackrock ACWI", "gei total return blackrock acwi"),
    ("2DCN JHF II Emerging Makets Fund", "jhf ii emerging makets fund"),
])
def test_strips_internal_code_prefixes(raw, want):
    """ISS prefixes an internal id on some families. The code is never in the
    SEC name and on char 3-grams it drags the vector away from the real fund.

    The first version of this rule required a DIGIT first, so ZW4X and 2DCN --
    both in the measured residual -- slipped through and the rule bought only
    0.08 points instead of its share of 0.28.
    """
    assert want in m.variants(raw)


def test_keeps_a_leading_number_that_is_part_of_the_name():
    """'500 Index Fund' must not lose its first token: the code rule requires a
    following word AND at least one digit, but a real name can look like a code.
    """
    got = m.variants("500 Index Fund")
    assert "500 index fund" in got
    assert "index fund" not in got


def test_splits_a_formerly_known_as_into_both_names():
    """ISS holds whichever name the fund voted under, so both are targets."""
    got = m.variants("Federated Hermes Global Fund (formerly, Federated Global Fund)")
    assert any("federated hermes global fund" == v for v in got)
    assert any("federated global fund" == v for v in got)


def test_strips_a_sub_adviser_tail():
    """Biggest single rule at +0.28 points. The manager is appended after a dash
    and never appears in the SEC series name.
    """
    assert "northern engage360 fund" in m.variants(
        "Northern Engage360 Fund - Segall Bryant and Hamill LLC")
    assert "strategic advisers core fund" in m.variants(
        "STRATEGIC ADVISERS CORE FUND - SUB-ADVISER: JENNISON")


def test_always_keeps_the_raw_form():
    """Every rule ADDS a variant. Replacing the key is what broke symmetric
    concat, which cost ~50 points by dropping the form that already matched.
    """
    for raw in ("3364 JHVIT Fund", "Plain Equity Fund",
                "Core Fund - SUB-ADVISER: X"):
        assert m.norm(raw) in m.variants(raw)


def test_variants_are_deduplicated_and_non_empty():
    got = m.variants("Plain Equity Fund")
    assert len(got) == len(set(got))
    assert all(v.strip() for v in got)


def test_accept_threshold_is_the_measured_one():
    """0.70, not 0.68. Per-band negative control 2026-08-28: the 0.68-0.70 band
    is 50.0% correct -- a coin flip -- and cumulative top-1 could not see it
    because 69% of accepted matches are exact and score 1.000.
    """
    assert m.ACCEPT_THRESHOLD == 0.70


def test_exact_normalised_match_scores_one():
    idx = m.build_index(["vanguard 500 index fund", "fidelity contrafund"])
    hits = m.match(["Vanguard 500 Index Fund"], idx)
    assert hits[0][1] == pytest.approx(1.0, abs=1e-6)
    assert hits[0][0] == 0


def test_a_sibling_fund_does_not_score_as_an_exact_match():
    """Royce Value Trust vs Royce Value Fund scored 0.95 and is a DIFFERENT
    fund (closed-end vs open-end). The matcher cannot tell; the judge can. This
    pins that the matcher at least does not call it identical.
    """
    idx = m.build_index(["royce value fund"])
    hits = m.match(["Royce Value Trust, Inc"], idx)
    assert hits[0][1] < 1.0
