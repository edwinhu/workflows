"""Contract tests for bin/doc-marks (scripts/lib/doc_marks.py): one reader, one schema, three backends.

Run: uv run --with pytest --with pymupdf --with lxml python3 -m pytest tests/doc_marks_test.py -q

The real Xodo fixture (four pages of a Sec Reg review copy, ink with typed notes) proves the PDF backend
on the tablet's actual output; a prose PDF and a docx are fabricated here so the input stays visible in the
test. The key-set equality tests mirror comments.py's: a consumer must never branch on the backend.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pymupdf
import pytest

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "scripts" / "lib" / "doc_marks.py"
MARKED = ROOT / "tests" / "fixtures" / "doc-marks" / "marked.pdf"
DRIVE_JSON = ROOT / "tests" / "fixtures" / "drive-comments-list.json"

sys.path.insert(0, str(MODULE.parent))
import doc_marks  # noqa: E402


def run(*args):
    p = subprocess.run([sys.executable, str(MODULE), *args], capture_output=True, text=True, check=False)
    return p.returncode, p.stdout, p.stderr


def read(*args):
    rc, out, err = run(*args)
    assert rc == 0, err
    return json.loads(out)


def prose_pdf(path: Path) -> Path:
    """One page, two outline entries (y=100 and y=400), a typed highlight under each heading."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Alpha Heading", fontsize=18)
    page.insert_text((72, 140), "alpha body words here", fontsize=11)
    page.insert_text((72, 400), "Beta Heading", fontsize=18)
    page.insert_text((72, 440), "beta body words here", fontsize=11)
    for needle, note in (("alpha body", "under alpha"), ("beta body", "under beta")):
        a = page.add_highlight_annot(page.search_for(needle)[0])
        a.set_info(content=note, title="Prof")
        a.update()
    doc.set_toc([
        [1, "Alpha Heading", 1, {"kind": 1, "page": 0, "to": pymupdf.Point(72, 80), "zoom": 0}],
        [1, "Beta Heading", 1, {"kind": 1, "page": 0, "to": pymupdf.Point(72, 380), "zoom": 0}],
    ])
    doc.save(path)
    return path


def commented_docx(path: Path) -> Path:
    import zipfile
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    ct = ('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="xml" ContentType="application/xml"/></Types>')
    doc = (f'<w:document xmlns:w="{w}"><w:body>'
           '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>'
           '<w:p><w:r><w:t>plain </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>anchored words</w:t></w:r>'
           '<w:commentRangeEnd w:id="0"/></w:p></w:body></w:document>')
    com = (f'<w:comments xmlns:w="{w}"><w:comment w:id="0" w:author="Coauthor" w:date="2026-10-01T10:00:00Z">'
           '<w:p><w:r><w:t>tighten this</w:t></w:r></w:p></w:comment></w:comments>')
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("word/document.xml", doc)
        z.writestr("word/comments.xml", com)
    return path


# ── the real Xodo fixture ─────────────────────────────────────────────────────

def test_xodo_fixture(tmp_path):
    s = read(str(MARKED), "--png-dir", str(tmp_path / "png"))
    assert s["source"] == "pdf" and len(s["marks"]) == 5
    assert {m["kind"] for m in s["marks"]} == {"Ink"}
    by_page: dict[int, list] = {}
    for m in s["marks"]:
        by_page.setdefault(m["where"]["page"], []).append(m)
    assert sorted(by_page) == [1, 2, 3, 4]
    assert by_page[1][0]["text"] == "is this really a limit? this should probably point to TFW?"
    assert [m["text"] for m in by_page[3]] == ["I am going to skip 15c2-8", ""]
    assert by_page[3][0]["where"]["heading"] == "Rule 172 makes access equal delivery; Rules 173 and 15c2-8 still apply."
    assert by_page[3][0]["where"]["heading_source"] == "page-text"
    assert "Rule 15c2-8(b)" in by_page[3][0]["quoted"]
    assert all(m["strokes"] >= 1 and m["resolved"] is None and m["replies"] == [] for m in s["marks"])
    for page in by_page:
        assert (tmp_path / "png" / f"page-{page:03d}.png").is_file()


def test_unmarked_pdf_is_exit_1(tmp_path):
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "clean")
    clean = tmp_path / "clean.pdf"
    doc.save(clean)
    rc, out, err = run(str(clean), "--png-dir", str(tmp_path / "c"))
    assert rc == 1 and "NO MARKS" in err and json.loads(out)["marks"] == []


def test_could_not_run_is_exit_2(tmp_path):
    for args in ([], [str(tmp_path / "missing.pdf")]):
        rc, _, err = run(*args)
        assert rc == 2 and "COULD-NOT-RUN" in err


# ── several headings on one page ──────────────────────────────────────────────

def test_marks_under_two_headings_on_one_page_resolve_separately(tmp_path):
    s = read(str(prose_pdf(tmp_path / "prose.pdf")), "--png-dir", str(tmp_path / "png"))
    got = [(m["text"], m["where"]["heading"], m["where"]["heading_source"], m["author"]) for m in s["marks"]]
    assert got == [("under alpha", "Alpha Heading", "outline", "Prof"), ("under beta", "Beta Heading", "outline", "Prof")]


# ── docx and Drive ────────────────────────────────────────────────────────────

def test_docx_comment_maps_onto_the_schema(tmp_path):
    s = read(str(commented_docx(tmp_path / "c.docx")))
    assert s["source"] == "docx" and len(s["marks"]) == 1
    m = s["marks"][0]
    assert (m["text"], m["quoted"], m["author"], m["kind"]) == ("tighten this", "anchored words", "Coauthor", "comment")
    assert m["where"] == {"page": None, "heading": "Intro", "heading_source": "paragraph-style", "rect": None}
    assert m["strokes"] is None and m["png"] is None and m["resolved"] is False


def test_drive_marks_use_the_same_schema():
    s = read("--drive", "FILEID", "--drive-json", str(DRIVE_JSON))
    assert s["source"] == "drive" and s["file"] == "FILEID" and s["mtime"] is None and s["marks"]
    assert set(s["marks"][0]) == set(doc_marks.MARK_KEYS)


# ── one schema ────────────────────────────────────────────────────────────────

def test_key_sets_equal_across_backends(tmp_path):
    outs = [read(str(prose_pdf(tmp_path / "p.pdf")), "--png-dir", str(tmp_path / "png")),
            read(str(commented_docx(tmp_path / "c.docx"))),
            read("--drive", "X", "--drive-json", str(DRIVE_JSON))]
    for s in outs:
        assert list(s) == doc_marks.TOP_KEYS
        for m in s["marks"]:
            assert list(m) == doc_marks.MARK_KEYS
            assert list(m["where"]) == doc_marks.WHERE_KEYS


def test_brief_names_page_and_heading(tmp_path):
    rc, out, err = run(str(prose_pdf(tmp_path / "p.pdf")), "--png-dir", str(tmp_path / "png"), "--brief")
    assert rc == 0, err
    assert "## p1: Alpha Heading" in out and "## p1: Beta Heading" in out and 'typed: "under beta"' in out
    rc, out, err = run(str(commented_docx(tmp_path / "c.docx")), "--brief")
    assert rc == 0 and "## Intro" in out and 'typed: "tighten this"' in out


@pytest.mark.parametrize("raw,iso", [("D:20261022101500Z", "2026-10-22T10:15:00+00:00"),
                                      ("D:20261022101500-04'00'", "2026-10-22T10:15:00-04:00"), ("", None)])
def test_pdf_date(raw, iso):
    assert doc_marks.pdf_date(raw) == iso
