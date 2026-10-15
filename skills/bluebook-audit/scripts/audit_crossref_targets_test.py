"""Contract tests for audit_crossref_targets.py.

Only the offline paths are covered: mechanical audit, --grep, --remap, --apply and
the report. --gemini/--batch need Vertex credentials and are not exercised.
"""
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_crossref_targets as ac  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "audit_crossref_targets.py"
W = ac.W
NS = f'xmlns:w="{W}"'


def noteref(bm):
    return (f'<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            f'<w:r><w:instrText xml:space="preserve"> NOTEREF {bm} \\h </w:instrText></w:r>'
            f'<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r>'
            f'<w:r><w:fldChar w:fldCharType="end"/></w:r>')


def fn(fid, *parts):
    """parts: plain strings, or ('ref', bookmark) tuples."""
    inner = "".join(noteref(p[1]) if isinstance(p, tuple) else f"<w:r><w:t>{p}</w:t></w:r>"
                    for p in parts)
    return f'<w:footnote w:id="{fid}"><w:p>{inner}</w:p></w:footnote>'


def body_para(bm, bid, fid):
    return (f'<w:p><w:bookmarkStart w:id="{bid}" w:name="{bm}"/><w:r>'
            f'<w:footnoteReference w:id="{fid}"/></w:r><w:bookmarkEnd w:id="{bid}"/></w:p>')


def build(path, footnotes, body=None):
    body = body if body is not None else body_para("_Ref_fn1", 1, 1) + body_para("_Ref_fn2", 2, 2)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", f"<w:document {NS}><w:body>{body}</w:body></w:document>")
        z.writestr("word/footnotes.xml", f"<w:footnotes {NS}>{''.join(footnotes)}</w:footnotes>")
    return str(path)


def parse(path):
    return ac.load_docx_xml(str(path))


@pytest.fixture
def wrong_target_docx(tmp_path):
    # fn3 says "Smith, supra note" but points at fn2 (Jones); fn1 is Smith.
    return build(tmp_path / "a.docx", [
        fn(1, "Smith, Corporate Voting, 5 Yale L.J. 10."),
        fn(2, "Jones, Proxy Advisors, 7 Harv. L. Rev. 2."),
        fn(3, "Smith, supra note ", ("ref", "_Ref_fn2"), "."),
    ])


def test_paragraph_text_replaces_noteref_with_placeholder():
    p = etree.fromstring(f'<w:p {NS}>{"<w:r><w:t>Smith, supra note </w:t></w:r>"}'
                         f'{noteref("_Ref_fn12")}</w:p>')
    assert ac.paragraph_text_with_refs(p) == "Smith, supra note {{REF:_Ref_fn12}}"


def test_bookmark_map_resolves_fn_ids(wrong_target_docx):
    doc, _ = parse(wrong_target_docx)
    assert ac.build_bookmark_to_fnid(doc) == {"_Ref_fn1": 1, "_Ref_fn2": 2}


def test_audit_flags_surname_mismatch(wrong_target_docx):
    doc, fns = parse(wrong_target_docx)
    findings = ac.audit_references(doc, fns)
    assert len(findings) == 1
    f = findings[0]
    assert (f["source"], f["kind"], f["surnames_raw"], f["bookmark"], f["target_fn"]) == \
        ("fn3", "supra", "Smith", "_Ref_fn2", 2)
    suspicious = ac.mark_suspicion(findings)
    assert suspicious == findings
    assert f["status"] == "surname_mismatch"
    assert f["missing_surnames"] == ["Smith"] and f["matched_surnames"] == []


def test_audit_ok_when_target_matches(tmp_path):
    path = build(tmp_path / "ok.docx", [
        fn(1, "Smith, Corporate Voting."), fn(2, "Jones, Other."),
        fn(3, "Smith, supra note ", ("ref", "_Ref_fn1"), "."),
    ])
    doc, fns = parse(path)
    findings = ac.audit_references(doc, fns)
    assert ac.mark_suspicion(findings) == []
    assert findings[0]["status"] == "ok"


def test_unresolved_bookmark_is_suspicious(tmp_path):
    path = build(tmp_path / "u.docx", [
        fn(1, "Smith, X."), fn(3, "Smith, supra note ", ("ref", "_Ref_fn99"), ".")])
    doc, fns = parse(path)
    findings = ac.audit_references(doc, fns)
    assert findings[0]["status"] == "unresolved_bookmark"
    assert findings[0]["target_fn"] is None
    assert ac.mark_suspicion(findings) == findings
    assert findings[0]["status"] == "unresolved_bookmark"


def test_signal_only_name_has_no_surname_tokens(tmp_path):
    f = {"surnames_raw": "See", "target_lead": "Smith, X."}
    assert ac.mark_suspicion([f]) == []
    assert f["status"] == "no_surname_tokens"


def test_extract_name_tokens_strips_signals_and_trims_prose():
    assert ac._extract_name_tokens("See also Hu, Malenko & Zytnick") == ["Hu", "Malenko", "Zytnick"]
    assert ac._extract_name_tokens("These are consistent with Choi, Fisch & Kahan") == \
        ["Choi", "Fisch", "Kahan"]


def test_grep_first_cite_unique_ambiguous_none(tmp_path):
    path = build(tmp_path / "g.docx", [
        fn(1, "Smith, Voting."), fn(2, "Jones, Proxy; see also Brown, Law."),
        fn(3, "Brown, Other Work."), fn(4, "Smith, supra note 1."),
        fn(5, "Jones, supra note ", ("ref", "_Ref_fn2"), "."),
    ])
    _, fns = parse(path)
    assert ac.grep_first_cite("Smith", fns, source_fn=5) == (1, "unique")
    assert ac.grep_first_cite("Brown", fns, source_fn=5) == (2, "ambiguous")
    assert ac.grep_first_cite("Nobody", fns, source_fn=5) == (0, "no_match")
    assert ac.grep_first_cite("See", fns, source_fn=5) == (0, "no_tokens")


def test_grep_ignores_the_source_footnote_itself(tmp_path):
    path = build(tmp_path / "g.docx", [fn(1, "Smith, Voting.")])
    _, fns = parse(path)
    assert ac.grep_first_cite("Smith", fns, source_fn=1) == (0, "no_match")


def test_ensure_bookmark_creates_once_and_reuses(wrong_target_docx):
    doc, _ = parse(wrong_target_docx)
    ids = [ac.max_bookmark_id(doc) + 1]
    assert ids == [3]
    assert ac.ensure_bookmark_for_fn(doc, 1, ids) == "_Ref_corrfn1"
    assert ids == [4]
    assert ac.ensure_bookmark_for_fn(doc, 1, ids) == "_Ref_corrfn1"
    assert ids == [4]
    assert ac.ensure_bookmark_for_fn(doc, 77, ids) is None


def test_apply_remap_rewrites_instr_and_reports_skips(wrong_target_docx):
    doc, fns = parse(wrong_target_docx)
    remap = {(3, "Smith", "_Ref_fn2"): 1, (3, "Smith", "_Ref_fn5"): 0, (42, "Smith", "_Ref_fn2"): 1}
    applied, skipped = ac.apply_remap_per_ref(doc, fns, remap)
    assert applied == 1
    assert skipped == ["fn3 'Smith': no target", "fn42 'Smith': source not found"]
    instrs = [i.text for i in fns.iter(f"{{{W}}}instrText")]
    assert instrs == [" NOTEREF _Ref_corrfn1 \\h "]


def test_apply_remap_skips_when_noteref_absent(wrong_target_docx):
    doc, fns = parse(wrong_target_docx)
    applied, skipped = ac.apply_remap_per_ref(doc, fns, {(3, "Smith", "_Ref_fn8"): 1})
    assert applied == 0
    assert skipped == ["fn3 'Smith': NOTEREF for _Ref_fn8 not found in paragraph"]


def cli(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, text=True)


def test_cli_audit_only_writes_json_and_report(wrong_target_docx, tmp_path):
    out = tmp_path / "out"
    p = cli("--docx", wrong_target_docx, "--out", out)
    assert p.returncode == 0, p.stderr
    assert "Scanned 1 cross-references — 1 suspicious" in p.stdout
    data = json.loads((out / "crossref_audit.json").read_text())
    assert data[0]["status"] == "surname_mismatch"
    report = (out / "CROSSREF_AUDIT.md").read_text()
    assert "- Total cross-references scanned: **1**" in report
    assert "### fn3 → _Ref_fn2 (supra)" in report
    assert "- Surnames written: `Smith`" in report


def test_cli_grep_apply_retargets_docx(wrong_target_docx, tmp_path):
    out = tmp_path / "out"
    p = cli("--docx", wrong_target_docx, "--out", out, "--grep", "--apply")
    assert p.returncode == 0, p.stderr
    assert "--grep results: {'unique': 1}" in p.stdout
    assert "Applied: 1 NOTEREF rewires" in p.stdout
    _, fns = ac.load_docx_xml(wrong_target_docx)
    assert [i.text for i in fns.iter(f"{{{W}}}instrText")] == [" NOTEREF _Ref_corrfn1 \\h "]
    # re-audit: the rewired ref now resolves to the Smith footnote
    out2 = tmp_path / "out2"
    p2 = cli("--docx", wrong_target_docx, "--out", out2)
    assert "1 cross-references — 0 suspicious" in p2.stdout


def test_cli_remap_file_apply(wrong_target_docx, tmp_path):
    remap = tmp_path / "r.json"
    remap.write_text(json.dumps({"remap": {json.dumps([3, "Smith", "_Ref_fn2"]): 1}}))
    p = cli("--docx", wrong_target_docx, "--out", tmp_path / "o", "--remap", remap, "--apply")
    assert p.returncode == 0, p.stderr
    assert "Applied: 1 NOTEREF rewires" in p.stdout


def test_cli_apply_without_remap_exits_with_message(wrong_target_docx, tmp_path):
    p = cli("--docx", wrong_target_docx, "--out", tmp_path / "o", "--apply")
    assert p.returncode == 1
    assert "--apply requires --gemini, --batch, or --remap" in p.stderr


def test_cli_missing_docx_arg():
    p = cli()
    assert p.returncode == 2 and "--docx" in p.stderr
