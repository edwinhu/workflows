"""Smoke tests for the law-econ-docx build.

Run: uv run --with pytest python3 -m pytest tests/test_law_econ_docx.py -q

The end-to-end build needs pandoc + pandoc-crossref; those cases skip when the
binaries are absent so the suite stays runnable on a bare checkout.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "law-econ-docx" / "scripts"
TEMPLATE = ROOT / "skills" / "writing-legal" / "templates" / "law_econ_template.docx"
SAMPLE = ROOT / "skills" / "law-econ-docx" / "examples" / "sample" / "paper.md"

sys.path.insert(0, str(SCRIPTS))

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
needs_pandoc = pytest.mark.skipif(
    not (shutil.which("pandoc") and shutil.which("pandoc-crossref")),
    reason="pandoc / pandoc-crossref not installed",
)


def _part(docx: Path, name: str) -> str:
    with zipfile.ZipFile(docx) as z:
        return z.read(name).decode("utf-8")


# --- template ---------------------------------------------------------------

def test_template_exists():
    assert TEMPLATE.exists(), "run scripts/make_le_template.py"


@pytest.mark.parametrize("style", [
    "Normal", "BodyText", "FirstParagraph", "Title", "Author", "Abstract",
    "Heading1", "Heading2", "Heading3", "UnnumberedHeading", "FootnoteText",
    "Bibliography", "TableCaption", "TableNote",
])
def test_template_carries_style(style):
    assert f'w:styleId="{style}"' in _part(TEMPLATE, "word/styles.xml")


def test_template_is_double_spaced():
    """JLE: double spaced throughout, INCLUDING footnotes."""
    styles = _part(TEMPLATE, "word/styles.xml")
    for sid in ("Normal", "FootnoteText", "Bibliography", "TableCaption"):
        block = re.search(rf'<w:style[^>]*w:styleId="{sid}">(.*?)</w:style>', styles, re.S)
        assert block and 'w:line="480"' in block.group(1), f"{sid} is not double spaced"


def test_heading_ladder_matches_jle():
    """1. bold / 1.1. italic / 1.1.1. roman — the JLE subhead ladder."""
    styles = _part(TEMPLATE, "word/styles.xml")

    def rpr(sid):
        b = re.search(rf'<w:style[^>]*w:styleId="{sid}">(.*?)</w:style>', styles, re.S).group(1)
        m = re.search(r"<w:rPr>(.*?)</w:rPr>", b, re.S)
        return m.group(1) if m else ""

    assert "<w:b/>" in rpr("Heading1") and "<w:i/>" not in rpr("Heading1")
    assert "<w:i/>" in rpr("Heading2") and "<w:b/>" not in rpr("Heading2")
    assert "<w:b/>" not in rpr("Heading3") and "<w:i/>" not in rpr("Heading3")
    # UnnumberedHeading must NOT be wired to the numbering, or back matter
    # would consume section numbers.
    un = re.search(r'<w:style[^>]*w:styleId="UnnumberedHeading">(.*?)</w:style>',
                   styles, re.S).group(1)
    assert "numPr" not in un


def test_headings_are_auto_numbered():
    styles = _part(TEMPLATE, "word/styles.xml")
    assert 'w:numId w:val="900"' in styles
    assert 'w:numId="900"' in _part(TEMPLATE, "word/numbering.xml")


def test_latin_modern_typography():
    assert "Latin Modern Roman" in _part(TEMPLATE, "word/theme/theme1.xml")
    assert "Latin Modern Math" in _part(TEMPLATE, "word/settings.xml")


def test_template_regenerates_identically(tmp_path):
    """The .docx is generated, never hand-edited — prove it still round-trips."""
    if not shutil.which("pandoc"):
        pytest.skip("pandoc not installed")
    out = tmp_path / "regen.docx"
    subprocess.run([sys.executable, str(SCRIPTS / "make_le_template.py"), "-o", str(out)],
                   check=True, capture_output=True)
    assert _part(out, "word/styles.xml") == _part(TEMPLATE, "word/styles.xml"), (
        "committed template diverges from make_le_template.py — regenerate it"
    )


# --- pure functions ---------------------------------------------------------

def test_back_matter_detection():
    from build_le_docx import BACK_MATTER_RE
    for good in ("References", "Reference List", "Appendix A. Robustness",
                 "Abstract", "Figure Legends", "Acknowledgments", "Online Appendix B"):
        assert BACK_MATTER_RE.match(good), good
    for bad in ("Introduction", "The Model", "Data and Empirical Strategy", "Results"):
        assert not BACK_MATTER_RE.match(bad), bad


def test_reference_list_is_always_emitted():
    from build_le_docx import ensure_reference_list
    assert "{#refs}" in ensure_reference_list("# Intro\n\ntext")
    # An explicit div is left exactly where the author put it.
    md = "# Intro\n\n::: {#refs}\n:::\n\n# Appendix"
    assert ensure_reference_list(md) == md
    # An existing References heading is not duplicated.
    out = ensure_reference_list("# Intro\n\n# References\n")
    assert out.count("# References") == 1 and "{#refs}" in out


def test_citation_only_footnote_warns(capsys):
    from build_le_docx import check_citation_footnotes
    check_citation_footnotes("[^a]: [@becker1968; @shavell1984]\n")
    assert "substantive" in capsys.readouterr().err
    check_citation_footnotes("[^b]: A real point [@becker1968].\n")
    assert capsys.readouterr().err == ""


def test_long_abstract_warns(capsys):
    from build_le_docx import check_abstract_length
    check_abstract_length("---\nabstract: |\n  " + "word " * 200 + "\n---\n")
    assert "150-word limit" in capsys.readouterr().err


# --- end to end -------------------------------------------------------------

@needs_pandoc
def test_sample_builds(tmp_path):
    from build_le_docx import build
    out = build(SAMPLE, tmp_path / "sample.docx",
                acknowledgement="We thank seminar participants.")
    doc = _part(out, "word/document.xml")

    # citeproc ran: author-date in text, reference list at the back
    assert "Becker 1968" in doc
    assert 'w:val="Bibliography"' in doc

    # back matter is unnumbered; body sections are not
    assert 'w:val="UnnumberedHeading"' in doc
    assert 'w:val="Heading1"' in doc

    # math survived as OMML, in the math font
    assert "<m:oMath>" in doc and "Latin Modern Math" in doc

    # figure and table made it
    assert "<w:drawing>" in doc or "<w:pict>" in doc
    assert "<w:tbl>" in doc

    # the acknowledgment is a symbol-marked note, outside the numbered run
    assert 'w:customMarkFollows="1"' in _part(out, "word/document.xml")


@needs_pandoc
def test_no_word_split_mid_token(tmp_path):
    """Latin Modern is wider than the Times width model style_tables uses; a
    missing width correction splits header words ("errors" -> "erro" / "r")."""
    from build_le_docx import build
    out = build(SAMPLE, tmp_path / "s.docx")
    doc = _part(out, "word/document.xml")
    for tbl in re.findall(r"<w:tbl>.*?</w:tbl>", doc, re.S):
        for cell in re.findall(r"<w:tc>.*?</w:tc>", tbl, re.S):
            runs = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", cell)
            joined = "".join(runs)
            for word in ("Specification", "Violations", "error", "Firms", "Dispersed"):
                if word in joined:
                    assert any(word in r for r in runs), (
                        f"{word!r} was broken across runs in {runs!r}"
                    )


@needs_pandoc
def test_spacing_flag_overrides_template(tmp_path):
    from build_le_docx import build
    out = build(SAMPLE, tmp_path / "single.docx", spacing="single")
    assert 'w:line="240"' in _part(out, "word/styles.xml")
    assert 'w:line="480"' not in _part(out, "word/styles.xml")
