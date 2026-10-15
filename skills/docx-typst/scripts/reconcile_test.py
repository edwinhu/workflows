# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "lxml"]
# ///
"""Contract tests for reconcile.py: ancestor resolution order, git merge-file wrapper, CLI guards.

Conversions that need pandoc are monkeypatched; the merge itself runs real `git merge-file`.
"""

import json
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import provenance
import reconcile as r

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
needs_git = pytest.mark.skipif(not shutil.which("git"), reason="git required")


def docx(path, body="<w:p/>", props=None):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
    if props:
        provenance.stamp(path, props)
    return path


def test_has_tracked_changes_detects_ins_and_del(tmp_path):
    assert r.has_tracked_changes(docx(tmp_path / "a.docx", "<w:p><w:ins><w:r/></w:ins></w:p>"))
    assert r.has_tracked_changes(docx(tmp_path / "b.docx", "<w:p><w:del><w:r/></w:del></w:p>"))


def test_has_tracked_changes_false_for_clean_and_for_missing_document_part(tmp_path):
    assert not r.has_tracked_changes(docx(tmp_path / "a.docx"))
    empty = tmp_path / "e.docx"
    with zipfile.ZipFile(empty, "w") as z:
        z.writestr("other.xml", "<x/>")
    assert not r.has_tracked_changes(empty)


def test_resolve_prefers_explicit_base(monkeypatch, tmp_path):
    monkeypatch.setattr(r, "canonicalize_file", lambda p: f"canon:{Path(p).name}")
    text, how = r.resolve_ancestor(docx(tmp_path / "ret.docx", "<w:ins/>"), tmp_path / "body.typ",
                                   base=tmp_path / "anc.typ", base_docx=tmp_path / "sent.docx")
    assert text == "canon:anc.typ" and how == f"--base {tmp_path / 'anc.typ'}"


def test_resolve_uses_base_docx_before_tracked_changes(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(r, "canonical_from_docx", lambda d, track_changes, media_dir, typ_dir: calls.append((Path(d).name, track_changes)) or "T")
    _, how = r.resolve_ancestor(docx(tmp_path / "ret.docx", "<w:ins/>"), tmp_path / "body.typ",
                                base_docx=tmp_path / "sent.docx")
    assert calls == [("sent.docx", "accept")] and how.startswith("--base-docx")


def test_resolve_tracked_changes_rejects(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(r, "canonical_from_docx", lambda d, track_changes, media_dir, typ_dir: calls.append(track_changes) or "T")
    text, how = r.resolve_ancestor(docx(tmp_path / "ret.docx", "<w:ins/>"), tmp_path / "body.typ")
    assert (text, how, calls) == ("T", "tracked changes (rejected)", ["reject"])


def test_resolve_without_any_ancestor_refuses(tmp_path):
    with pytest.raises(r.ReconcileError, match="no ancestor available.*Refusing to two-way diff"):
        r.resolve_ancestor(docx(tmp_path / "ret.docx"), tmp_path / "body.typ")


@needs_git
def test_resolve_stamp_with_unknown_blob_names_the_missing_object(tmp_path):
    sha = "0123456789abcdef0123456789abcdef01234567"
    ret = docx(tmp_path / "ret.docx", props={"SourceGitSHA": sha})
    with pytest.raises(r.ReconcileError, match=r"0123456789ab, but that object is not in this repository"):
        r.resolve_ancestor(ret, tmp_path / "body.typ")


@needs_git
def test_resolve_stamp_with_committed_blob_canonicalizes_it(monkeypatch, tmp_path):
    import subprocess
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    f = tmp_path / "body.typ"
    f.write_text("ancestor text\n")
    sha = subprocess.run(["git", "-C", str(tmp_path), "hash-object", "-w", str(f)],
                         capture_output=True, text=True, check=True).stdout.strip()
    monkeypatch.setattr(r, "canonicalize_text", lambda t, resource_path: f"canon:{t}")
    text, how = r.resolve_ancestor(docx(tmp_path / "ret.docx", props={"SourceGitSHA": sha}), f)
    assert text == "canon:ancestor text\n"
    assert how == f"provenance stamp (git blob {sha[:12]})"


@needs_git
def test_merge3_clean_when_edits_are_disjoint():
    anc = "one\n\ntwo\n\nthree\n"
    merged, n = r.merge3("ONE\n\ntwo\n\nthree\n", anc, "one\n\ntwo\n\nTHREE\n", ("m", "a", "t"))
    assert n == 0 and merged == "ONE\n\ntwo\n\nTHREE\n"


@needs_git
def test_merge3_same_line_conflict_leaves_markers_and_counts_one():
    merged, n = r.merge3("mine\n", "base\n", "theirs\n", ("repo", "anc", "coauthor"))
    assert n == 1
    assert "<<<<<<< repo" in merged and ">>>>>>> coauthor" in merged
    assert "mine\n" in merged and "theirs\n" in merged


def test_merge3_git_failure_raises(monkeypatch):
    class P:
        returncode = 255
        stdout = ""
        stderr = "fatal: nope\n"
    monkeypatch.setattr(r.subprocess, "run", lambda *a, **k: P())
    with pytest.raises(r.ReconcileError, match="git merge-file failed: fatal: nope"):
        r.merge3("a", "b", "c", ("x", "y", "z"))


@needs_git
def test_reconcile_writes_merged_sidecar_and_diff(monkeypatch, tmp_path):
    src = tmp_path / "body.typ"
    src.write_text("src\n")
    ret = docx(tmp_path / "ret.docx")
    monkeypatch.setattr(r, "resolve_ancestor", lambda *a, **k: ("p1\n\np2\n", "stub"))
    monkeypatch.setattr(r, "canonical_from_docx", lambda *a, **k: "p1\n\nP2\n")
    monkeypatch.setattr(r, "canonicalize_file", lambda p: "P1\n\np2\n")
    res = r.reconcile(ret, src)
    merged = tmp_path / "body.merged.typ"
    assert merged.read_text() == "P1\n\nP2\n"
    assert res == {"ancestor": "stub", "conflicts": 0, "merged": str(merged),
                   "diff": str(merged) + ".diff", "theirsChanged": True, "mineChanged": True}
    assert "-p2" in Path(res["diff"]).read_text() and "+P2" in Path(res["diff"]).read_text()
    assert src.read_text() == "src\n"


@needs_git
def test_reconcile_apply_overwrites_source(monkeypatch, tmp_path):
    src = tmp_path / "body.typ"
    src.write_text("src\n")
    monkeypatch.setattr(r, "resolve_ancestor", lambda *a, **k: ("a\n", "stub"))
    monkeypatch.setattr(r, "canonical_from_docx", lambda *a, **k: "a\n")
    monkeypatch.setattr(r, "canonicalize_file", lambda p: "b\n")
    res = r.reconcile(docx(tmp_path / "ret.docx"), src, apply=True)
    assert src.read_text() == "b\n" and res["theirsChanged"] is False and res["mineChanged"] is True


def test_cli_missing_input_exits_2(tmp_path, capsys):
    missing = tmp_path / "ret.docx"
    assert r.main([str(missing), "--source", str(tmp_path / "b.typ")]) == 2
    assert f"error: not found: {missing}" in capsys.readouterr().err


def test_cli_no_ancestor_exits_2_with_message(tmp_path, capsys):
    src = tmp_path / "body.typ"
    src.write_text("x\n")
    assert r.main([str(docx(tmp_path / "ret.docx")), "--source", str(src)]) == 2
    assert "error: no ancestor available" in capsys.readouterr().err


def test_cli_conflict_exits_1_and_prints_json(monkeypatch, tmp_path, capsys):
    src = tmp_path / "body.typ"
    src.write_text("x\n")
    ret = docx(tmp_path / "ret.docx")
    monkeypatch.setattr(r, "reconcile", lambda *a, **k: {"conflicts": 2, "merged": "m.typ", "diff": "d"})
    assert r.main([str(ret), "--source", str(src)]) == 1
    cap = capsys.readouterr()
    assert json.loads(cap.out)["conflicts"] == 2
    assert "2 conflict(s) left in m.typ" in cap.err


def test_cli_clean_merge_exits_0(monkeypatch, tmp_path, capsys):
    src = tmp_path / "body.typ"
    src.write_text("x\n")
    ret = docx(tmp_path / "ret.docx")
    monkeypatch.setattr(r, "reconcile", lambda *a, **k: {"conflicts": 0, "merged": "m.typ", "diff": "d"})
    assert r.main([str(ret), "--source", str(src)]) == 0
