# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "lxml"]
# ///
"""Contract tests for apply_corrections.py (journal small-caps run splitting)."""
import subprocess
import sys
import zipfile
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_corrections as ac  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "apply_corrections.py"
W = ac.W
NS = f'xmlns:w="{W}"'


def fn_xml(*notes):
    """notes: (id, [run_text, ...]) pairs; id 0 and -1 are separators."""
    body = ""
    for fid, runs in notes:
        rs = "".join(f"<w:r><w:t>{t}</w:t></w:r>" for t in runs)
        body += f'<w:footnote w:id="{fid}"><w:p>{rs}</w:p></w:footnote>'
    return f'<w:footnotes {NS}>{body}</w:footnotes>'


def make_docx(path, footnotes):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", f"<w:document {NS}/>")
        z.writestr("word/footnotes.xml", footnotes)
    return path


def runs_of(root, fid):
    fn = [f for f in root.iter(f"{{{W}}}footnote") if f.get(f"{{{W}}}id") == str(fid)][0]
    out = []
    for r in fn.iter(f"{{{W}}}r"):
        t = "".join(x.text or "" for x in r.iter(f"{{{W}}}t"))
        out.append((t, r.find(f"{{{W}}}rPr/{{{W}}}smallCaps") is not None))
    return out


def read_fn(path):
    with zipfile.ZipFile(path) as z:
        return etree.fromstring(z.read("word/footnotes.xml"))


def test_splits_run_into_prefix_smallcaps_suffix():
    root = etree.fromstring(fn_xml((1, ["See Smith, 5 Yale L.J. 10 (2020)."])))
    details = ac.apply_journal_smallcaps(root)
    assert details == [(1, "Yale L.J.")]
    assert runs_of(root, 1) == [
        ("See Smith, 5 ", False),
        ("Yale L.J.", True),
        (" 10 (2020).", False),
    ]


def test_separator_footnotes_skipped():
    root = etree.fromstring(fn_xml((0, ["Yale L.J."]), (-1, ["Yale L.J."])))
    assert ac.apply_journal_smallcaps(root) == []


def test_already_smallcaps_run_not_reapplied():
    xml = (f'<w:footnotes {NS}><w:footnote w:id="1"><w:p><w:r><w:rPr><w:smallCaps/></w:rPr>'
           f'<w:t>Yale L.J.</w:t></w:r></w:p></w:footnote></w:footnotes>')
    root = etree.fromstring(xml)
    assert ac.apply_journal_smallcaps(root) == []


def test_footnote_ref_run_skipped():
    xml = (f'<w:footnotes {NS}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/>'
           f'<w:t>Yale L.J.</w:t></w:r></w:p></w:footnote></w:footnotes>')
    assert ac.apply_journal_smallcaps(etree.fromstring(xml)) == []


def test_rpr_cloned_onto_split_runs():
    xml = (f'<w:footnotes {NS}><w:footnote w:id="1"><w:p><w:r><w:rPr><w:i/></w:rPr>'
           f'<w:t>a Yale L.J. b</w:t></w:r></w:p></w:footnote></w:footnotes>')
    root = etree.fromstring(xml)
    ac.apply_journal_smallcaps(root)
    for r in root.iter(f"{{{W}}}r"):
        assert r.find(f"{{{W}}}rPr/{{{W}}}i") is not None


def test_multiple_occurrences_in_one_footnote():
    root = etree.fromstring(fn_xml((1, ["Yale L.J. and also Yale L.J."])))
    details = ac.apply_journal_smallcaps(root)
    assert details == [(1, "Yale L.J.")] * 2
    assert [t for t, sc in runs_of(root, 1) if sc] == ["Yale L.J.", "Yale L.J."]


def test_nbsp_variant_matches_and_keeps_original_text():
    root = etree.fromstring(fn_xml((1, ["x Harv.\xa0L.\xa0Rev. y"])))
    ac.apply_journal_smallcaps(root)
    assert ("Harv.\xa0L.\xa0Rev.", True) in runs_of(root, 1)


def test_longer_name_wins_over_shorter_prefix():
    root = etree.fromstring(fn_xml((1, ["12 J. Fin. Econ. 3"])))
    details = ac.apply_journal_smallcaps(root)
    assert details == [(1, "J. Fin. Econ.")]


def test_j_fin_guard_only_blocks_econ_with_period():
    # The guard looks for "Econ." with the period, so "Economics" is not blocked.
    root = etree.fromstring(fn_xml((1, ["J. Fin. Economics note"])))
    assert ac.apply_journal_smallcaps(root) == [(1, "J. Fin.")]


def test_ambiguous_name_needs_paren_or_comma():
    hit = etree.fromstring(fn_xml((1, ["Fortune, Jan. 2020"])))
    assert ac.apply_journal_smallcaps(hit) == [(1, "Fortune")]
    miss = etree.fromstring(fn_xml((1, ["Fortune favors the bold"])))
    assert ac.apply_journal_smallcaps(miss) == []


def test_institutional_inv_not_matched_inside_investors():
    root = etree.fromstring(fn_xml((1, ["Institutional Inv.estors"])))
    assert ac.apply_journal_smallcaps(root) == []
    root = etree.fromstring(fn_xml((1, ["Institutional Inv. (2020)"])))
    assert ac.apply_journal_smallcaps(root) == [(1, "Institutional Inv.")]


def test_find_name_in_run_absent():
    assert ac.find_name_in_run("nothing here", "Yale L.J.") is None


def test_cli_rewrites_output_and_preserves_other_parts(tmp_path):
    src = make_docx(tmp_path / "in.docx", fn_xml((1, ["See 5 Yale L.J. 10."])))
    out = tmp_path / "out.docx"
    p = subprocess.run([sys.executable, str(SCRIPT), "--docx", str(src), "--output", str(out)],
                       capture_output=True, text=True)
    assert p.returncode == 0
    assert "FN 1: Yale L.J. -> small caps" in p.stdout
    assert "Applied 1 formatting corrections" in p.stdout
    assert "  smallcaps: 1" in p.stdout
    assert [t for t, sc in runs_of(read_fn(out), 1) if sc] == ["Yale L.J."]
    with zipfile.ZipFile(out) as z:
        assert z.read("word/document.xml") == f"<w:document {NS}/>".encode()
    # input untouched when --output given
    assert [sc for _, sc in runs_of(read_fn(src), 1)] == [False]
    assert not list(tmp_path.glob("*.tmp.docx"))


def test_cli_overwrites_input_by_default(tmp_path):
    src = make_docx(tmp_path / "in.docx", fn_xml((1, ["5 Yale L.J. 10"])))
    subprocess.run([sys.executable, str(SCRIPT), "--docx", str(src)], check=True,
                   capture_output=True)
    assert any(sc for _, sc in runs_of(read_fn(src), 1))


def test_cli_no_changes_leaves_file_byte_identical(tmp_path):
    src = make_docx(tmp_path / "in.docx", fn_xml((1, ["plain text"])))
    before = src.read_bytes()
    p = subprocess.run([sys.executable, str(SCRIPT), "--docx", str(src)],
                       capture_output=True, text=True)
    assert p.returncode == 0
    assert "Applied 0 formatting corrections" in p.stdout
    assert "No changes needed." in p.stdout
    assert src.read_bytes() == before


def test_cli_missing_file_prints_error_and_exits_zero(tmp_path):
    # Surprising but current behaviour: main() returns None, so exit status is 0.
    p = subprocess.run([sys.executable, str(SCRIPT), "--docx", str(tmp_path / "nope.docx")],
                       capture_output=True, text=True)
    assert p.returncode == 0
    assert f"ERROR: {tmp_path / 'nope.docx'} not found" in p.stdout


def test_cli_requires_docx_arg():
    p = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
    assert p.returncode == 2
    assert "--docx" in p.stderr
