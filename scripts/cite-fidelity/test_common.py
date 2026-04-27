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
from _common import _extract_from_text, _get_sentence_around, _strip_html_comments


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


def test_html_comments_stripped() -> None:
    """Bug 2 (4.92.2): bibkeys inside `<!-- ... -->` must not be extracted."""
    text = (
        "Some text with @realkey and "
        "<!-- CITE-CHECK: dropped @fakekey, @otherfake per triage --> "
        "more text."
    )
    cites = _extract_from_text(text)
    keys = [c[0] for c in cites]
    assert "realkey" in keys, f"real cite should be extracted; got: {keys}"
    assert "fakekey" not in keys, f"commented bibkey leaked into extraction: {keys}"
    assert "otherfake" not in keys, f"commented bibkey leaked into extraction: {keys}"
    print("PASS: html comments stripped")


def test_html_comments_preserve_offsets() -> None:
    """Stripping comments must not shift byte offsets or line numbers."""
    text = (
        "Line 1 cite @good\n"
        "<!-- @bad commented -->\n"
        "Line 3 cite @another"
    )
    stripped = _strip_html_comments(text)
    assert len(stripped) == len(text), "length must be preserved"
    assert stripped.count("\n") == text.count("\n"), "newline count must be preserved"
    cites = _extract_from_text(text)
    keys = [c[0] for c in cites]
    assert "good" in keys and "another" in keys, f"got: {keys}"
    assert "bad" not in keys, f"commented bibkey leaked: {keys}"
    for bibkey, _signal, offset in cites:
        # The original text at this offset still starts with `@bibkey`.
        assert text[offset:offset + 1 + len(bibkey)] == "@" + bibkey, (
            f"offset shifted: bibkey={bibkey!r} at {offset}, "
            f"window={text[offset:offset + 20]!r}"
        )
    print("PASS: html comments preserve offsets")


def test_html_comment_multiline() -> None:
    """Multi-line HTML comments are stripped end-to-end."""
    text = (
        "Real cite @keep here.\n"
        "<!--\n"
        "  TODO: @drop1 and @drop2 per triage\n"
        "-->\n"
        "Another real cite @keep2."
    )
    cites = _extract_from_text(text)
    keys = [c[0] for c in cites]
    assert "keep" in keys and "keep2" in keys, f"got: {keys}"
    assert "drop1" not in keys and "drop2" not in keys, f"multi-line leak: {keys}"
    print("PASS: multi-line html comments stripped")


if __name__ == "__main__":
    test_sentence_split_with_footnote_markers()
    test_sentence_around_regular_cite_unchanged()
    test_html_comments_stripped()
    test_html_comments_preserve_offsets()
    test_html_comment_multiline()
    print("All tests passed.")
