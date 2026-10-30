"""Contract tests for doc-marks' GitHub PR backend: inline review comments and review summaries onto the one schema.

Run: uv run --with pytest --with pymupdf --with lxml python3 -m pytest tests/doc_marks_github_test.py -q

The fixture is the two REST endpoints' responses (pulls/N/comments, pulls/N/reviews), hand-written in the field
shapes read live from cli/cli#14858. The live path runs against a stub `gh` on PATH.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "scripts" / "lib"
DOC_MARKS = LIB / "doc_marks.py"
LEDGER = LIB / "review_ledger.py"
FIXTURE = ROOT / "tests" / "fixtures" / "doc-marks" / "github-pr.json"
MARKED = ROOT / "tests" / "fixtures" / "doc-marks" / "marked.pdf"
PR = "edwinhu/workflows#123"
sys.path.insert(0, str(LIB))
import doc_marks  # noqa: E402


def run(*args, env=None):
    return subprocess.run([sys.executable, str(DOC_MARKS), *map(str, args)], capture_output=True, text=True,
                          check=False, env=env)


def marks(*args, env=None):
    p = run(*args, env=env)
    return p, (json.loads(p.stdout) if p.stdout.strip() else None)


def recorded(*extra):
    return marks("--github-pr", PR, "--github-json", FIXTURE, *extra)


def by_id(s):
    return {m["id"]: m for m in s["marks"]}


# ── mapping ───────────────────────────────────────────────────────────────────

def test_inline_comments_and_review_summaries_map_onto_the_schema():
    p, s = recorded()
    assert p.returncode == 0, p.stderr
    assert s["source"] == "github-pr" and s["file"] == PR and s["mtime"] == "2026-10-29T15:12:00Z"
    assert [m["id"] for m in s["marks"]] == ["c9001", "c9005", "r7001"]  # by time; bots, replies, PENDING, empty out
    c = by_id(s)["c9001"]
    assert c["kind"] == "review-comment" and c["author"] == "edwinhu" and c["created"] == "2026-10-29T15:00:00Z"
    assert c["text"] == "Why does this read the copies twice? Use one pass."
    assert c["quoted"].startswith("@@ -38,6 +38,8 @@ def ledger(names):") and "checked_copies" in c["quoted"]
    assert c["where"] == {"page": 42, "heading": "scripts/lib/review_ledger.py", "heading_source": "github-path",
                          "rect": None}
    assert c["resolved"] is None and c["strokes"] is None and c["png"] is None
    assert c["replies"] == [{"author": "coauthor", "created": "2026-10-29T15:05:00Z",
                             "text": "The first pass only validates names; the read is once."}]
    assert by_id(s)["c9005"]["where"]["page"] == 17  # line null on an outdated comment: original_line
    r = by_id(s)["r7001"]
    assert r["kind"] == "review-changes_requested" and r["author"] == "edwinhu"
    assert r["text"] == "Two things before this lands: the double read, and the fixture name."
    assert r["quoted"] == "" and r["replies"] == [] and r["created"] == "2026-10-29T15:12:00Z"
    assert r["where"] == {"page": None, "heading": "(review summary)", "heading_source": "github-review", "rect": None}


def test_include_bots_keeps_bot_comments_reviews_and_replies():
    p, s = recorded("--include-bots")
    assert p.returncode == 0, p.stderr
    assert [m["id"] for m in s["marks"]] == ["c9004", "r7004", "c9001", "c9005", "r7001"]
    assert by_id(s)["r7004"]["kind"] == "review-commented"
    assert [x["author"] for x in by_id(s)["c9001"]["replies"]] == ["coauthor", "Copilot"]


def test_pending_and_empty_reviews_are_never_marks():
    _, s = recorded("--include-bots")
    assert "r7006" not in by_id(s) and "r7002" not in by_id(s)


def test_key_sets_equal_the_pdf_backend(tmp_path):
    _, pdf = marks(MARKED, "--png-dir", tmp_path / "png")
    _, s = recorded()
    assert list(s) == list(pdf) == doc_marks.TOP_KEYS
    for m in s["marks"]:
        assert list(m) == doc_marks.MARK_KEYS and list(m["where"]) == doc_marks.WHERE_KEYS


def test_brief_names_the_path_and_line():
    p = run("--github-pr", PR, "--github-json", FIXTURE, "--brief")
    assert p.returncode == 0, p.stderr
    assert "scripts/lib/review_ledger.py" in p.stdout and "42" in p.stdout
    assert "Why does this read the copies twice? Use one pass." in p.stdout


def test_a_pr_with_only_bot_feedback_is_no_marks(tmp_path):
    data = json.loads(FIXTURE.read_text())
    only_bots = {"comments": [c for c in data["comments"] if c["user"]["type"] == "Bot" and c["in_reply_to_id"] is None],
                 "reviews": [r for r in data["reviews"] if r["user"]["type"] == "Bot"]}
    rec = tmp_path / "bots.json"
    rec.write_text(json.dumps(only_bots))
    p, s = marks("--github-pr", PR, "--github-json", rec)
    assert p.returncode == 1 and "NO MARKS" in p.stderr and s["marks"] == []


def test_could_not_run(tmp_path):
    for bad in ("edwinhu/workflows", "edwinhu/workflows#x", "../etc#1", "edwinhu workflows#1", "-x/y#1"):
        assert run("--github-pr", bad, "--github-json", FIXTURE).returncode == 2, bad
    (tmp_path / "bad.json").write_text("{not json")
    assert run("--github-pr", PR, "--github-json", tmp_path / "bad.json").returncode == 2
    no_id = json.loads(FIXTURE.read_text())
    del no_id["comments"][0]["id"]
    (tmp_path / "noid.json").write_text(json.dumps(no_id))
    assert run("--github-pr", PR, "--github-json", tmp_path / "noid.json").returncode == 2
    assert run("--github-pr", PR, "--github-json", FIXTURE, MARKED).returncode == 2


# ── live, through gh ──────────────────────────────────────────────────────────

def stub_gh(tmp_path, exit_code=0) -> tuple[dict, Path]:
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "gh-argv.jsonl"
    data = json.loads(FIXTURE.read_text())
    for name in ("comments", "reviews"):  # `gh api --paginate` prints one JSON array per page, concatenated
        items = data[name]
        half = len(items) // 2 or 1
        pages = [items[:half], items[half:]]
        assert all(pages)
        (tmp_path / f"{name}.json").write_text("\n".join(json.dumps(pg) for pg in pages))
    gh = bindir / "gh"
    gh.write_text(
        f"#!{sys.executable}\n"
        "import json, sys\n"
        f"open({str(log)!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n"
        f"if {exit_code}:\n"
        "    sys.stderr.write('gh: HTTP 404: Not Found\\n'); sys.exit(1)\n"
        "path = next(a for a in sys.argv[1:] if a.startswith('repos/'))\n"
        f"name = 'comments.json' if path.endswith('/comments') else 'reviews.json'\n"
        f"sys.stdout.write(open({str(tmp_path)!r} + '/' + name).read())\n")
    gh.chmod(0o755)
    return {**os.environ, "PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}"}, log


def test_live_calls_both_endpoints_paginated_through_gh(tmp_path):
    env, log = stub_gh(tmp_path)
    p, s = marks("--github-pr", PR, env=env)
    assert p.returncode == 0, p.stderr
    assert [m["id"] for m in s["marks"]] == ["c9001", "c9005", "r7001"]
    calls = [json.loads(x) for x in log.read_text().splitlines()]
    assert len(calls) == 2
    paths = sorted(next(a for a in c if a.startswith("repos/")) for c in calls)
    assert paths == ["repos/edwinhu/workflows/pulls/123/comments", "repos/edwinhu/workflows/pulls/123/reviews"]
    assert all(c[0] == "api" and "--paginate" in c for c in calls)


def test_live_gh_failure_is_could_not_run(tmp_path):
    env, _ = stub_gh(tmp_path, exit_code=1)
    p = run("--github-pr", PR, env=env)
    assert p.returncode == 2 and "404" in p.stderr


# ── round trip ────────────────────────────────────────────────────────────────

def test_round_trip_through_review_ledger(tmp_path):
    p = run("--github-pr", PR, "--github-json", FIXTURE)
    assert p.returncode == 0, p.stderr
    copy = tmp_path / "workflows PR 123 review 20261029a.json"
    copy.write_text(p.stdout)
    q = subprocess.run([sys.executable, str(LEDGER), "ledger", str(copy), "--json"], capture_output=True, text=True,
                       check=False)
    assert q.returncode == 0, q.stderr
    rows = json.loads(q.stdout)["marks"]
    assert [r["id"] for r in rows] == [f"{copy.stem}#c9001", f"{copy.stem}#c9005", f"{copy.stem}#r7001"]
    assert rows[0]["heading"] == "scripts/lib/review_ledger.py" and rows[0]["source"] == "github-pr"
