#!/usr/bin/env python3
"""Smoke tests for cite-fidelity _common.py.

Run with: python3 scripts/cite-fidelity/test_common.py

Tests are deliberately dependency-free so they run anywhere _common.py imports
(no NLM CLI, no project context).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import _get_sentence_around


def test_sentence_split_with_footnote_markers() -> None:
    """Bug 1 (4.92.2): each `.[^N]` marker should anchor its own sentence."""
    text = (
        "First sentence ends here.[^a] "
        "Second sentence ends here.[^b] "
        "Third sentence ends here.[^c]"
    )
    a_pos = text.index("[^a]")
    b_pos = text.index("[^b]")
    c_pos = text.index("[^c]")

    sa = _get_sentence_around(text, a_pos)
    sb = _get_sentence_around(text, b_pos)
    sc = _get_sentence_around(text, c_pos)

    assert "First" in sa and "Second" not in sa and "Third" not in sa, (
        f"Marker [^a] should anchor first sentence; got: {sa!r}"
    )
    assert "Second" in sb and "First" not in sb and "Third" not in sb, (
        f"Marker [^b] should anchor second sentence; got: {sb!r}"
    )
    assert "Third" in sc and "Second" not in sc and "First" not in sc, (
        f"Marker [^c] should anchor third sentence; got: {sc!r}"
    )
    assert sa != sb and sb != sc, (
        f"Markers should yield distinct sentences: {[sa, sb, sc]!r}"
    )
    print("PASS: sentence split with footnote markers")


def test_sentence_around_regular_cite_unchanged() -> None:
    """Regression guard: regular cite offsets still return the surrounding sentence."""
    text = "First sentence. Second sentence with @bibkey here. Third sentence."
    cite_pos = text.index("@bibkey")
    s = _get_sentence_around(text, cite_pos)
    assert "Second sentence with" in s, f"got: {s!r}"
    assert "First" not in s and "Third" not in s, f"got: {s!r}"
    print("PASS: regular cite sentence extraction unchanged")


if __name__ == "__main__":
    test_sentence_split_with_footnote_markers()
    test_sentence_around_regular_cite_unchanged()
    print("All tests passed.")
