"""Contract tests for check_widows.py.

pdftotext is replaced with canned layout text, so no PDF or poppler is needed;
the PDF path only has to exist for the CLI.
"""
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_widows as cw  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "check_widows.py"
LONG = "The quick brown fox jumps over the lazy dog and keeps on running far"


@pytest.fixture
def layout(monkeypatch):
    """Set the text pdftotext 'returns'."""
    def _set(text):
        monkeypatch.setattr(cw.subprocess, "run",
                            lambda *a, **k: SimpleNamespace(stdout=text))
    return _set


def detect(**kw):
    return cw.detect_widows(Path("x.pdf"), **kw)


def test_single_word_last_line_is_a_widow(layout):
    layout(f"{LONG}\n{LONG}\nending.\n\nnext paragraph here is long enough.\n")
    assert detect() == [(LONG, "ending.")]


def test_two_word_last_line_needs_max_words_2(layout):
    layout(f"{LONG}\nlast words.\n")
    assert detect(max_words=1) == []
    assert detect(max_words=2) == [(LONG, "last words.")]


def test_full_last_line_is_not_a_widow(layout):
    layout(f"{LONG}\nthis last line has many words in it.\n")
    assert detect(max_words=2) == []


def test_short_penultimate_line_skipped_as_table(layout):
    layout("Short head\nword\n")
    assert detect() == []
    assert detect(min_prev_chars=5) == [("Short head", "word")]


def test_penultimate_with_column_gap_skipped(layout):
    layout(f"{LONG}      col two\nword\n")
    assert detect() == []


def test_indented_line_starts_new_paragraph(layout):
    layout(f"{LONG}\n{LONG}\n  {LONG}\nend.\n")
    assert detect() == [(LONG, "end.")]


@pytest.mark.parametrize("last", ["12", "3,400.5%", "April 2026", "Other mgmt"])
def test_false_positive_patterns_filtered(layout, last):
    layout(f"{LONG}\n{last}\n")
    assert detect(max_words=2) == []


def test_running_header_filtered_only_when_named(layout):
    layout(f"{LONG}\nRUNNING HEAD\n")
    assert detect(max_words=2, running_header="RUNNING HEAD") == []
    assert detect(max_words=2) == [(LONG, "RUNNING HEAD")]


def test_url_fragment_skipped_unless_include_urls(layout):
    prev = "see https://example.com/some/very/long/path-"
    layout(f"{prev}\nfragment/\n")
    assert detect(max_words=2) == []
    assert detect(max_words=2, include_urls=True) == [(prev, "fragment/")]


def test_page_level_widow_detected(layout):
    page1 = f"{LONG}\n{LONG}\n"
    page2 = "ends the paragraph from before here.\n\n" + f"{LONG}\n{LONG}\n"
    layout(page1 + "\f" + page2)
    assert detect() == [(LONG, "ends the paragraph from before here.")]


def test_page_with_multiline_first_block_not_a_widow(layout):
    layout(f"{LONG}\n\f{LONG}\n{LONG}.\n")
    assert detect() == []


def test_duplicates_reported_once(layout):
    layout(f"{LONG}\nend.\n\n{LONG}\nend.\n")
    assert detect() == [(LONG, "end.")]


def test_looks_like_url_fragment_and_is_false_positive_units():
    assert cw.looks_like_url_fragment("x", "go to www.site.org/a-")
    assert not cw.looks_like_url_fragment("x", "plain sentence-")
    assert cw.is_false_positive("42")
    assert cw.is_false_positive("HDR", running_header="HDR")
    assert not cw.is_false_positive("HDR")


def run_cli(tmp_path, *args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, text=True)


def test_cli_missing_pdf(tmp_path):
    r = run_cli(tmp_path, tmp_path / "nope.pdf")
    assert r.returncode == 1
    assert f"ERROR: {tmp_path / 'nope.pdf'} not found" in r.stderr


def test_cli_reports_widows_and_exits_zero(tmp_path, monkeypatch, capsys):
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF")
    monkeypatch.setattr(cw.subprocess, "run",
                        lambda *a, **k: SimpleNamespace(stdout=f"{LONG}\nlone.\n"))
    monkeypatch.setattr(sys, "argv", ["check_widows.py", str(pdf)])
    assert cw.main() == 0
    out = capsys.readouterr().out
    assert "Found 1 widows in paper.pdf:" in out
    assert "     >>> lone. <<<" in out


def test_cli_clean_pdf_message(tmp_path, monkeypatch, capsys):
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF")
    monkeypatch.setattr(cw.subprocess, "run",
                        lambda *a, **k: SimpleNamespace(stdout=f"{LONG}\n{LONG}\n"))
    monkeypatch.setattr(sys, "argv", ["check_widows.py", str(pdf), "--max-words", "2"])
    assert cw.main() == 0
    assert capsys.readouterr().out == "No widows found in paper.pdf (≤2 words on last line).\n"
