# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for build_le_docx.py: input assembly, docx post-passes, lint warnings (no pandoc)."""

import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_le_docx as b

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"')


def mkdocx(path, document="", styles="", settings=None):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", styles)
        if settings is not None:
            z.writestr("word/settings.xml", settings)
    return path


def read(path, name):
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode()


def heading(level, text):
    return (f'<w:p><w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr>'
            f"<w:r><w:t>{text}</w:t></w:r></w:p>")


def test_numeric_key_sorts_numbers_before_names():
    ps = [Path("b.md"), Path("10-x.md"), Path("2-y.md"), Path("a.md")]
    assert [p.name for p in sorted(ps, key=b._numeric_key)] == ["2-y.md", "10-x.md", "a.md", "b.md"]


def test_collect_sources_prefers_drafts_and_skips_readme(tmp_path):
    (tmp_path / "drafts").mkdir()
    (tmp_path / "drafts/10-b.md").write_text("b")
    (tmp_path / "drafts/2-a.md").write_text("a")
    (tmp_path / "top.md").write_text("t")
    assert [p.name for p in b.collect_sources(tmp_path)] == ["2-a.md", "10-b.md"]


def test_collect_sources_falls_back_to_top_level_and_single_file(tmp_path):
    (tmp_path / "README.md").write_text("r")
    (tmp_path / "paper.md").write_text("p")
    assert [p.name for p in b.collect_sources(tmp_path)] == ["paper.md"]
    assert b.collect_sources(tmp_path / "paper.md") == [tmp_path / "paper.md"]


def test_collect_sources_empty_dir_exits(tmp_path):
    with pytest.raises(SystemExit) as e:
        b.collect_sources(tmp_path)
    assert str(e.value) == f"ERROR: no markdown found under {tmp_path}"


def test_assemble_keeps_first_frontmatter_only(tmp_path):
    (tmp_path / "1.md").write_text("---\ntitle: One\n---\n\n# A\n\ntext[^1]\n\n[^1]: n\n")
    (tmp_path / "2.md").write_text("---\ntitle: Two\n---\n\n# B\n\nmore[^1]\n\n[^1]: m\n")
    out = b.assemble([tmp_path / "1.md", tmp_path / "2.md"])
    assert out.startswith("---\ntitle: One\n---")
    assert "title: Two" not in out
    assert "# A" in out and "# B" in out
    assert "[^1]: n" in out and "[^s1" in out  # second file's labels are namespaced


def test_ensure_reference_list_three_cases():
    assert b.ensure_reference_list("x\n::: {#refs}\n:::\n") == "x\n::: {#refs}\n:::\n"
    assert b.ensure_reference_list("x\n\n# References\n") == "x\n\n# References\n\n::: {#refs}\n:::\n"
    assert b.ensure_reference_list("x\n") == "x\n\n# References\n\n::: {#refs}\n:::\n"


def test_unnumber_back_matter_retags_from_first_back_heading_on(tmp_path):
    doc = (f"<w:body>{heading(1, 'Introduction')}{heading(1, 'Appendix A')}"
           f"{heading(1, 'Anything Later')}</w:body>")
    d = mkdocx(tmp_path / "a.docx", doc)
    b.unnumber_back_matter(d)
    out = read(d, "word/document.xml")
    assert out.count('<w:pStyle w:val="UnnumberedHeading"/>') == 2
    assert out.count('<w:pStyle w:val="Heading1"/>') == 1
    assert out.index("Heading1") < out.index("UnnumberedHeading")


def test_unnumber_back_matter_warns_on_appendix_subheads(tmp_path, capsys):
    d = mkdocx(tmp_path / "a.docx", heading(1, "References") + heading(2, "Sub"))
    b.unnumber_back_matter(d)
    assert "WARN: 1 sub-heading(s) inside the appendixes" in capsys.readouterr().err


def test_unnumber_back_matter_noop_leaves_file_bytes(tmp_path):
    d = mkdocx(tmp_path / "a.docx", heading(1, "Introduction"))
    before = d.read_bytes()
    b.unnumber_back_matter(d)
    assert d.read_bytes() == before


def test_set_math_font_stamps_runs_and_settings(tmp_path):
    d = mkdocx(tmp_path / "a.docx", f"<w:document {NS}><m:r><m:t>x</m:t></m:r>"
                                    f"<m:r><w:rPr><w:b/></w:rPr><m:t>y</m:t></m:r></w:document>",
               settings=f"<w:settings {NS}><w:decimalSymbol w:val=\".\"/></w:settings>")
    b.set_math_font(d)
    doc = read(d, "word/document.xml")
    assert doc.count("<w:rFonts") == 1  # one stamp; the run already carrying <w:rPr> is left alone
    s = read(d, "word/settings.xml")
    assert '<m:mathFont m:val="Latin Modern Math"/>' in s
    assert s.index("m:mathPr") < s.index("<w:decimalSymbol")
    b.set_math_font(d)  # idempotent for settings
    assert read(d, "word/settings.xml").count("m:mathFont") == 1


def test_set_line_spacing(tmp_path):
    d = mkdocx(tmp_path / "a.docx", "", styles='<w:spacing w:line="480"/>')
    b.set_line_spacing(d, "double")
    assert 'w:line="480"' in read(d, "word/styles.xml")
    b.set_line_spacing(d, "onehalf")
    assert read(d, "word/styles.xml") == '<w:spacing w:line="360"/>'
    with pytest.raises(KeyError):
        b.set_line_spacing(d, "triple")


def test_check_abstract_length_warns_over_limit(capsys):
    long = " ".join(["w"] * 151)
    b.check_abstract_length(f"title: x\nabstract: {long}\n")
    assert "WARN: abstract is 151 words; JLE enforces a strict 150-word limit" in capsys.readouterr().err
    b.check_abstract_length("abstract: short one\n")
    b.check_abstract_length("no abstract here")
    assert capsys.readouterr().err == ""


def test_check_abstract_length_block_scalar(capsys):
    body = "".join("  " + " ".join(["w"] * 10) + "\n" for _ in range(3))
    b.check_abstract_length(f"abstract: |\n{body}", limit=20)
    assert "abstract is 30 words" in capsys.readouterr().err


def test_check_citation_footnotes_flags_only_bare_citations(capsys):
    md = ("[^1]: [@smith2001, 12]\n[^2]: See the model, [@lee2002].\n[^3]: @a; @b.\n")
    b.check_citation_footnotes(md)
    err = capsys.readouterr().err
    assert "footnote(s) 1, 3 contain only citations" in err
    assert "2" not in err.split("contain")[0]


def test_main_missing_target_exits(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", ["build_le_docx.py", str(tmp_path / "nope.md")])
    with pytest.raises(SystemExit) as e:
        b.main()
    assert str(e.value) == f"ERROR: {tmp_path / 'nope.md'} does not exist"


def test_main_rejects_bad_spacing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(sys, "argv", ["x", str(tmp_path), "--spacing", "triple"])
    with pytest.raises(SystemExit) as e:
        b.main()
    assert e.value.code == 2
    assert "invalid choice: 'triple'" in capsys.readouterr().err


def test_build_missing_template_exits(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "TEMPLATE", tmp_path / "no.docx")
    with pytest.raises(SystemExit) as e:
        b.build(tmp_path, None)
    assert str(e.value).startswith(f"ERROR: template not found at {tmp_path / 'no.docx'}")
