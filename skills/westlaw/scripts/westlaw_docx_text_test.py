"""Contract tests for westlaw-docx-text.py: flat-OPC and word/ layouts, italics projection, CLI."""

import importlib.util
import sys
import zipfile
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "westlaw_docx_text", Path(__file__).resolve().parent / "westlaw-docx-text.py")
w = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(w)

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def run(text, italic=None):
    rpr = ""
    if italic is True:
        rpr = "<w:rPr><w:i/></w:rPr>"
    elif italic is False:
        rpr = '<w:rPr><w:i w:val="0"/></w:rPr>'
    return f"<w:r>{rpr}<w:t xml:space=\"preserve\">{text}</w:t></w:r>"


def para(*runs):
    return "<w:p>" + "".join(runs) + "</w:p>"


def docx(path, body, member="document.xml"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(member, f"<w:document {NS}><w:body>{body}</w:body></w:document>")
    return path


def test_flat_opc_layout_is_read_and_labelled(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("Hello")))
    xml, layout, n = w.read_document_xml(p)
    assert layout == "flat OPC (zip root)" and n == 1 and b"Hello" in xml


def test_standard_word_layout_falls_back(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("Hi")), member="word/document.xml")
    assert w.read_document_xml(p)[1] == "standard OPC (word/)"
    assert w.project(p) == "Hi\n"


def test_no_document_part_exits_naming_parts(tmp_path):
    p = tmp_path / "a.docx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("other.xml", "<x/>")
    with pytest.raises(SystemExit) as ei:
        w.read_document_xml(p)
    assert "no document.xml at zip root or under word/; parts: ['other.xml']" in str(ei.value)


def test_italic_runs_wrap_as_typst_emphasis_and_merge(tmp_path):
    p = docx(tmp_path / "a.docx", para(
        run("See "), run("Marbury", True), run(" v. ", True), run("Madison", True), run(" (1803).")))
    assert w.project(p) == "See _Marbury v. Madison_ (1803).\n"


def test_wrap_sits_inside_whitespace_of_the_span(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("a"), run(" Id. ", True), run("b")))
    assert w.project(p) == "a _Id._ b\n"


def test_explicit_italic_off_is_roman(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("plain", False), run(" x", True)))
    assert w.project(p) == "plain _x_\n"


def test_no_emphasis_gives_flat_text(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("A ", True), run("b")))
    assert w.project(p, emphasis=False) == "A b\n"


def test_entities_unescaped_and_empty_paragraphs_dropped(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("Smith &amp; Jones")) + "<w:p/>" + para(run("  ")) + para(run("two")))
    assert w.project(p) == "Smith & Jones\n\ntwo\n"


def test_whole_italic_whitespace_run_is_not_wrapped(tmp_path):
    p = docx(tmp_path / "a.docx", para(run("a"), run(" ", True), run("b")))
    assert w.project(p) == "a b\n"


def test_cli_stdout_and_summary_counts(tmp_path, monkeypatch, capsys):
    p = docx(tmp_path / "a.docx", para(run("x *12 y ")) + para(run("Case", True)))
    monkeypatch.setattr(sys, "argv", ["w", str(p)])
    w.main()
    cap = capsys.readouterr()
    assert cap.out == "x *12 y\n\n_Case_\n"
    assert "layout: flat OPC (zip root) (1 parts)" in cap.err
    assert "paragraphs: 2" in cap.err and "emphasis spans: 1" in cap.err
    assert "star-page markers: 1" in cap.err and "first markers: *12" in cap.err


def test_cli_output_file_and_no_emphasis(tmp_path, monkeypatch, capsys):
    p = docx(tmp_path / "a.docx", para(run("Case", True)))
    o = tmp_path / "o.txt"
    monkeypatch.setattr(sys, "argv", ["w", str(p), "-o", str(o), "--no-emphasis"])
    w.main()
    cap = capsys.readouterr()
    assert o.read_text() == "Case\n" and cap.out == ""
    assert "emphasis spans" not in cap.err
