#!/usr/bin/env python3
"""Contract for the fuzzy-match name vocabulary in build_sec_series_master.py.

WHY THIS EXISTS
    The fuzzy tier matches an ISS `fundname` against a vocabulary of series
    names, and it is the largest fuzzy tier in the ladder (18.45% of vote rows).
    Two measured defects in that vocabulary, both fixed by `build_name_variants`:

    1. BARE PORTFOLIO NAMES. The SEC report often carries the strategy name with
       no family token -- S000000042 is 'Equity Income Portfolio'. Dozens of
       families have one, so it is unmatchable on its own. The registrant is in
       the same row (`entity_name`), so the qualified variant costs nothing.

    2. RENAMES AND SUB-ADVISERS. ISS holds the name a fund carried WHEN IT
       VOTED. S000000013 is 'BNY Mellon Municipal Bond Fund' today and was
       'Dreyfus Bond Funds' when it cast 2008 votes; S000000042's registrant is
       Northwestern Mutual but it was branded 'T. Rowe Price Equity Income
       Portfolio' after its sub-adviser. Neither is derivable from any current
       field -- only an observed name history has them. Measured 2026-08-28:
       header names add 4,580 strings for series the SEC report already carries,
       and lift untagged-fundid coverage 72.9% -> 75.5% of vote rows while
       RAISING the unambiguous count 13,249 -> 14,195.

    The vocabulary must therefore be long-form -- one row per (series, name,
    source) -- never one canonical name per series.

    uv run --with pandas,pytest python3 -m pytest tests/npx_linking_name_vocab_test.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import build_sec_series_master as bm


@pytest.fixture
def long_frame():
    """Two real shapes: a bare portfolio name, and a series that was renamed."""
    return pd.DataFrame([
        # bare strategy name; the family token lives only in entity_name
        {"series_id": "S000000042", "series_name": "Equity Income Portfolio",
         "class_id": "C000000042", "class_name": "Class A", "class_ticker": None,
         "cik": "0000045947", "entity_name": "NORTHWESTERN MUTUAL SERIES FUND INC",
         "file_year": 2015},
        # same series, later vintage, unchanged
        {"series_id": "S000000042", "series_name": "Equity Income Portfolio",
         "class_id": "C000000042", "class_name": "Class A", "class_ticker": None,
         "cik": "0000045947", "entity_name": "NORTHWESTERN MUTUAL SERIES FUND INC",
         "file_year": 2020},
        # a rename across vintages: Dreyfus -> BNY Mellon
        {"series_id": "S000000013", "series_name": "Dreyfus Municipal Bond Fund",
         "class_id": "C000000013", "class_name": "Investor", "class_ticker": "DRTAX",
         "cik": "0000030167", "entity_name": "Dreyfus Municipal Bond Funds, Inc.",
         "file_year": 2011},
        {"series_id": "S000000013", "series_name": "BNY Mellon Municipal Bond Fund",
         "class_id": "C000000013", "class_name": "Investor", "class_ticker": "DRTAX",
         "cik": "0000030167", "entity_name": "BNY Mellon Municipal Bond Funds, Inc.",
         "file_year": 2020},
    ])


@pytest.fixture
def header_names():
    """Observed <SERIES-NAME> from 40-Act SGML headers, with the year seen.

    Carries the sub-adviser branding that no current SEC field has.
    """
    return pd.DataFrame([
        {"series_id": "S000000042",
         "series_name": "T Rowe Price Equity Income Portfolio", "file_year": 2008},
        {"series_id": "S000000013",
         "series_name": "Dreyfus Bond Funds Inc", "file_year": 2007},
    ])


def _names(df, series_id):
    return set(df.loc[df["series_id"] == series_id, "name"].str.lower())


def test_emits_the_bare_sec_name(long_frame, header_names):
    v = bm.build_name_variants(long_frame, header_names)
    assert "equity income portfolio" in _names(v, "S000000042")


def test_qualifies_a_bare_name_with_the_registrant(long_frame, header_names):
    """The whole point of defect 1: 'Equity Income Portfolio' is unmatchable."""
    v = bm.build_name_variants(long_frame, header_names)
    got = _names(v, "S000000042")
    assert any("northwestern mutual" in n and "equity income" in n for n in got), got


def test_keeps_every_historical_sec_name(long_frame, header_names):
    """A renamed series must keep BOTH names -- ISS holds the one it voted under."""
    v = bm.build_name_variants(long_frame, header_names)
    got = _names(v, "S000000013")
    assert "dreyfus municipal bond fund" in got
    assert "bny mellon municipal bond fund" in got


def test_merges_header_names_that_no_sec_field_has(long_frame, header_names):
    """Sub-adviser branding: derivable from no current field, only from history."""
    v = bm.build_name_variants(long_frame, header_names)
    assert "t rowe price equity income portfolio" in _names(v, "S000000042")
    assert "dreyfus bond funds inc" in _names(v, "S000000013")


def test_tags_every_variant_with_its_source(long_frame, header_names):
    """Tiers are reported separately, so a variant must say where it came from."""
    v = bm.build_name_variants(long_frame, header_names)
    assert set(v["name_source"]) <= {"sec_series", "sec_entity_series", "header"}
    assert set(v["name_source"]) == {"sec_series", "sec_entity_series", "header"}


def test_carries_the_year_the_name_was_observed(long_frame, header_names):
    """Vintage-aware matching needs the year, per build_names_long's own docstring."""
    v = bm.build_name_variants(long_frame, header_names)
    hdr = v[(v["series_id"] == "S000000042") & (v["name_source"] == "header")]
    assert set(hdr["file_year"]) == {2008}


def test_is_deduplicated(long_frame, header_names):
    """The first version asserted no duplicate rows on a fixture that produced
    none, so `drop_duplicates()` could be deleted and it stayed green -- it
    named dedup and exercised nothing. Audit finding (CRITICAL).

    This fixture carries a genuine duplicate: the same series, name and
    file_year twice, which is what two share classes of one series look like in
    the SEC report. The assertion now counts.
    """
    dup = pd.DataFrame([
        {"series_id": "S000000042", "series_name": "Equity Income Portfolio",
         "class_id": "C000000042", "class_name": "Class A", "class_ticker": None,
         "cik": "0000045947", "entity_name": "NORTHWESTERN MUTUAL SERIES FUND INC",
         "file_year": 2015},
        # same series and vintage, a second share class -> identical name row
        {"series_id": "S000000042", "series_name": "Equity Income Portfolio",
         "class_id": "C000000099", "class_name": "Class B", "class_ticker": None,
         "cik": "0000045947", "entity_name": "NORTHWESTERN MUTUAL SERIES FUND INC",
         "file_year": 2015},
    ])
    v = bm.build_name_variants(dup, None)

    key = ["series_id", "name", "name_source", "file_year"]
    assert not v.duplicated(key).any(), v[v.duplicated(key, keep=False)]
    # the duplicate really was in the input, so removing dedup fails this
    assert (v["name"].str.lower() == "equity income portfolio").sum() == 1


def test_header_frame_is_optional(long_frame):
    """The vocabulary must still build where no header scan exists."""
    v = bm.build_name_variants(long_frame, None)
    assert "equity income portfolio" in _names(v, "S000000042")
    assert "header" not in set(v["name_source"])
