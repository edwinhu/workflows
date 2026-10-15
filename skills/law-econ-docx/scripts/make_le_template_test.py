# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for make_le_template.py: XML patch functions and verify() (pandoc not invoked)."""

import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import make_le_template as t


def zipped(path, parts):
    with zipfile.ZipFile(path, "w") as z:
        for n, d in parts.items():
            z.writestr(n, d)
    return path


def full_parts(styles=None, drop=()):
    s = styles if styles is not None else (
        "".join(f'<w:style w:styleId="{x}"/>' for x in t.REQUIRED_STYLES) + '<w:spacing w:line="480"/>')
    parts = {n: "x" for n in ("word/styles.xml", "word/numbering.xml", "word/settings.xml",
                              "word/footer1.xml", "[Content_Types].xml")}
    parts["word/styles.xml"] = s
    for d in drop:
        parts.pop(d)
    return parts


def test_verify_accepts_complete_template(tmp_path):
    t.verify(zipped(tmp_path / "t.docx", full_parts()))


def test_verify_missing_parts(tmp_path):
    p = zipped(tmp_path / "t.docx", full_parts(drop=("word/footer1.xml", "word/numbering.xml")))
    with pytest.raises(SystemExit) as e:
        t.verify(p)
    assert str(e.value) == ("ERROR: generated template missing parts: "
                            "['word/footer1.xml', 'word/numbering.xml']")


def test_verify_missing_style_and_not_double(tmp_path):
    styles = '<w:style w:styleId="Normal"/><w:spacing w:line="480"/>'
    with pytest.raises(SystemExit) as e:
        t.verify(zipped(tmp_path / "a.docx", full_parts(styles)))
    assert str(e.value).startswith("ERROR: generated template missing styles: ['BodyText'")
    single = "".join(f'<w:style w:styleId="{x}"/>' for x in t.REQUIRED_STYLES)
    with pytest.raises(SystemExit) as e:
        t.verify(zipped(tmp_path / "b.docx", full_parts(single)))
    assert str(e.value) == "ERROR: generated template is not double spaced"


def test_patch_styles_replaces_appends_and_sets_defaults():
    xml = ('<w:styles><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="old"/></w:style>'
           "<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val=\"99\"/></w:rPr></w:rPrDefault>"
           "<w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults></w:styles>")
    out = t.patch_styles(xml)
    assert 'w:val="old"' not in out
    assert out.count('w:styleId="Title"') == 1
    for sid in t.REQUIRED_STYLES[3:]:  # customs absent from input are appended
        if sid in t.STYLE_DEFS:
            assert f'w:styleId="{sid}"' in out
    assert out.endswith("</w:styles>")
    assert "<w:sz w:val=\"24\"/>" in out and "<w:widowControl/>" in out
    assert t.patch_styles(out) == out


def test_patch_numbering_inserts_before_first_num_and_is_idempotent():
    xml = '<w:numbering><w:abstractNum w:abstractNumId="1"/><w:num w:numId="1"/></w:numbering>'
    out = t.patch_numbering(xml)
    assert out.index('w:abstractNumId="900"') < out.index('<w:num w:numId="1"/>')
    assert out.rindex('<w:num w:numId="900">') > out.index('<w:num w:numId="1"/>')
    assert t.patch_numbering(out) == out
    bare = t.patch_numbering("<w:numbering></w:numbering>")  # no existing w:num: appended whole
    assert bare.endswith('<w:num w:numId="900"><w:abstractNumId w:val="900"/></w:num></w:numbering>')


def test_patch_settings_swaps_math_font():
    for src in ('<m:mathFont m:val="Cambria Math" />', '<m:mathFont m:val="Cambria Math"/>'):
        assert t.patch_settings(src) == '<m:mathFont m:val="Latin Modern Math"/>'


def test_patch_theme_sets_latin_and_cs():
    out = t.patch_theme('<a:latin typeface="Calibri" panose="x"/><a:cs typeface="Arial"/>')
    assert out == ('<a:latin typeface="Latin Modern Roman" panose="x"/>'
                   '<a:cs typeface="Latin Modern Roman"/>')


def test_patch_fonttable_adds_four_fonts():
    out = t.patch_fonttable("<w:fonts></w:fonts>")
    assert out.count("<w:font ") == 4
    assert 'w:name="LM Roman 10"' in out and 'w:name="Latin Modern Math"' in out


def test_patch_document_replaces_sectpr_with_footer_and_letter_page():
    out = t.patch_document("<w:body><w:sectPr><w:pgSz w:w=\"1\"/></w:sectPr></w:body>")
    assert out == f"<w:body>{t.SECT_PR}</w:body>"
    assert 'w:w="12240" w:h="15840"' in out and "rIdLEFooter" in out


def test_patch_rels_and_content_types_idempotent():
    rels = t.patch_doc_rels("<Relationships></Relationships>")
    assert 'Id="rIdLEFooter"' in rels and 'Target="footer1.xml"' in rels
    assert t.patch_doc_rels(rels) == rels
    ct = t.patch_content_types("<Types></Types>")
    assert 'PartName="/word/footer1.xml"' in ct
    assert t.patch_content_types(ct) == ct


def test_patches_table_covers_expected_parts():
    assert set(t.PATCHES) == {"word/styles.xml", "word/numbering.xml", "word/settings.xml",
                              "word/theme/theme1.xml", "word/fontTable.xml", "word/document.xml",
                              "word/_rels/document.xml.rels", "[Content_Types].xml"}


def test_build_without_pandoc_exits(monkeypatch, tmp_path):
    monkeypatch.setattr(t.shutil, "which", lambda n: None)
    with pytest.raises(SystemExit) as e:
        t.build(tmp_path / "o.docx")
    assert str(e.value) == "ERROR: pandoc not found on PATH"
    assert not (tmp_path / "o.docx").exists()
