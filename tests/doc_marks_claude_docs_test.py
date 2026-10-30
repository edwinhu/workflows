"""Contract tests for doc-marks' Claude Docs backend: a recorded comment export onto the one schema.

Run: uv run --with pytest --with pymupdf --with lxml python3 -m pytest tests/doc_marks_claude_docs_test.py -q

The fixture is the 2026-10-29 probe doc's real `query(utterance, under=<tab body>)` rows and its
`read(utterance)` anchors, with the actor principal replaced by a placeholder.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "scripts" / "lib"
DOC_MARKS = LIB / "doc_marks.py"
LEDGER = LIB / "review_ledger.py"
FIXTURE = ROOT / "tests" / "fixtures" / "doc-marks" / "claude-docs.json"
MARKED = ROOT / "tests" / "fixtures" / "doc-marks" / "marked.pdf"
DOC = "https://claude.ai/artifact/KL1Bhs5MaEU7cUXaurGV3N"
sys.path.insert(0, str(LIB))
import doc_marks  # noqa: E402


def run(*args):
    return subprocess.run([sys.executable, str(DOC_MARKS), *map(str, args)], capture_output=True, text=True,
                          check=False)


def marks(*args):
    p = run(*args)
    return p, (json.loads(p.stdout) if p.stdout.strip() else None)


def export(tmp_path, data, name="export.json"):
    path = tmp_path / name
    path.write_text(json.dumps(data))
    return path


def fixture():
    return json.loads(FIXTURE.read_text())


def by_id(s):
    return {m["id"]: m for m in s["marks"]}


# ── mapping ───────────────────────────────────────────────────────────────────

def test_threads_map_onto_the_schema():
    p, s = marks("--claude-docs", FIXTURE)
    assert p.returncode == 0, p.stderr
    assert s["source"] == "claude-docs" and s["file"] == DOC and s["mtime"] == "2026-10-30T02:08:46.942Z"
    assert [m["id"] for m in s["marks"]] == ["231a8bab-15e1", "e521f537-a14f"]  # the reply and the resolve are not marks
    a = by_id(s)["231a8bab-15e1"]
    assert a["kind"] == "comment" and a["author"] == "Edwin Hu" and a["created"] == "2026-10-30T02:08:38.120Z"
    assert a["text"] == "Say what a stable id looks like here."
    assert a["quoted"] == "gives each mark a stable id"
    assert a["resolved"] is False
    assert a["replies"] == [{"author": "Edwin Hu", "created": "2026-10-30T02:08:46.761Z",
                             "text": "Copy stem, #, the mark id: Lecture 27 slides review 20261027a#p2.1."}]
    assert a["where"] == {"page": None, "heading": "Tab 1", "heading_source": "claude-docs-tab", "rect": None}
    assert a["strokes"] is None and a["png"] is None
    b = by_id(s)["e521f537-a14f"]
    assert b["text"] == 'Cut "or an applied mark changed nothing"?'
    assert b["quoted"] == "an applied mark changed nothing"
    assert b["resolved"] is True and b["replies"] == []


def test_whole_tab_note_without_anchor_has_empty_quote(tmp_path):
    data = fixture()
    note = json.loads(json.dumps(data["rows"][0]))
    note.update(seq=10, id="note-0000-0001", at="2026-10-30T02:09:00.000Z")
    note["payload"]["value"] = {"body": "Whole tab: shorten it.", "parent": {"id": "4fd6df38-f36e", "object": "node"}}
    data["rows"].append(note)
    p, s = marks("--claude-docs", export(tmp_path, data))
    assert p.returncode == 0, p.stderr
    n = by_id(s)["note-0000-0001"]
    assert n["quoted"] == "" and n["text"] == "Whole tab: shorten it." and n["resolved"] is False
    assert s["mtime"] == "2026-10-30T02:09:00.000Z"


def test_marks_and_replies_follow_seq_not_row_order(tmp_path):
    data = fixture()
    data["rows"].reverse()
    second = json.loads(json.dumps(data["rows"][1]))  # seq 8: the reply to 231a8bab
    second.update(seq=11, id="reply-later", at="2026-10-30T02:10:00.000Z")
    second["payload"]["value"]["body"] = "A later reply."
    data["rows"].insert(0, second)
    p, s = marks("--claude-docs", export(tmp_path, data))
    assert p.returncode == 0, p.stderr
    assert [m["id"] for m in s["marks"]] == ["231a8bab-15e1", "e521f537-a14f"]
    assert [r["text"] for r in by_id(s)["231a8bab-15e1"]["replies"]] == [
        "Copy stem, #, the mark id: Lecture 27 slides review 20261027a#p2.1.", "A later reply."]


def test_key_sets_equal_the_pdf_backend(tmp_path):
    _, pdf = marks(MARKED, "--png-dir", tmp_path / "png")
    _, s = marks("--claude-docs", FIXTURE)
    assert list(s) == list(pdf) == doc_marks.TOP_KEYS
    for m in s["marks"]:
        assert list(m) == doc_marks.MARK_KEYS and list(m["where"]) == doc_marks.WHERE_KEYS


def test_brief_carries_the_quote():
    p = run("--claude-docs", FIXTURE, "--brief")
    assert p.returncode == 0, p.stderr
    assert "gives each mark a stable id" in p.stdout and "Say what a stable id looks like here." in p.stdout
    assert "Tab 1" in p.stdout


# ── exits ─────────────────────────────────────────────────────────────────────

def test_only_a_resolve_row_is_no_marks(tmp_path):
    data = fixture()
    data["rows"] = [r for r in data["rows"] if r["payload"]["value"].get("kind") == "resolve"]
    p, s = marks("--claude-docs", export(tmp_path, data))
    assert p.returncode == 1 and "NO MARKS" in p.stderr and s["marks"] == []


def test_could_not_run(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert run("--claude-docs", bad).returncode == 2
    assert run("--claude-docs", export(tmp_path, {**fixture(), "tool": "lens"}, "tool.json")).returncode == 2
    assert run("--claude-docs", export(tmp_path, {**fixture(), "rows": {"a": 1}}, "rows.json")).returncode == 2
    no_seq = fixture()
    del no_seq["rows"][0]["seq"]
    assert run("--claude-docs", export(tmp_path, no_seq, "noseq.json")).returncode == 2
    no_id = fixture()
    del no_id["rows"][1]["id"]
    assert run("--claude-docs", export(tmp_path, no_id, "noid.json")).returncode == 2
    no_value = fixture()
    del no_value["rows"][2]["payload"]["value"]
    assert run("--claude-docs", export(tmp_path, no_value, "novalue.json")).returncode == 2
    assert run("--claude-docs", FIXTURE, MARKED).returncode == 2


def test_claude_docs_is_exclusive_with_every_other_source():
    for extra in (["--drive", "abc"], ["--drive-json", FIXTURE], ["--lens", FIXTURE], ["--molabel", FIXTURE],
                  ["--github-pr", "edwinhu/workflows#1"], ["--github-json", FIXTURE], ["--include-bots"]):
        p = run("--claude-docs", FIXTURE, *extra)
        assert p.returncode == 2 and "--claude-docs reads one export" in p.stderr, extra


# ── round trip ────────────────────────────────────────────────────────────────

def test_round_trip_through_review_ledger(tmp_path):
    p = run("--claude-docs", FIXTURE)
    assert p.returncode == 0, p.stderr
    copy = tmp_path / "draft doc review 20261029a.json"
    copy.write_text(p.stdout)
    q = subprocess.run([sys.executable, str(LEDGER), "ledger", str(copy), "--json"], capture_output=True, text=True,
                       check=False)
    assert q.returncode == 0, q.stderr
    rows = json.loads(q.stdout)["marks"]
    assert [r["id"] for r in rows] == [f"{copy.stem}#231a8bab-15e1", f"{copy.stem}#e521f537-a14f"]
    assert rows[0]["heading"] == "Tab 1" and rows[0]["source"] == "claude-docs"
