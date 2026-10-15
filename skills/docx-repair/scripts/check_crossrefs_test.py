"""Contract tests for check_crossrefs.py (supra/infra target verification)."""
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_crossrefs as cc  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "check_crossrefs.py"
NS = f'xmlns:w="{cc.W[1:-1]}"'


def build(path, notes, document_body=""):
    """notes: list of footnote texts; displayed numbers start at 1."""
    fns = '<w:footnote w:id="-1"><w:p><w:r><w:t>sep</w:t></w:r></w:p></w:footnote>'
    fns += '<w:footnote w:id="0"><w:p><w:r><w:t>cont</w:t></w:r></w:p></w:footnote>'
    for i, t in enumerate(notes, start=1):
        fns += f'<w:footnote w:id="{i}"><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:footnote>'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", f"<w:document {NS}><w:body>{document_body}</w:body></w:document>")
        z.writestr("word/footnotes.xml", f"<w:footnotes {NS}>{fns}</w:footnotes>")
    return str(path)


def run(path, *extra):
    return subprocess.run([sys.executable, str(SCRIPT), path, *extra],
                          capture_output=True, text=True)


def test_footnotes_numbered_by_id_order_skipping_separators(tmp_path):
    p = build(tmp_path / "a.docx", ["one", "two"])
    assert cc.footnotes(p) == {1: "one", 2: "two"}


def test_footnote_numbering_uses_sorted_ids_not_ids(tmp_path):
    # ids 2 and 5 display as notes 1 and 2
    fns = ('<w:footnote w:id="5"><w:p><w:r><w:t>b</w:t></w:r></w:p></w:footnote>'
           '<w:footnote w:id="2"><w:p><w:r><w:t>a</w:t></w:r></w:p></w:footnote>')
    path = tmp_path / "s.docx"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/footnotes.xml", f"<w:footnotes {NS}>{fns}</w:footnotes>")
    assert cc.footnotes(str(path)) == {1: "a", 2: "b"}


def test_antecedent_extracts_short_form():
    t = "See also Lin, supra note 2."
    assert cc.antecedent(t, t.index("supra")) == "Lin"
    t = "See Subramanian & Zhao, supra note 2."
    assert cc.antecedent(t, t.index("supra")) == "Subramanian & Zhao"


def test_antecedent_keeps_unlisted_signal_word():
    # "Compare" is not in SIGNAL, so it stays glued to the short form.
    t = "Compare Lin, supra note 2."
    assert cc.antecedent(t, t.index("supra")) == "Compare Lin"


def test_antecedent_empty_for_bare_reference():
    t = "See supra note 2."
    assert cc.antecedent(t, t.index("supra")) == ""


def test_keywords_drop_noise_words():
    assert cc.keywords("The Lin") == ["Lin"]
    assert cc.keywords("See") == []


def test_clean_document_exit_zero(tmp_path):
    p = build(tmp_path / "ok.docx", [
        "Lin, Voting Rules, 5 Yale L.J. 1.",
        "Park, Boards, 3 Stan. L. Rev. 4.",
        "Lin, supra note 1, at 7.",
    ])
    r = run(p)
    assert r.returncode == 0
    assert r.stdout.startswith("footnotes 3 · cross-references 1 · problems 0")


def test_wrong_source_is_flagged_with_target_preview(tmp_path):
    p = build(tmp_path / "bad.docx", [
        "Lin, Voting Rules, 5 Yale L.J. 1.",
        "Park, Boards, 3 Stan. L. Rev. 4.",
        "Lin, supra note 2.",
    ])
    r = run(p)
    assert r.returncode == 1
    assert "footnotes 3 · cross-references 1 · problems 1" in r.stdout
    assert "  FN3  Lin, supra note 2" in r.stdout
    assert '"Lin" does not appear in note 2' in r.stdout
    assert "note 2: Park, Boards, 3 Stan. L. Rev. 4.…" in r.stdout


def test_supra_pointing_forward(tmp_path):
    p = build(tmp_path / "f.docx", ["Lin, supra note 2.", "Lin, Voting."])
    r = run(p)
    assert r.returncode == 1
    assert "supra points forward" in r.stdout


def test_supra_to_own_note_is_forward(tmp_path):
    p = build(tmp_path / "s.docx", ["Lin, supra note 1."])
    r = run(p)
    assert r.returncode == 1
    assert "supra points forward" in r.stdout


def test_infra_pointing_backward(tmp_path):
    p = build(tmp_path / "i.docx", ["Lin, Voting.", "Lin, infra note 1."])
    r = run(p)
    assert r.returncode == 1
    assert "infra points backward" in r.stdout


def test_infra_forward_is_ok(tmp_path):
    p = build(tmp_path / "i.docx", ["Lin, infra note 2.", "Lin, Voting."])
    assert run(p).returncode == 0


def test_missing_target_note(tmp_path):
    p = build(tmp_path / "m.docx", ["Lin, Voting.", "Lin, supra note 9."])
    r = run(p)
    assert r.returncode == 1
    assert "note 9 does not exist" in r.stdout


def test_range_checks_both_endpoints(tmp_path):
    p = build(tmp_path / "r.docx", [
        "Lin, Voting.", "Park, Boards.", "Lin, supra notes 1-2."])
    r = run(p)
    assert r.returncode == 1
    assert "cross-references 2 · problems 1" in r.stdout
    assert "Lin, supra note 2" in r.stdout


def test_bare_cross_reference_not_name_matched(tmp_path):
    p = build(tmp_path / "b.docx", ["Anything here.", "See supra note 1."])
    assert run(p).returncode == 0


def test_tracked_changes_refuse_with_exit_2(tmp_path):
    body = '<w:p><w:ins w:id="1"><w:r><w:t>x</w:t></w:r></w:ins></w:p>'
    p = build(tmp_path / "t.docx", ["Lin, Voting."], document_body=body)
    assert cc.tracked(p) == 1
    r = run(p)
    assert r.returncode == 2
    assert r.stdout.startswith("REFUSED: 1 tracked changes pending.")


def test_verbose_appends_matching_note(tmp_path):
    p = build(tmp_path / "v.docx", ["Lin, Voting."])
    assert "name-matched loosely" in run(p, "--verbose").stdout
    assert "name-matched loosely" not in run(p).stdout


def test_missing_file_raises(tmp_path):
    r = run(str(tmp_path / "nope.docx"))
    assert r.returncode != 0
    assert "FileNotFoundError" in r.stderr
