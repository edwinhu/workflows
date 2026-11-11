# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "pyyaml"]
# ///
"""Contract tests for expert-report-docx: template, build pipeline, CSL short forms, OOXML layout.

The fixture under ../fixtures/sample is synthetic. Expected layout values are the ones measured
from the served reference report (docs/investigations/2026-11-10_expert-report-template.md).
"""

from __future__ import annotations

import importlib.util
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Optional

import pytest

SCRIPTS = Path(__file__).resolve().parent
SKILL = SCRIPTS.parent
FIXTURE = SKILL / "fixtures" / "sample"
BUILD = SCRIPTS / "build_docx.py"



def _load(name: str, filename: str):
    """Load by path under a unique name: law-econ-docx imports law-review's `build_docx` into
    sys.modules, and a shared pytest worker would otherwise hand that module to these tests."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


b = _load("expert_report_build_docx", "build_docx.py")
make_template = _load("expert_report_make_template", "make_template.py")

needs_pandoc = pytest.mark.skipif(not shutil.which("pandoc"), reason="pandoc not on PATH")


def member(docx: Path, name: str) -> str:
    with zipfile.ZipFile(docx) as z:
        return z.read(name).decode("utf-8")


def text_of(xml: str) -> str:
    """Run text; a w:noBreakHyphen reads as the hyphen it prints."""
    out = []
    for t, tab, nbh in re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|(<w:tab\s*/>)|(<w:noBreakHyphen\s*/>)", xml):
        out.append("\t" if tab else "-" if nbh else t)
    return "".join(out).replace("&amp;", "&")


def style_xml(styles: str, sid: str) -> str:
    m = re.search(r'<w:style\b[^>]*w:styleId="%s"[^>]*>.*?</w:style>' % sid, styles, re.S)
    assert m, f"style {sid} missing"
    return m.group(0)


def canon(xml: str) -> str:
    """Attribute order and the space before '/>' are serializer choices, not properties."""
    def tag(m):
        attrs = sorted(re.findall(r'[\w:]+="[^"]*"', m.group(2)))
        return "<" + m.group(1) + "".join(" " + a for a in attrs) + ("/>" if m.group(3) else ">")
    return re.sub(r"<([\w:]+)((?:\s+[\w:]+=\"[^\"]*\")*)\s*(/?)>", tag, xml)


def has(xml: str, fragment: str) -> bool:
    return canon(fragment) in canon(xml)


def footnote_texts(fn_xml: str) -> list[str]:
    notes = []
    for m in re.finditer(r'<w:footnote\b([^>]*)>(.*?)</w:footnote>', fn_xml, re.S):
        if "w:type=" in m.group(1):
            continue
        notes.append(text_of(m.group(2)).strip())
    return notes


def run_build(*args: str, project: Path = FIXTURE) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(BUILD), str(project), *args],
                          capture_output=True, text=True)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("build") / "report.docx"
    res = run_build("--output", str(out), "--exhibits", str(FIXTURE / "exhibits"))
    assert res.returncode == 0, f"build failed\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    return {"out": out, "res": res,
            "doc": member(out, "word/document.xml"),
            "fn": member(out, "word/footnotes.xml"),
            "styles": member(out, "word/styles.xml"),
            "settings": member(out, "word/settings.xml")}


# --------------------------------------------------------------------------- template

def test_template_builds_and_verifies(tmp_path):
    out = make_template.build(tmp_path / "t.docx")
    make_template.verify(out)
    styles = member(out, "word/styles.xml")
    for sid in make_template.REQUIRED_STYLES:
        assert f'w:styleId="{sid}"' in styles


def test_template_verify_rejects_missing_style(tmp_path):
    out = make_template.build(tmp_path / "t.docx")
    broken = tmp_path / "broken.docx"
    with zipfile.ZipFile(out) as zin, zipfile.ZipFile(broken, "w") as zout:
        for n in zin.namelist():
            data = zin.read(n)
            if n == "word/styles.xml":
                data = data.replace(b'w:styleId="Placeholder"', b'w:styleId="Gone"')
            zout.writestr(n, data)
    with pytest.raises(SystemExit) as e:
        make_template.verify(broken)
    assert "Placeholder" in str(e.value)


def test_shipped_template_is_current(tmp_path):
    """The committed template must be exactly what make_template.py generates."""
    fresh = make_template.build(tmp_path / "fresh.docx")
    shipped = make_template.DEFAULT_OUT
    for part in ("word/styles.xml", "word/settings.xml", "word/document.xml", "word/footer1.xml"):
        assert member(fresh, part) == member(shipped, part), f"{part} is stale: rerun make_template.py"


# --------------------------------------------------------------------------- pure helpers

def test_normalize_locators():
    src = ("[@a, at 4 ¶ 4]; [@b, at *3]; [@c]; [see @d, § 11(m)]; [@e, pt. II.B.2]; "
           "[@f, slip op. at 87]; [@g, {p. 9}]; [@h, at 2 & n.4]")
    assert b.normalize_locators(src) == (
        "[@a, {p. 4 ¶ 4}]; [@b, {p. \\*3}]; [@c]; [see @d, {§ 11(m)}]; [@e, {pt. II.B.2}]; "
        "[@f, {slip op. at 87}]; [@g, {p. 9}]; [@h, {p. 2 \\& n.4}]")


def test_mark_placeholders_counts_and_handles_nesting():
    md, n = b.mark_placeholders("A [TO SUPPLY: rate [per hour]] and [TO SUPPLY: date].")
    assert n == 2
    assert md == ('A [\\[TO SUPPLY: rate \\[per hour\\]\\]]{custom-style="Placeholder"} and '
                  '[\\[TO SUPPLY: date\\]]{custom-style="Placeholder"}.')


def test_protect_bib_braces_title_fields_only():
    bib = ('@article{k, title = {Shelf Registration}, journaltitle = "Virginia Law Review",\n'
           '  type = {S. Rep.}, shorttitle={{Already}}, note = {keep {x}}}')
    out = b.protect_bib(bib)
    assert "title = {{Shelf Registration}}" in out
    assert "journaltitle = {{Virginia Law Review}}" in out
    assert "type = {S. Rep.}" in out
    assert "shorttitle={{Already}}" in out
    assert "note = {keep {x}}" in out


def test_caption_precedence(tmp_path):
    proj = tmp_path / "p"
    (proj / ".planning").mkdir(parents=True)
    (proj / ".planning" / "plan.md").write_text(
        "---\nworkflow: writing\ncaption:\n  court: PLAN COURT\n---\n\n# Plan\n")
    cap, src = b.load_caption(proj, None)
    assert cap["court"] == "PLAN COURT" and src.endswith("plan.md")
    (proj / "caption.yaml").write_text("court: PROJECT COURT\n")
    cap, src = b.load_caption(proj, None)
    assert cap["court"] == "PROJECT COURT"
    explicit = tmp_path / "x.yaml"
    explicit.write_text("court: EXPLICIT COURT\n")
    cap, _ = b.load_caption(proj, explicit)
    assert cap["court"] == "EXPLICIT COURT"
    assert b.load_caption(tmp_path / "empty", None) == (None, None)


def test_caption_in_re_matter_and_placeholder_highlight():
    xml = b.caption_xml({"court": "UNITED STATES DISTRICT COURT", "matter": ["IN RE ACME WIDGET CO.",
                         "SECURITIES LITIGATION"], "case_number": "[TO SUPPLY: case number]",
                         "report_title": "REBUTTAL REPORT OF"})
    assert "IN RE ACME WIDGET CO." in xml and "Plaintiffs," not in xml and "v." not in xml
    run = re.search(r"<w:r>(?:(?!</w:r>).)*\[TO SUPPLY: case number\]", xml).group(0)
    assert '<w:highlight w:val="yellow"/>' in run


@pytest.mark.skipif(not shutil.which("uv"), reason="uv not on PATH")
def test_import_without_pyyaml_raises_instead_of_reexec():
    """The pyyaml re-exec is for `uv run python3 build_docx.py`; an importer must get the error."""
    code = ("import importlib.util as u; s = u.spec_from_file_location('x', %r); "
            "m = u.module_from_spec(s); s.loader.exec_module(m)" % str(BUILD))
    res = subprocess.run(["uv", "run", "--quiet", "--no-project", "--isolated", "python3", "-c", code],
                         capture_output=True, text=True)
    assert res.returncode != 0
    assert "No module named 'yaml'" in res.stderr and "usage:" not in res.stdout + res.stderr


# --------------------------------------------------------------------------- full build

@needs_pandoc
def test_build_counts(built):
    out = built["res"].stdout
    assert "Footnotes: 9 (definitions: 9)" in out
    assert "Placeholders: 2" in out
    fns = footnote_texts(built["fn"])
    assert len(fns) == 9


@needs_pandoc
def test_no_unresolved_citations(built):
    assert "[@" not in text_of(built["doc"])
    assert "[@" not in text_of(built["fn"])


@needs_pandoc
def test_placeholders_highlighted_in_body_and_footnote(built):
    def hl(xml):
        return [r for r in re.findall(r"<w:r>(?:(?!</w:r>).)*</w:r>", xml, re.S)
                if 'w:val="Placeholder"' in r and '<w:highlight w:val="yellow"/>' in r]
    body, fn = hl(built["doc"]), hl(built["fn"])
    assert len(body) == 1 and len(fn) == 1
    assert "[TO SUPPLY: hourly rate]" in text_of(body[0])
    assert "[TO SUPPLY: retention date]" in text_of(fn[0])


@needs_pandoc
def test_styles_carry_measured_values(built):
    s = built["styles"]
    h1 = style_xml(s, "Heading1")
    assert has(h1, '<w:jc w:val="left"/>') and has(h1, "<w:caps/>") and has(h1, "<w:b/>")
    assert has(h1, '<w:ind w:left="720" w:hanging="720"/>')
    h2 = style_xml(s, "Heading2")
    assert has(h2, '<w:ind w:left="1440" w:hanging="720"/>') and has(h2, "<w:b/>")
    ft = style_xml(s, "FootnoteText")
    assert has(ft, '<w:sz w:val="20"/>')
    assert has(ft, '<w:ind w:left="0" w:firstLine="720"/>')
    assert has(ft, '<w:spacing w:before="0" w:after="0" w:line="230" w:lineRule="exact"/>')
    bt = style_xml(s, "BlockText")
    assert has(bt, '<w:ind w:left="720" w:right="720" w:firstLine="0"/>')
    assert has(bt, '<w:spacing w:before="0" w:after="276" w:line="240" w:lineRule="auto"/>')
    body = style_xml(s, "BodyText")
    assert has(body, '<w:ind w:firstLine="720"/>') and has(body, '<w:jc w:val="both"/>')
    assert has(body, '<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>')
    ref = style_xml(s, "FootnoteReference")
    assert has(ref, '<w:vertAlign w:val="superscript"/>') and "<w:sz" not in ref and "<w:position" not in ref
    assert has(style_xml(s, "Placeholder"), '<w:highlight w:val="yellow"/>')
    for sid in ("CaptionCourt", "CaptionLeft", "CaptionRight", "Signature", "SignatureDate",
                "AsteriskBreak", "OrdinalPoint", "ExhibitTitle"):
        style_xml(s, sid)


@needs_pandoc
def test_section_page_setup(built):
    sect = re.findall(r"<w:sectPr\b.*?</w:sectPr>", built["doc"], re.S)[-1]
    assert has(sect, '<w:pgSz w:w="12240" w:h="15840"/>')
    assert has(sect, '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
                     'w:header="720" w:footer="720" w:gutter="0"/>')
    assert "titlePg" not in sect
    assert "footerReference" in sect and "headerReference" not in sect
    footer = member(built["out"], "word/footer1.xml")
    assert "PAGE" in footer and has(footer, '<w:jc w:val="center"/>') and has(footer, '<w:sz w:val="22"/>')
    assert footer.count("<w:p>") == 2


@needs_pandoc
def test_footnote_separators_and_marks(built):
    fn = built["fn"]
    assert re.search(r'w:type="separator"[^>]*>.*?<w:separator\s*/>', fn, re.S)
    assert re.search(r'w:type="continuationSeparator"[^>]*>.*?<w:continuationSeparator\s*/>', fn, re.S)
    assert '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat>' \
        in built["settings"]
    # Word 2010 mode, as served: in mode 15 Word draws the continuation separator 2" long
    # (Word render of the real report, p. 24); in mode 14 full width, 468 pt, as served
    assert re.search(r'w:name="compatibilityMode"[^>]*w:val="14"', built["settings"])
    sep = re.search(r'<w:footnote w:type="separator".*?</w:footnote>', fn, re.S).group(0)
    assert 'w:before="0" w:after="0" w:line="240"' in sep
    # footnote-area number: the superscript FootnoteReference style at the note's 10 pt, then a
    # SPACE (not a tab); the 0.5" indent comes from FootnoteText's first-line indent
    first = re.search(r'<w:footnote w:id="[1-9]\d*">(.*?)</w:footnote>', fn, re.S).group(1)
    assert re.search(r'<w:rStyle w:val="FootnoteReference"\s*/>\s*</w:rPr>\s*<w:footnoteRef\s*/>', first, re.S)
    assert "<w:tab" not in first.split("<w:footnoteRef")[0]
    assert text_of(first).startswith(" See")


@needs_pandoc
def test_caption_block(built):
    doc, txt = built["doc"], text_of(built["doc"])
    for s in ("UNITED STATES DISTRICT COURT", "DISTRICT OF DELAWARE", "ACME WIDGET CO., ET AL.,",
              "Plaintiffs,", "v.", "GLOBEX INDUSTRIAL CORP., ET AL.,", "Defendants.",
              "CASE NO. 1:24-cv-00999-UNA", "REBUTTAL REPORT OF", "PROFESSOR JANE Q. PUBLIC"):
        assert s in txt, s
    # the caption precedes Part I and is a two-column table bracketed by a bottom + inside rule
    assert txt.index("UNITED STATES DISTRICT COURT") < txt.index("BACKGROUND, INTRODUCTION")
    tbl = re.search(r"<w:tbl>.*?</w:tbl>", doc, re.S).group(0)
    assert tbl.count('<w:gridCol w:w="4788"/>') == 2
    assert '<w:insideV w:val="single" w:sz="4"' in tbl and '<w:bottom w:val="single" w:sz="4"' in tbl
    assert '<w:top w:val="nil"/>' in tbl and '<w:left w:val="nil"/>' in tbl
    # mode 14 hangs the border one cell margin left of the text: border x 66.6, text at the margin
    assert '<w:tblInd w:w="0" w:type="dxa"/>' in tbl
    # pandoc's default table style bottom-aligns a first row: Word applied it and dropped the right
    # column 74 pt (CASE NO. y 198.1 vs served 124.2). No first-row look, cells top-aligned.
    assert 'w:firstRow="0"' in tbl and 'w:firstRow="1"' not in tbl
    assert len(re.findall(r"<w:tcPr>(?:(?!</w:tcPr>).)*<w:vAlign w:val=\"top\"/>", tbl, re.S)) == 2


@needs_pandoc
def test_body_structure(built):
    txt = text_of(built["doc"])
    assert "1.\tI am the Distinguished Professor" in txt
    assert "I.\tBACKGROUND, INTRODUCTION, AND SUMMARY." in txt
    assert "A.\tPROCEDURAL BACKGROUND" in txt
    assert "II.\tPRACTITIONER FRAMEWORKS" in txt
    assert "*\t*\t*\t*" in txt
    assert "•\tFirst, longstanding" in txt
    doc = built["doc"]
    assert re.search(r'<w:pStyle w:val="BlockText"\s*/>.*?Standard practitioner frameworks', doc, re.S)
    assert re.search(r'<w:pStyle w:val="Signature"\s*/>(?:(?!</w:p>).)*Jane Q\. Public', doc, re.S)
    assert re.search(r'<w:pStyle w:val="SignatureDate"\s*/>(?:(?!</w:p>).)*November 10, 2026', doc, re.S)
    assert txt.index("Jane Q. Public") > txt.index("For the reasons set forth above")
    assert "EXHIBIT A" in txt and "MATERIALS REVIEWED" in txt
    assert txt.index("EXHIBIT A") > txt.index("November 10, 2026")
    # a heading directly under another takes no space before (one blank line, as served)
    assert re.search(r'<w:pStyle w:val="Heading2"\s*/><w:spacing w:before="0"\s*/>'
                     r'(?:(?!</w:p>).)*THE GOVERNING FRAMEWORK', doc, re.S)
    assert not re.search(r'<w:pStyle w:val="Heading2"\s*/><w:spacing w:before="0"\s*/>'
                         r'(?:(?!</w:p>).)*PROCEDURAL BACKGROUND', doc, re.S)


EXPECTED_NOTES = [
    "See Alex Doe, Shelf Registration and Due Diligence, 87 Va. L. Rev. 1001, 1010 (2001); "
    "see also [TO SUPPLY: retention date].",
    "Expert Report of Professor Richard Roe in In re Acme Widget Co. Securities Litigation, "
    "No. 1:24-cv-00999-UNA (Oct. 15, 2026), at 4 ¶ 4 [hereinafter Roe Report].",
    "Id. at 5 ¶ 6.",
    "See Smith v. Jones, 900 F.2d 100, 105 (2d Cir. 1990); In re Acme Widget Co. Stockholder "
    "Litigation, No. 2019-0123-VCL, 2019 WL 1234567, at *3 (Del. Ch. Mar. 14, 2019); Proposed "
    "Amendments to the Resale Safe Harbor, Securities Act Release No. 33-7391, 1997 WL 70601, at *4 "
    "(Feb. 20, 1997) [hereinafter Resale Release].",
    "See S. Rep. No. 73-47, at 5–6 (1933); 15 U.S.C. § 77o; Smith & Partners LLP, Resales "
    "Under the Safe Harbor: A Client Guide (Feb. 2025), at 2 "
    "[hereinafter Smith & Partners Guide]. For further discussion, see Doe, supra note 1, "
    "at 1015 in the article.",
    "15 U.S.C. § 77o(b); see Doe, supra note 1, at 1015; Smith, 900 F.2d at 108; 15 U.S.C. § 77o(c)(1).",
    "Roe Report, supra note 2, at 12 ¶ 25; see also Acme Widget, 2019 WL 1234567, at *5; "
    "S. Rep. No. 73-47, at 6 (1933).",
    "Deposition of Richard Roe in In re Acme Widget Co. Securities Litigation, "
    "No. 1:24-cv-00999-UNA (Nov. 1, 2026), at 45 [hereinafter Roe Deposition].",
    "Id. at 47.",
]


def nbsp_sections(s: str) -> str:
    """Bluebook spacing as built: a non-breaking space after § and §§ (Word render: a line broke
    after "§" in the real report)."""
    return re.sub(r"(§+) ", "\\1\u00a0", s)


EXPECTED_NOTES = [nbsp_sections(n) for n in EXPECTED_NOTES]


@needs_pandoc
@pytest.mark.parametrize("i", range(len(EXPECTED_NOTES)))
def test_footnote_citation_rendering(built, i):
    assert footnote_texts(built["fn"])[i] == EXPECTED_NOTES[i]


@needs_pandoc
def test_citation_typography_and_suppressed_fields(built):
    fn = built["fn"]
    txt = text_of(fn)
    for s in ("supra note", "Id.", "[hereinafter", "Va. L. Rev."):
        assert s in txt
    for leak in ("Internal verification", "internal archive", "never print", "Verified on PDF",
                 "Dummy-director", "Virginia Law Review"):
        assert leak not in txt
    assert "  (" not in txt and "; (" not in txt and "see (" not in txt
    assert re.search(r'<w:smallCaps\s*/>(?:(?!</w:r>).)*Va\. L\. Rev\.', fn, re.S)
    assert re.search(r'<w:i\s*/>(?:(?!</w:r>).)*Smith v\. Jones', fn, re.S)
    # the litigation an expert report was served in: case name italic, docket roman (as served)
    assert re.search(r'<w:i\s*/>(?:(?!</w:r>).)*>In re Acme Widget Co\. Securities Litigation<', fn, re.S)
    assert re.search(r'<w:i\s*/>(?:(?!</w:r>).)*supra', fn, re.S)


@needs_pandoc
def test_draft_header_switch(tmp_path, built):
    assert not [n for n in zipfile.ZipFile(built["out"]).namelist() if n.startswith("word/header")]
    out = tmp_path / "draft.docx"
    res = run_build("--output", str(out), "--draft-header")
    assert res.returncode == 0, res.stderr
    names = zipfile.ZipFile(out).namelist()
    hdrs = [n for n in names if n.startswith("word/header")]
    assert hdrs and "DRAFT, PRIVILEGED AND CONFIDENTIAL" in text_of(member(out, hdrs[0]))
    assert "headerReference" in member(out, "word/document.xml")


@needs_pandoc
def test_draft_header_from_caption_yaml(tmp_path):
    cap = tmp_path / "cap.yaml"
    cap.write_text((FIXTURE / "caption.yaml").read_text() + "draft_header: true\n")
    out = tmp_path / "d.docx"
    res = run_build("--output", str(out), "--caption", str(cap))
    assert res.returncode == 0, res.stderr
    assert "headerReference" in member(out, "word/document.xml")


def _copy_fixture(tmp_path: Path) -> Path:
    proj = tmp_path / "proj"
    shutil.copytree(FIXTURE, proj)
    return proj


@needs_pandoc
def test_missing_caption_warns_and_builds(tmp_path):
    proj = _copy_fixture(tmp_path)
    (proj / "caption.yaml").unlink()
    res = run_build("--output", str(tmp_path / "o.docx"), project=proj)
    assert res.returncode == 0, res.stderr
    assert "WARN: no caption" in res.stderr
    assert "<w:tbl>" not in member(tmp_path / "o.docx", "word/document.xml")


@needs_pandoc
def test_unknown_citation_key_fails(tmp_path):
    proj = _copy_fixture(tmp_path)
    d = proj / "drafts" / "Part II. Analysis (Draft).md"
    d.write_text(d.read_text().replace("[@roedep2026, at 47]", "[@nosuchkey, at 47]"))
    res = run_build("--output", str(tmp_path / "o.docx"), project=proj)
    assert res.returncode != 0
    assert "nosuchkey" in res.stderr


@needs_pandoc
def test_body_citation_outside_footnote_fails_count(tmp_path):
    proj = _copy_fixture(tmp_path)
    d = proj / "drafts" / "Part II. Analysis (Draft).md"
    d.write_text(d.read_text().replace("this literature.[^p2-overlooks]",
                                       "this literature [@smith1990].[^p2-overlooks]"))
    res = run_build("--output", str(tmp_path / "o.docx"), project=proj)
    assert res.returncode != 0
    assert "Footnotes: 10 (definitions: 9)" in res.stdout + res.stderr


# --------------------------------------------------------------------------- --pdf: Word only
# --pdf renders through real Word in the Windows guest (docx-render's word-remote) and nothing
# else; the PDF must say Microsoft Word in its Producer and carry Times New Roman.

WORD_PRODUCER = "Microsoft® Word for Microsoft 365"  # emitted by the guest, measured 2026-11-10
FORBIDDEN = ("soffice", "libreoffice", "x2t")


def tiny_pdf(path: Path, producer: str, font: str = "TimesNewRomanPSMT", text: str = "x") -> Path:
    """A one-page PDF with an Info Producer/Creator and one font resource (xref computed)."""
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        f"<< /Type /Font /Subtype /TrueType /BaseFont /{font} >>",
        None,
        f"<< /Producer ({producer}) /Creator ({producer}) >>",
    ]
    lines = re.sub(r"[^A-Za-z ]", " ", text).split() or ["x"]  # one per line: pdftotext crops at the page edge
    stream = b"BT /F1 1 Tf 1 TL 72 780 Td " + b"".join(b"(%s) ' " % w.encode() for w in lines) + b"ET"
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        body = (b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
                if o is None else o.encode("latin-1"))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 6 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    path.write_bytes(bytes(out))
    return path


needs_poppler = pytest.mark.skipif(not (shutil.which("pdfinfo") and shutil.which("pdffonts")),
                                   reason="poppler pdfinfo/pdffonts not on PATH")
needs_uv = pytest.mark.skipif(not shutil.which("uv"), reason="uv not on PATH")


@needs_poppler
def test_word_producer_accepted(tmp_path):
    pdf = tiny_pdf(tmp_path / "w.pdf", WORD_PRODUCER.encode("latin-1").decode("latin-1"))
    assert "Microsoft" in b.check_word_pdf(pdf)


@needs_poppler
def test_libreoffice_producer_rejected(tmp_path):
    pdf = tiny_pdf(tmp_path / "lo.pdf", "LibreOffice 24.8")
    with pytest.raises(SystemExit) as e:
        b.check_word_pdf(pdf)
    assert "LibreOffice 24.8" in str(e.value) and "not Microsoft Word" in str(e.value)


@needs_poppler
def test_substituted_font_rejected(tmp_path):
    pdf = tiny_pdf(tmp_path / "cal.pdf", "Microsoft Word", font="Calibri")
    with pytest.raises(SystemExit) as e:
        b.check_word_pdf(pdf)
    assert "Times New Roman" in str(e.value) and "Calibri" in str(e.value)


@needs_pandoc
def test_lists_use_no_word_numbering(built):
    """Word sets a numbering suffix in Arial whatever the level fonts say (Word render of the
    fixture's exhibit, 2026-11-10), so markdown lists become Ordinal Point paragraphs with a
    literal mark and tab, like the drafts' ordinal points."""
    assert "<w:numPr>" not in built["doc"]
    items = [text_of(m) for m in re.findall(r'<w:p>(?:(?!</w:p>).)*?w:val="OrdinalPoint".*?</w:p>', built["doc"], re.S)]
    assert "•\tAcademic articles and treatises cited in the Report." in items


def test_list_blocks_pure():
    blocks = [{"t": "BulletList", "c": [[{"t": "Plain", "c": [b.Str("one")]}],
                                         [{"t": "Plain", "c": [b.Str("two")]}]]},
              {"t": "OrderedList", "c": [[3, {"t": "Decimal"}, {"t": "Period"}],
                                          [[{"t": "Para", "c": [b.Str("three")]}]]]}]
    out = b.list_blocks(blocks)
    assert [stringify(x) for x in out] == ["•\tone", "•\ttwo", "3.\tthree"]
    assert all(x["t"] == "Div" and x["c"][0][2] == [["custom-style", "Ordinal Point"]] for x in out)


def stringify(div):
    """Text of a Div's one paragraph (b.stringify reads inlines, not blocks)."""
    return b.stringify(div["c"][1][0]["c"])


def test_check_fonts_pure():
    assert b.check_fonts(["BCDEEE+TimesNewRomanPSMT", "BCDFEE+TimesNewRomanPS-BoldMT"]) == []
    assert b.check_fonts(["ABCDEF+Cambria", "TimesNewRomanPSMT"]) == ["ABCDEF+Cambria"]
    assert b.check_fonts(["SymbolMT", "TimesNewRomanPSMT"]) == []
    assert b.check_fonts(["SymbolMT"]) == ["(no Times New Roman font)"]


def test_pdf_identity_check():
    """The guest stages every job as _job.docx with no lock: a concurrent render can hand back
    another document's PDF, which the Producer check cannot see."""
    doc = "EXPERT REPORT OF JANE PUBLIC concerning widgets and the governance of widget makers"
    assert b.pdf_matches_docx(doc, "EXPERT REPORT OF JANE\nPUBLIC concerning widgets and the governance of widget makers 1")
    assert not b.pdf_matches_docx(doc, "Quarterly sales memo for the northeast region and its distributors")


class _Spy:
    """Record every process started anywhere in this process (subprocess.run goes through Popen)."""
    def __init__(self, monkeypatch):
        self.cmds: list[str] = []
        spy = self

        class Popen(subprocess.Popen):
            def __init__(self, cmd, *a, **k):
                spy.cmds.append(" ".join(map(str, cmd)) if isinstance(cmd, (list, tuple)) else str(cmd))
                super().__init__(cmd, *a, **k)
        monkeypatch.setattr(subprocess, "Popen", Popen)

    def forbidden(self) -> list[str]:
        return [c for c in self.cmds if any(f in c.lower() for f in FORBIDDEN)]


@needs_pandoc
@needs_poppler
def test_pdf_calls_word_remote_only(tmp_path, monkeypatch):
    calls = []

    class FakeDocRender:
        @staticmethod
        def convert(src, dst, **kw):
            calls.append(kw)
            words = " ".join(sorted(b._words(b.docx_text(member(Path(src), "word/document.xml"))
                                             + " " + b.docx_text(member(Path(src), "word/footnotes.xml")))))
            tiny_pdf(Path(dst), "Microsoft Word for Microsoft 365", text=words)
            return Path(dst)
    monkeypatch.setattr(b, "_doc_render", lambda: FakeDocRender)
    spy = _Spy(monkeypatch)
    out = b.build(FIXTURE, tmp_path / "r.docx", pdf=True)
    assert calls == [{"renderer": "word-remote"}]
    assert (tmp_path / "r.pdf").exists() and out == tmp_path / "r.docx"
    assert spy.forbidden() == []


@needs_pandoc
def test_pdf_renderer_failure_exits_without_fallback(tmp_path, monkeypatch):
    calls = []

    class FakeDocRender:
        @staticmethod
        def convert(src, dst, **kw):
            calls.append(kw)
            raise RuntimeError("word-remote render failed (exit 255): ssh: connect refused")
    monkeypatch.setattr(b, "_doc_render", lambda: FakeDocRender)
    spy = _Spy(monkeypatch)
    with pytest.raises(SystemExit) as e:
        b.build(FIXTURE, tmp_path / "r.docx", pdf=True)
    msg = str(e.value)
    assert e.value.code not in (0, None)
    assert "docker start omarchy-windows" in msg and "word@winvm" in msg
    assert "connect refused" in msg
    assert calls == [{"renderer": "word-remote"}]
    assert spy.forbidden() == [] and not (tmp_path / "r.pdf").exists()


@needs_pandoc
def test_pdf_cli_unreachable_guest_fails_loudly(tmp_path):
    """End to end: a failing transport and decoy soffice/x2t on PATH -> non-zero, decoys untouched."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    marker = tmp_path / "decoy-ran"
    for name in ("soffice", "libreoffice", "x2t"):
        exe = bindir / name
        exe.write_text(f"#!/bin/sh\necho {name} >> {marker}\nexit 0\n")
        exe.chmod(0o755)
    transport = bindir / "word_render_remote.sh"
    transport.write_text("#!/bin/sh\necho 'ssh: connect to host winvm port 22: Connection refused' >&2\nexit 255\n")
    transport.chmod(0o755)
    env = {**__import__("os").environ, "PATH": f"{bindir}:{__import__('os').environ['PATH']}",
           "WORD_RENDER_REMOTE": str(transport)}
    res = subprocess.run([sys.executable, str(BUILD), str(FIXTURE), "--output", str(tmp_path / "r.docx"),
                          "--pdf"], capture_output=True, text=True, env=env)
    assert res.returncode != 0
    assert "docker start omarchy-windows" in res.stderr and "Connection refused" in res.stderr
    assert not marker.exists(), marker.read_text()
    assert not (tmp_path / "r.pdf").exists()


def test_build_source_names_no_other_renderer():
    for path in (BUILD, SKILL / "SKILL.md"):
        for line in path.read_text().splitlines():
            if re.search(r"soffice|libreoffice|x2t", line, re.I):
                assert re.search(r"\bnever\b", line, re.I), f"{path.name}: {line.strip()}"


def _guest_reachable() -> Optional[str]:
    if not shutil.which("ssh"):
        return "ssh not on PATH"
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes", "word@winvm", "exit"],
                       capture_output=True, text=True)
    return None if r.returncode == 0 else f"ssh word@winvm unreachable: {r.stderr.strip()[-200:]}"


MEASURE = r"""
import json, sys, fitz
pdf = fitz.open(sys.argv[1])
lines, rules = [], []
for b in pdf[0].get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        t = "".join(s["text"] for s in l["spans"]).strip()
        if t:
            lines.append([round(l["spans"][0]["origin"][1], 1), round(l["bbox"][0], 1), t])
for i, pg in enumerate(pdf):
    for d in pg.get_drawings():
        r = d["rect"]
        if d.get("fill") is not None and d["fill"] == (0.0, 0.0, 0.0) and (r.width > 20 or r.height > 20):
            rules.append([i + 1, round(r.x0, 1), round(r.x1, 1), round(r.y0, 2), round(r.width, 2), round(r.height, 2)])
print(json.dumps({"p1": lines, "rules": rules}))
"""

LONG_NOTE_DRAFT = ("# IV. A LONG NOTE.\n\n90\\. This paragraph carries a note too long for one page."
                   "[^p4-long]\n\n[^p4-long]: " + " ".join(
                       f"Sentence {i} of a note that must run over a page break, so Word draws the "
                       "continuation separator above its carried-over text." for i in range(70)) + "\n")


@needs_pandoc
@needs_poppler
@needs_uv
def test_pdf_word_render_integration(tmp_path):
    why = _guest_reachable()
    if why:
        pytest.skip(f"Word guest not reachable, Word render NOT verified ({why}); "
                    "docker start omarchy-windows")
    proj = _copy_fixture(tmp_path)
    (proj / "drafts" / "Part IV. Long Note (Draft).md").write_text(LONG_NOTE_DRAFT)
    out = tmp_path / "r.docx"
    res = run_build("--output", str(out), "--exhibits", str(FIXTURE / "exhibits"), "--pdf", project=proj)
    assert res.returncode == 0, res.stderr
    pdf = tmp_path / "r.pdf"
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    assert re.search(r"^Producer:\s+Microsoft.*Word", info, re.M), info
    fonts = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True).stdout
    assert "TimesNewRomanPSMT" in fonts and not re.search(r"Cambria|Calibri|Liberation", fonts), fonts
    assert f"PDF producer: {WORD_PRODUCER}" in res.stdout
    assert re.search(r"PDF pages: \d+", res.stdout)
    assert "PDF [@ left: 0" in res.stdout
    assert "PDF placeholders: 2" in res.stdout
    assert re.search(r"Arial|Symbol|Courier|Wingdings", fonts) is None, fonts
    # metadata: stripped after Word, and the Producer check ran on the stripped file
    assert_pdf_clean(pdf)
    assert_no_metadata(out)
    # Word writes no Author or Title when the docx has none (measured 2026-11-10): what it does
    # write is the render dates and XMP document/instance ids
    line = re.search(r"^PDF metadata stripped: (.*)$", res.stdout, re.M)
    assert line and "CreationDate" in line.group(1), res.stdout
    assert "Creator" not in line.group(1).replace("CreationDate", "") and "Producer" not in line.group(1)
    # measured in Word's PDF
    m = subprocess.run(["uv", "run", "--quiet", "--no-project", "--with", "pymupdf", "python3", "-I",
                        "-W", "ignore", "-c", MEASURE, str(pdf)], capture_output=True, text=True)
    assert m.returncode == 0, m.stderr
    geo = __import__("json").loads(m.stdout)
    base = {t: y for y, _x, t in geo["p1"]}
    # 3: CASE NO. shares the first party line's baseline (served 124.2)
    assert abs(base["CASE NO. 1:24-cv-00999-UNA"] - base["ACME WIDGET CO., ET AL.,"]) < 0.5, geo["p1"]
    p1 = [r for r in geo["rules"] if r[0] == 1]
    # 4: caption rule x 66.6-305.8, 0.48 pt high (served 0.48)
    cap = [r for r in p1 if r[1] < 70 and 300 < r[2] < 310 and r[4] > 200]
    assert cap and abs(cap[0][5] - 0.48) < 0.05, p1
    # 2: footnote separator 144 pt x 0.72 (served 0.72)
    seps = [r for r in geo["rules"] if abs(r[1] - 72) < 0.5 and abs(r[4] - 144) < 0.5]
    assert seps and all(abs(r[5] - 0.72) < 0.05 for r in seps), seps
    # 1: the continued note's page draws a full-width continuation separator, 468 pt
    cont = [r for r in geo["rules"] if abs(r[1] - 72) < 0.5 and abs(r[4] - 468) < 1 and r[5] < 1]
    assert cont, geo["rules"]
    # 5: no line ends in a section sign
    ptxt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True).stdout
    assert not [ln for ln in ptxt.splitlines() if ln.rstrip().endswith("§")]


# --------------------------------------------------------------------------- fixes after review
# The base fixture plus fixtures/sample/extra/Part III (statute pins, a docketed expert report,
# a firm memo with a generic genre label, a book, dockets in body and notes).

EXTRA_NOTES = [
    "Del. Code Ann. tit. 8, § 144(d)(2).",
    "Example & Partners LLP, Who Is a Controlling Person? (May 17, 2022); see also "
    "Smith & Partners Guide, supra note 5, at 3.",
    "Expert Report of Professor Richard Roe in Doe v. Example Corp., C.A. No. 2019-0001-ABC "
    "(Del. Ch. Nov. 2, 2021), at 38 ¶ 75 [hereinafter Roe Example Report]. The report says so.",
    "See Doe, supra note 1, at 1012.",
    "A. Author, Corporate Control 12 (2d ed. 2001); see Doe, supra note 1, at 1020.",
    "Del. Code Ann. tit. 8, § 144(d)(1).",
]


def _extra_project(tmp: Path, typography: Optional[str] = None) -> Path:
    proj = tmp / "proj"
    shutil.copytree(FIXTURE, proj)
    shutil.copy(FIXTURE / "extra" / "Part III. Review Fixes (Draft).md", proj / "drafts")
    if typography:
        (proj / "caption.yaml").write_text((FIXTURE / "caption.yaml").read_text()
                                           + f"typography: {typography}\n")
    return proj


def _build_extra(tmp: Path, *args: str, typography: Optional[str] = None) -> dict:
    proj = _extra_project(tmp, typography)
    out = tmp / "extra.docx"
    res = run_build("--output", str(out), *args, project=proj)
    assert res.returncode == 0, f"build failed\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    return {"out": out, "res": res, "doc": member(out, "word/document.xml"),
            "fn": member(out, "word/footnotes.xml")}


@pytest.fixture(scope="module")
def extra(tmp_path_factory):
    return _build_extra(tmp_path_factory.mktemp("extra"))


@pytest.fixture(scope="module")
def extra_plain(tmp_path_factory):
    return _build_extra(tmp_path_factory.mktemp("extra_plain"), typography="plain")


@needs_pandoc
def test_extra_counts(extra):
    assert "Footnotes: 15 (definitions: 15)" in extra["res"].stdout
    assert footnote_texts(extra["fn"])[:9] == EXPECTED_NOTES


@needs_pandoc
@pytest.mark.parametrize("i", range(len(EXTRA_NOTES)))
def test_extra_footnote_rendering(extra, i):
    """Statute pin replaces the title's section; docket is not a number; pin before
    [hereinafter]; a firm memo prints no generic genre label; a book edition reads 2d."""
    assert footnote_texts(extra["fn"])[9 + i] == EXTRA_NOTES[i]


@needs_pandoc
def test_statute_section_never_doubled(extra):
    txt = text_of(extra["fn"])
    assert not re.search(r"§[\s ]*144[\s ]+§", txt)
    assert "Firm publication" not in txt


def test_nobreak_dockets_pure():
    xml = ('<w:r><w:t xml:space="preserve">C.A. No. 2019-0001-ABC and No. CV-24-0999-PHX-ABC, '
           'Release No. 33-7391, a well-known Rule 10b-5 claim, Form 10-K</w:t></w:r>')
    out = b.nobreak_dockets(xml)
    txt = text_of(out)
    assert txt == text_of(xml)
    for docket in ("2019-0001-ABC", "CV-24-0999-PHX-ABC", "33-7391"):
        assert docket.replace("-", "<w:noBreakHyphen/>") in re.sub(r"</?w:t[^>]*>", "", out)
    for kept in ("well-known", "10b-5", "10-K"):
        assert kept in out  # ordinary hyphens elsewhere stay breakable


@needs_pandoc
def test_docket_hyphens_nonbreaking_in_body_and_footnotes(extra):
    def plain(xml):  # join the run text with the hyphen elements left visible
        return re.sub(r"</?w:t(?:\s[^>]*)?>", "", xml)
    fn, doc = plain(extra["fn"]), plain(extra["doc"])
    assert "2019<w:noBreakHyphen/>0001<w:noBreakHyphen/>ABC" in fn
    assert "1:24<w:noBreakHyphen/>cv<w:noBreakHyphen/>00999<w:noBreakHyphen/>UNA" in fn
    assert "CV<w:noBreakHyphen/>24<w:noBreakHyphen/>0999<w:noBreakHyphen/>PHX<w:noBreakHyphen/>ABC" in doc
    assert "1:24<w:noBreakHyphen/>cv<w:noBreakHyphen/>00999<w:noBreakHyphen/>UNA" in doc  # caption
    assert not re.search(r"<w:t(?:\s[^>]*)?>[^<]*\d{4}-\d{4}-[A-Z]", extra["fn"] + extra["doc"])
    assert "well-known" in doc


@needs_pandoc
def test_lettered_heading_indented_as_served(built):
    """Served surrebuttal: Part numeral x 72.0, lettered heading letter x 108.0-108.1, text x 144.0."""
    s = built["styles"]
    assert has(style_xml(s, "Heading1"), '<w:ind w:left="720" w:hanging="720"/>')   # numeral at 0
    assert has(style_xml(s, "Heading2"), '<w:ind w:left="1440" w:hanging="720"/>')  # letter at 0.5"


def _sc(fn: str, text: str) -> bool:
    return re.search(r'<w:smallCaps\s*/>(?:(?!</w:r>).)*>' + re.escape(text), fn, re.S) is not None


def _it(fn: str, text: str) -> bool:
    return re.search(r'<w:i\s*/>(?:(?!</w:r>).)*>' + re.escape(text), fn, re.S) is not None


@needs_pandoc
def test_typography_default_smallcaps(extra):
    """Default = the served footnotes: journals, books and firm memos (author, title, short name)
    in small caps."""
    fn = extra["fn"]
    assert "Typography: smallcaps" in extra["res"].stdout
    assert _sc(fn, "Va. L. Rev.")
    assert _sc(fn, "Example &amp; Partners LLP") and _sc(fn, "Who Is a Controlling Person?")
    assert _sc(fn, "Smith &amp; Partners Guide")  # [hereinafter] and supra short name
    assert _sc(fn, "A. Author") and _sc(fn, "Corporate Control")
    assert not _sc(fn, "Expert Report of Professor Richard Roe")  # reports and their names roman
    assert not _sc(fn, "Roe Example Report")


@needs_pandoc
def test_typography_plain_from_caption(extra, extra_plain):
    fn = extra_plain["fn"]
    assert "Typography: plain" in extra_plain["res"].stdout
    assert "<w:smallCaps" not in fn
    assert _it(fn, "Who Is a Controlling Person?") and _it(fn, "Corporate Control")
    assert _it(fn, "Shelf Registration and Due Diligence") and _it(fn, "Smith v. Jones")
    assert not _it(fn, "Va. L. Rev.") and not _it(fn, "Example &amp; Partners LLP")
    assert footnote_texts(fn) == footnote_texts(extra["fn"])  # same words, typography only


@needs_pandoc
def test_typography_flag_overrides_caption(tmp_path):
    r = _build_extra(tmp_path / "a", "--typography", "smallcaps", typography="plain")
    assert "Typography: smallcaps" in r["res"].stdout and _sc(r["fn"], "Va. L. Rev.")
    r = _build_extra(tmp_path / "b", "--typography", "plain")
    assert "Typography: plain" in r["res"].stdout and "<w:smallCaps" not in r["fn"]


@needs_pandoc
def test_typography_rejects_unknown_value(tmp_path):
    proj = _extra_project(tmp_path, "fancy")
    res = run_build("--output", str(tmp_path / "o.docx"), project=proj)
    assert res.returncode != 0 and "typography" in res.stderr


# --------------------------------------------------------------------------- continuation paragraphs
# A `:::: {.continuation}` div marks text that carries on a paragraph after a block quote.

def _para_xml(doc: str, text: str) -> str:
    for m in re.finditer(r"<w:p\b(?:(?!<w:p\b).)*?</w:p>", doc, re.S):
        if text in text_of(m.group(0)):
            return m.group(0)
    raise AssertionError(f"no paragraph containing {text!r}")


def test_continuation_div_is_not_numbered():
    blocks = [{"t": "Div", "c": [["", ["continuation"], []],
                                 [b.Para([b.Str("12."), {"t": "Space"}, b.Str("percent")])]]}]
    stats = b.transform_body(blocks, None)
    assert stats["numbered"] == 0
    paras = []

    def collect(x):
        if isinstance(x, dict):
            if x.get("t") == "Para":
                paras.append(b.stringify(x["c"]))
            for v in x.values():
                collect(v)
        elif isinstance(x, list):
            for v in x:
                collect(v)
    collect(blocks)
    assert paras == ["12. percent"]


@needs_pandoc
def test_continuation_paragraph_flush_left(extra):
    doc = extra["doc"]
    for text in ("The framework then lists the indicia it weighs.",
                 "12. percent of the vote, it adds, is not enough by itself."):
        p = _para_xml(doc, text)
        assert re.search(r'<w:pStyle w:val="BodyText"\s*/>', p), p[:300]
        assert has(p, '<w:ind w:firstLine="0"/>'), p[:300]
        assert text_of(p).startswith(text[:12])  # no number+tab
    assert "12.\tpercent" not in text_of(doc)
    assert re.search(r"<w:footnoteReference", _para_xml(doc, "The framework then lists"))
    # the paragraph after the continuation is numbered as usual; the block quote stays Block Text
    assert re.search(r'<w:pStyle w:val="BlockText"\s*/>', _para_xml(doc, "whatever label the issuer uses"))
    assert "8.\tA treatise agrees." in text_of(doc)
    assert "Numbered paragraphs: 8" in extra["res"].stdout
    assert "Continuation" not in extra["doc"] and "Continuation" not in member(extra["out"], "word/styles.xml")


# --------------------------------------------------------------------------- legacy-shaped bib
# fixtures/sample/references/sources.bib carries each legacy-shaped entry beside its clean twin.

TWINS = ["case", "wl", "hrep", "release", "cfr", "usc", "expert", "memo", "memo2", "expert2"]
FIRST_PINS = {"case": ", at 205", "wl": ", at *3", "hrep": ", at 13-14", "release": ", at *2",
              "cfr": ", (d)(1)", "usc": "", "expert": ", at 4 ¶ 8", "memo": ", at 2", "memo2": "", "expert2": ", at 38 ¶ 75"}
LATER_PINS = {"case": ", at 207", "wl": ", at *4", "hrep": ", at 14", "release": ", at *5",
              "cfr": ", (e)", "usc": ", (a)", "expert": ", at 6 ¶ 10", "memo": ", at 3", "memo2": ", at 4", "expert2": ", at 40"}

CLEAN_NOTES = [
    "Brown v. Green, 50 F.3d 200, 205 (3d Cir. 1995).",
    "In re Delta Gadget Co. Litigation, C.A. No. 2020-0456-XYZ, 2020 WL 7654321, at *3 "
    "(Del. Ch. Dec. 29, 2020).",
    "H.R. Rep. No. 73-85, at 13–14 (1933).",
    "Proposed Rule on Example Resales, Securities Act Release No. 33-9999, 2001 WL 111111, at *2 "
    "(Mar. 1, 2001) [hereinafter Example Release].",
    "17 C.F.R. § 230.144(d)(1) (2026).",
    "15 U.S.C. § 78t (2026).",
    "Expert Report of Professor Richard Roe in Doe v. Sample Corp., No. 1:25-cv-00123-ABC "
    "(D. Del. Sept. 1, 2025), at 4 ¶ 8 [hereinafter Roe Sample Report].",
    "Example & Partners LLP, Control Under the Securities Laws, Client Alert No. 4455, at 2 "
    "(Feb. 21, 2024).",
    "Smith & Partners LLP, Resale Basics (Apr. 12, 2023) [hereinafter Resale Basics].",
    # no shorttitle: the date still precedes the pin, as for a report with one
    "Expert Report of Professor Richard Roe in Roe v. Sample LLC, C.A. No. 2022-0777-ABC "
    "(May 2, 2022), at 38 ¶ 75.",
    "Brown, 50 F.3d at 207.",
    "Delta Gadget, 2020 WL 7654321, at *4.",
    "H.R. Rep. No. 73-85, at 14 (1933).",
    "Example Release, supra note 4, at *5.",
    "17 C.F.R. § 230.144(e) (2026).",
    "15 U.S.C. § 78t(a) (2026).",
    "Roe Sample Report, supra note 7, at 6 ¶ 10.",
    "Example & Partners LLP, Control Under the Securities Laws, Client Alert No. 4455, at 3 "
    "(Feb. 21, 2024).",  # no shorttitle: a memo repeats in full
    "Resale Basics, supra note 9, at 4.",
    "Expert Report of Professor Richard Roe in Roe v. Sample LLC, C.A. No. 2022-0777-ABC "
    "(May 2, 2022), at 40.",
]
CLEAN_NOTES = [nbsp_sections(n) for n in CLEAN_NOTES]


def _twin_draft(prefix: str) -> str:
    lines = ["# I. AUTHORITIES.", ""]
    notes = []
    for n, (tw, pins) in enumerate([(t, FIRST_PINS) for t in TWINS] + [(t, LATER_PINS) for t in TWINS]):
        lines.append(f"{n + 1}\\. Point {n + 1}.[^n{n}]\n")
        notes.append(f"[^n{n}]: [@{prefix}{tw}{pins[tw]}].\n")
    return "\n".join(lines + notes)


def _build_twins(tmp: Path, prefix: str) -> dict:
    proj = tmp / prefix
    shutil.copytree(FIXTURE, proj)
    for d in (proj / "drafts").glob("*.md"):
        d.unlink()
    (proj / "drafts" / "Part I. Authorities (Draft).md").write_text(_twin_draft(prefix))
    out = tmp / f"{prefix}.docx"
    res = run_build("--output", str(out), project=proj)
    assert res.returncode == 0, f"build failed\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    return {"res": res, "fn": member(out, "word/footnotes.xml")}


@pytest.fixture(scope="module")
def twins(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("twins")
    return {p: _build_twins(tmp, p) for p in ("clean", "legacy")}


@needs_pandoc
@pytest.mark.parametrize("i", range(len(CLEAN_NOTES)))
def test_clean_twin_rendering(twins, i):
    assert footnote_texts(twins["clean"]["fn"])[i] == CLEAN_NOTES[i]


@needs_pandoc
@pytest.mark.parametrize("i", range(len(CLEAN_NOTES)))
def test_legacy_shape_renders_like_clean_twin(twins, i):
    """@misc types, reporter, author, howpublished, organization and captioned titles still render."""
    assert footnote_texts(twins["legacy"]["fn"])[i] == footnote_texts(twins["clean"]["fn"])[i]


@needs_pandoc
def test_legacy_shape_same_ooxml_as_clean_twin(twins):
    """Same runs, so the same italics and small caps, not just the same words."""
    assert twins["legacy"]["fn"] == twins["clean"]["fn"]
    for leak in ("Must never print", "internal", "Committee", "Legal Information Institute",
                 "Securities and Exchange Commission", "current through", "Client alert", "aff"):
        assert leak not in text_of(twins["legacy"]["fn"])


def test_bib_fields_reads_legacy_fields():
    raw = b.bib_fields('@misc{k, reporter = {A.3d}, howpublished = "Client {A}lert",\n'
                       '  organization = {Smith \\& Co.}, title={{T}}}\n@comment{x}\n'
                       '@jurisdiction{j,\n institution={Del. Ch.}, volume = 52 }')
    assert raw["k"]["_type"] == "misc" and raw["j"]["_type"] == "jurisdiction"
    assert raw["k"]["reporter"] == "A.3d"
    assert raw["k"]["organization"] == "Smith \\& Co."
    assert raw["j"]["institution"] == "Del. Ch." and raw["j"]["volume"] == "52"


def _norm(item: dict, raw: dict) -> dict:
    return b.normalize_csl([item], {item["id"]: raw})[0]


def test_normalize_prefers_additive_fields():
    case = _norm({"id": "c", "type": "legal_case", "title": "A v. B", "volume": "9",
                  "container-title": "F.2d", "page": "1", "publisher": "2d Cir."},
                 {"_type": "jurisdiction", "reporter": "F.3d", "institution": "2d Cir."})
    assert case["container-title"] == "F.2d"  # journaltitle beats reporter
    memo = _norm({"id": "m", "type": "", "author": [{"literal": "Firm LLP"}], "title": "T",
                  "genre": "Client Alert", "number": "7", "publisher": "Legacy label"},
                 {"_type": "misc", "type": "Client Alert", "number": "7", "howpublished": "Legacy label"})
    assert memo["type"] == "report" and memo["genre"] == "Client Alert" and memo["number"] == "7"
    assert "publisher" not in memo  # howpublished never prints once type is set


def test_normalize_drops_note_and_annote():
    item = _norm({"id": "x", "type": "", "title": "T", "note": "n", "annote": "a"}, {"_type": "misc"})
    assert "note" not in item and "annote" not in item


def test_normalize_never_mines_note_for_a_reporter():
    """No reporter lookup: a cite sitting in `note` (often subsequent history, which shares the
    caption) is never attached to the entry, whatever its date or court."""
    item = _norm({"id": "k", "type": "legal_case", "title": "In re Sample Co. Litigation",
                  "number": "C.A. No. 2021-0001-ABC", "publisher": "Del. Ch.",
                  "issued": {"date-parts": [[2021, 12, 15]]},
                  "note": "2021 WL 999, aff'd, 282 A.3d 1054 (Del. 2022) (table)"},
                 {"_type": "jurisdiction", "institution": "Del. Ch."})
    for f in ("volume", "container-title", "page", "note"):
        assert f not in item
    assert item["number"] == "C.A. No. 2021-0001-ABC"


def test_normalize_reported_case_drops_docket_unreported_keeps_it():
    rep = _norm({"id": "r", "type": "legal_case", "title": "A v. B", "volume": "52",
                 "container-title": "A.3d", "page": "761", "number": "C.A. No. 961", "publisher": "Del. Ch."},
                {"_type": "jurisdiction", "institution": "Del. Ch."})
    assert "number" not in rep
    wl = _norm({"id": "w", "type": "legal_case", "title": "A v. B", "volume": "2020",
                "container-title": "WL", "page": "1", "number": "C.A. No. 961", "publisher": "Del. Ch."},
               {"_type": "jurisdiction", "institution": "Del. Ch."})
    assert wl["number"] == "C.A. No. 961"


# --------------------------------------------------------------------------- metadata: always stripped
# Owner's rule: every built .docx and its Word PDF carry no identifying or stale properties.

STRIP_SCRIPT = SCRIPTS / "strip_metadata.py"
CORE_FIELDS = ("dc:title", "dc:creator", "cp:lastModifiedBy", "cp:keywords", "dc:subject",
               "dc:description", "cp:revision", "dcterms:created", "dcterms:modified",
               "cp:category", "cp:contentStatus", "cp:lastPrinted", "cp:version",
               "dc:identifier", "dc:language")
APP_FORBIDDEN = ("Words", "Pages", "Lines", "Paragraphs", "Characters", "CharactersWithSpaces",
                 "TotalTime", "Template", "Company", "Manager", "HyperlinkBase",
                 # stale: pandoc's reference.docx claims Word 12 wrote the file
                 "Application", "AppVersion")
CUSTOM_REL = "relationships/custom-properties"


def assert_no_metadata(docx: Path) -> None:
    with zipfile.ZipFile(docx) as z:
        names = z.namelist()
        get = lambda n: z.read(n).decode("utf-8") if n in names else ""  # noqa: E731
        core, app, rels, ct = get("docProps/core.xml"), get("docProps/app.xml"), get("_rels/.rels"), \
            get("[Content_Types].xml")
        settings = get("word/settings.xml")
        word_parts = {n: get(n) for n in names if n.startswith("word/") and n.endswith(".xml")}
        dates = {i.date_time for i in z.infolist()}
    for f in CORE_FIELDS:
        m = re.search(r"<%s\b[^>]*?(?:/>|>(.*?)</%s>)" % (f, f), core, re.S)
        assert m is None or not (m.group(1) or "").strip(), f"core.xml {f} = {m.group(1)!r}"
    for f in APP_FORBIDDEN:
        assert not re.search(r"<%s\b" % f, app), f"app.xml carries <{f}>"
    assert "docProps/custom.xml" not in names
    assert CUSTOM_REL not in rels and "custom.xml" not in rels
    assert "/docProps/custom.xml" not in ct
    assert "word/people.xml" not in names and "people.xml" not in ct
    assert not [n for n in names if n.startswith("docProps/thumbnail")]
    for tag in ("w:rsids", "w:rsidRoot", "w:attachedTemplate", "w14:docId", "w15:docId"):
        assert f"<{tag}" not in settings, f"settings.xml carries {tag}"
    for n, xml in word_parts.items():
        assert not re.search(r'\bw:rsid\w*="', xml), f"{n} carries rsid attributes"
        assert not re.search(r'\bw:(?:author|initials|date)="[^"]+"', xml), f"{n} carries an author/date"
    # zip entry timestamps are dates too: the ZIP epoch, i.e. no date
    assert dates == {(1980, 1, 1, 0, 0, 0)}, dates


def test_shipped_template_carries_no_metadata():
    assert_no_metadata(make_template.DEFAULT_OUT)


def test_generated_template_carries_no_metadata(tmp_path):
    assert_no_metadata(make_template.build(tmp_path / "t.docx"))


@needs_pandoc
def test_build_strips_metadata(built):
    """pandoc writes today's created/modified, the reference doc's Word 12 statistics, and a
    custom.xml holding the local bib and CSL paths; none of it survives the build."""
    assert_no_metadata(built["out"])
    line = [ln for ln in built["res"].stdout.splitlines() if ln.startswith("Metadata stripped:")]
    assert len(line) == 1, built["res"].stdout
    # app.xml comes from the template, already clean; pandoc writes core.xml and custom.xml anew
    for name in ("docProps/custom.xml", "dcterms:created", "dcterms:modified"):
        assert name in line[0], line[0]


def _strip():
    spec = importlib.util.spec_from_file_location("expert_report_strip_metadata", STRIP_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_strip_ooxml_pure():
    core = ('<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/'
            'package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            '<dc:title>Secret Title</dc:title><dc:creator>A. Person</dc:creator>'
            '<cp:lastModifiedBy>A. Person</cp:lastModifiedBy><cp:revision>7</cp:revision>'
            '<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-10T16:06:54Z</dcterms:created>'
            '</cp:coreProperties>')
    app = ('<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/'
           '2006/extended-properties"><Words>83</Words><Template>Normal.dotm</Template>'
           '<Company>Firm LLP</Company><DocSecurity>0</DocSecurity></Properties>')
    parts = {
        "[Content_Types].xml": b'<Types><Override PartName="/docProps/custom.xml" ContentType="x"/>'
                               b'<Override PartName="/word/people.xml" ContentType="y"/></Types>',
        "_rels/.rels": b'<Relationships><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/'
                       b'officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>'
                       b'</Relationships>',
        "docProps/core.xml": core.encode(), "docProps/app.xml": app.encode(),
        "docProps/custom.xml": b"<Properties/>",
        "word/people.xml": b"<w15:people/>",
        "word/_rels/document.xml.rels": b'<Relationships><Relationship Id="rId9" Type="http://schemas.'
                                        b'microsoft.com/office/2011/relationships/people" Target="people.xml"/>'
                                        b'</Relationships>',
        "word/settings.xml": b'<w:settings><w:attachedTemplate r:id="rId1"/><w:rsids><w:rsidRoot w:val="00164A67"/>'
                             b'<w:rsid w:val="00164A67"/></w:rsids><w15:docId w15:val="{AB}"/>'
                             b'<w:defaultTabStop w:val="720"/></w:settings>',
        "word/document.xml": b'<w:p w:rsidR="00164A67"><w:ins w:id="1" w:author="A. Person" '
                             b'w:date="2026-11-10T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins></w:p>',
    }
    stripped = _strip().strip_ooxml(parts)
    for want in ("dc:title", "dc:creator", "cp:lastModifiedBy", "cp:revision", "dcterms:created",
                 "Words", "Template", "Company", "docProps/custom.xml", "word/people.xml",
                 "w:rsids", "w:attachedTemplate", "w15:docId", "rsid attributes", "w:author", "w:date"):
        assert any(want in s for s in stripped), (want, stripped)
    assert "Secret Title" not in parts["docProps/core.xml"].decode()
    assert "A. Person" not in b"".join(parts.values()).decode()
    assert "<DocSecurity>0</DocSecurity>" in parts["docProps/app.xml"].decode()
    assert "docProps/custom.xml" not in parts and "word/people.xml" not in parts
    assert b"custom" not in parts["_rels/.rels"] and b"people" not in parts["[Content_Types].xml"]
    assert b"people" not in parts["word/_rels/document.xml.rels"]
    assert b'<w:defaultTabStop w:val="720"/>' in parts["word/settings.xml"]


def tiny_pdf_with_info(path: Path, producer: str = WORD_PRODUCER, text: str = "x") -> Path:
    """tiny_pdf plus the identifying Info fields Word writes and an XMP packet."""
    tiny_pdf(path, producer, text=text)
    code = (
        "import pikepdf, sys\n"
        "p = pikepdf.open(sys.argv[1], allow_overwriting_input=True)\n"
        "for k, v in (('/Title', 'Secret Title'), ('/Author', 'word'), ('/Subject', 'Subj'),"
        " ('/Keywords', 'kw'), ('/CreationDate', 'D:20261110130813'), ('/ModDate', 'D:20261110130813')):\n"
        "    p.docinfo[k] = v\n"
        "with p.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as m:\n"
        "    m['dc:creator'] = ['word']; m['dc:title'] = 'Secret Title'; m['pdf:Keywords'] = 'kw'\n"
        "    m['pdf:Producer'] = sys.argv[2]; m['xmp:CreatorTool'] = sys.argv[2]\n"
        "    m['xmp:CreateDate'] = '2026-11-10T13:08:13-05:00'\n"
        "p.save(sys.argv[1])\n")
    res = subprocess.run(["uv", "run", "--quiet", "--no-project", "--with", "pikepdf", "python3", "-I",
                          "-c", code, str(path), producer], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    return path


def pdf_metadata(pdf: Path) -> tuple[dict, str]:
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    fields = dict(re.findall(r"^(\w+):\s*(.*?)\s*$", info, re.M))
    xmp = subprocess.run(["pdfinfo", "-meta", str(pdf)], capture_output=True, text=True).stdout
    return fields, xmp


def assert_pdf_clean(pdf: Path) -> None:
    fields, xmp = pdf_metadata(pdf)
    for f in ("Title", "Author", "Subject", "Keywords", "CreationDate", "ModDate"):
        assert not fields.get(f), f"pdfinfo {f}: {fields.get(f)!r}"
    for tag in ("dc:creator", "dc:title", "pdf:Keywords", "dc:description", "dc:subject",
                "xmpMM:DocumentID", "xmpMM:InstanceID", "xmp:CreateDate", "xmp:ModifyDate"):
        assert f"<{tag}" not in xmp, f"XMP carries {tag}"
    assert "Microsoft" in fields.get("Producer", "") and "Word" in fields.get("Producer", "")
    assert "Word" in fields.get("Creator", "")



@needs_poppler
@needs_uv
def test_strip_pdf_keeps_producer_and_creator(tmp_path):
    pdf = tiny_pdf_with_info(tmp_path / "w.pdf")
    assert pdf_metadata(pdf)[0].get("Author") == "word"
    res = subprocess.run(["uv", "run", "--quiet", "--script", str(STRIP_SCRIPT), str(pdf)],
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    assert "Author" in res.stdout and "dc:creator" in res.stdout
    assert_pdf_clean(pdf)
    assert "Microsoft" in b.check_word_pdf(pdf)  # the Producer check still passes after stripping


@needs_pandoc
@needs_poppler
@needs_uv
def test_pdf_build_strips_before_producer_check(tmp_path, monkeypatch):
    class FakeDocRender:
        @staticmethod
        def convert(src, dst, **kw):
            words = " ".join(sorted(b._words(b.docx_text(member(Path(src), "word/document.xml"))
                                             + " " + b.docx_text(member(Path(src), "word/footnotes.xml")))))
            tiny_pdf_with_info(Path(dst), text=words)
            return Path(dst)
    monkeypatch.setattr(b, "_doc_render", lambda: FakeDocRender)
    b.build(FIXTURE, tmp_path / "r.docx", pdf=True)
    assert_pdf_clean(tmp_path / "r.pdf")
    assert_no_metadata(tmp_path / "r.docx")


# --------------------------------------------------------------------------- Word-render template fixes

@needs_pandoc
def test_separator_runs_set_in_calibri(built):
    """Word draws the separator rule 0.60 pt under a Times New Roman run, 0.72 pt (served) under
    Calibri, the served theme default: rFonts Calibri on the two separator runs only."""
    fn = built["fn"]
    for typ in ("separator", "continuationSeparator"):
        note = re.search(r'<w:footnote w:type="%s".*?</w:footnote>' % typ, fn, re.S).group(0)
        rpr = re.search(r"<w:r><w:rPr>(.*?)</w:rPr><w:%s\s*/>" % typ, note, re.S)
        assert rpr and has(rpr.group(1), '<w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" '
                                          'w:hAnsi="Calibri" w:cs="Calibri"/>'), note
    real = re.sub(r'<w:footnote w:type=.*?</w:footnote>', "", fn, flags=re.S)
    assert "Calibri" not in real and "Calibri" not in built["doc"]


def test_nbsp_after_section_sign_pure():
    xml = ('<w:r><w:t xml:space="preserve">15 U.S.C. § 77o and §§ 77a–77c, see</w:t></w:r>'
           '<w:r><w:t xml:space="preserve">text, §</w:t></w:r><w:r><w:rPr><w:i/></w:rPr>'
           '<w:t xml:space="preserve"> 144 more</w:t></w:r>')
    out = b.nbsp_sections(xml)
    assert text_of(out) == "15 U.S.C. §\u00a077o and §§\u00a077a–77c, seetext, §\u00a0144 more"


@needs_pandoc
def test_no_breakable_space_after_section_sign(built, extra):
    for xml in (built["doc"], built["fn"], extra["doc"], extra["fn"]):
        assert not re.search(r"§ ", text_of(xml)), re.findall(r".{20}§ .{10}", text_of(xml))
    assert "15 U.S.C. §\u00a077o" in text_of(built["fn"])
    assert "subsection, §\u00a0144(d)(1), and §§\u00a0145–146 read" in text_of(extra["doc"])  # body
