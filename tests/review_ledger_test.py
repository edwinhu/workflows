"""Contract tests for bin/review-ledger (scripts/lib/review_ledger.py): ledger and verify over doc-marks.

Run: uv run --with pytest --with pymupdf --with lxml python3 -m pytest tests/review_ledger_test.py -q

Every test drives the real CLI as a subprocess, the way a workflow does. The marked copy is the real Xodo
fixture doc-marks is proven on (four slides, five ink marks, three with typed notes); an unmarked PDF and a
doc-marks JSON (a Drive copy's shape) are made here so the input stays visible in the test.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "scripts" / "lib" / "review_ledger.py"
LAUNCHER = ROOT / "bin" / "review-ledger"
MARKED = ROOT / "tests" / "fixtures" / "doc-marks" / "marked.pdf"

OLD = "Lecture 25 slides review 20261022a"
NEW = "Lecture 25 slides review 20261022b"
# doc-marks ids on the fixture: page.<1-based index on that page>
FIXTURE_IDS = ["p1.1", "p2.1", "p3.1", "p3.2", "p4.1"]


def run(*args, stdin=None):
    return subprocess.run([sys.executable, str(MODULE), *map(str, args)], capture_output=True, text=True,
                          input=stdin, check=False)


def marked_copy(tmp_path: Path, stem: str = OLD) -> Path:
    p = tmp_path / f"{stem}.pdf"
    shutil.copy(MARKED, p)
    return p


def unmarked_copy(tmp_path: Path, stem: str = NEW) -> Path:
    p = tmp_path / f"{stem}.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "A clean slide with nothing on it")
    doc.save(p)
    return p


def drive_copy(tmp_path: Path) -> Path:
    p = tmp_path / "Draft comments 20261023.json"
    p.write_text(json.dumps({
        "source": "drive", "file": "1AbCdriveid", "mtime": None,
        "marks": [{"id": "c7", "kind": "comment", "author": "Edwin Hu", "created": "2026-10-23T10:00:00Z",
                   "text": "cut this paragraph", "quoted": "the paragraph in question", "resolved": False,
                   "replies": [], "where": {"page": None, "heading": "Part II", "heading_source": "docx-heading",
                                            "rect": None}, "strokes": None, "png": None}],
    }), encoding="utf-8")
    return p


def ledger_json(*copies, extra=()):
    p = run("ledger", *copies, "--json", *extra)
    return p, (json.loads(p.stdout) if p.stdout.strip() else None)


# ── ledger ────────────────────────────────────────────────────────────────────

def test_ledger_ids_number_across_copies_in_argument_order(tmp_path):
    a = marked_copy(tmp_path, OLD)
    b = marked_copy(tmp_path, NEW)
    p, res = ledger_json(a, b, extra=("--png-dir", tmp_path / "png"))
    assert p.returncode == 0, p.stderr
    ids = [r["id"] for r in res["marks"]]
    assert ids == [f"{OLD}#{i}" for i in FIXTURE_IDS] + [f"{NEW}#{i}" for i in FIXTURE_IDS]
    assert [r["n"] for r in res["marks"]] == list(range(1, 11))
    assert [c["file"] for c in res["copies"]] == [a.name, b.name]
    assert [c["marks"] for c in res["copies"]] == [5, 5]


def test_ledger_keeps_typed_text_verbatim_and_untyped_as_null(tmp_path):
    p, res = ledger_json(marked_copy(tmp_path), extra=("--png-dir", tmp_path / "png"))
    assert p.returncode == 0, p.stderr
    by = {r["id"].split("#")[1]: r for r in res["marks"]}
    assert by["p3.1"]["typed"] == "I am going to skip 15c2-8"
    assert by["p1.1"]["typed"] == "is this really a limit? this should probably point to TFW?"
    assert by["p2.1"]["typed"] is None
    assert by["p3.1"]["heading"].startswith("Rule 172 makes access equal delivery")
    assert by["p3.1"]["page"] == 3 and by["p3.1"]["source"] == "pdf" and by["p3.1"]["kind"] == "Ink"
    assert by["p3.1"]["copy"] == f"{OLD}.pdf"
    assert Path(by["p3.1"]["png"]).is_file()


def test_ledger_lists_an_unmarked_copy_with_zero_marks(tmp_path):
    a, b = marked_copy(tmp_path), unmarked_copy(tmp_path)
    p, res = ledger_json(a, b, extra=("--png-dir", tmp_path / "png"))
    assert p.returncode == 0, p.stderr
    assert res["copies"] == [{"file": a.name, "marks": 5}, {"file": b.name, "marks": 0}]


def test_ledger_markdown_names_unmarked_copies_and_untyped_marks(tmp_path):
    p = run("ledger", marked_copy(tmp_path), unmarked_copy(tmp_path), "--png-dir", tmp_path / "png")
    assert p.returncode == 0, p.stderr
    assert f"{NEW}.pdf: NO MARKS" in p.stdout
    assert f"`{OLD}#p3.1`" in p.stdout and 'typed: "I am going to skip 15c2-8"' in p.stdout
    p21 = next(line for line in p.stdout.splitlines() if f"{OLD}#p2.1" in line)
    assert "UNTYPED" in p21


def test_ledger_with_no_marks_anywhere_exits_1(tmp_path):
    p, res = ledger_json(unmarked_copy(tmp_path))
    assert p.returncode == 1
    assert "NO MARKS" in p.stderr
    assert res["marks"] == []


def test_ledger_merges_a_doc_marks_json_copy(tmp_path):
    a, d = marked_copy(tmp_path), drive_copy(tmp_path)
    p, res = ledger_json(a, d, extra=("--png-dir", tmp_path / "png"))
    assert p.returncode == 0, p.stderr
    last = res["marks"][-1]
    assert last["id"] == "Draft comments 20261023#c7" and last["n"] == 6
    assert last["source"] == "drive" and last["typed"] == "cut this paragraph"
    assert last["under"] == "the paragraph in question" and last["heading"] == "Part II"


def test_ledger_could_not_run(tmp_path):
    assert run().returncode == 2
    assert run("ledger").returncode == 2
    assert run("ledger", tmp_path / "missing.pdf").returncode == 2
    (tmp_path / "notes.txt").write_text("x")
    assert run("ledger", tmp_path / "notes.txt").returncode == 2
    (tmp_path / "bad.json").write_text("{not json")
    assert run("ledger", tmp_path / "bad.json").returncode == 2


def test_launcher_runs_the_ledger(tmp_path):
    p = subprocess.run([str(LAUNCHER), "ledger", str(marked_copy(tmp_path)), "--json", "--png-dir", str(tmp_path / "png")],
                       capture_output=True, text=True, check=False)
    assert p.returncode == 0, p.stderr
    assert len(json.loads(p.stdout)["marks"]) == 5


# ── verify ────────────────────────────────────────────────────────────────────

def saved_ledger(tmp_path) -> tuple[Path, list[str]]:
    p, res = ledger_json(marked_copy(tmp_path), extra=("--png-dir", tmp_path / "png"))
    assert p.returncode == 0, p.stderr
    path = tmp_path / "ledger.json"
    path.write_text(p.stdout, encoding="utf-8")
    return path, [r["id"] for r in res["marks"]]


def outcomes_file(tmp_path, outcomes: dict) -> Path:
    path = tmp_path / "outcomes.json"
    path.write_text(json.dumps(outcomes), encoding="utf-8")
    return path


def complete(ids):
    kinds = ["applied", "answered", "asked", "no-edit", "applied"]
    return {i: {"outcome": k, "note": f"note {n}", "target": "slides"} for n, (i, k) in enumerate(zip(ids, kinds))}


def verify(tmp_path, ledger, outcomes, *extra):
    p = run("verify", "--ledger", ledger, "--outcomes", outcomes_file(tmp_path, outcomes), "--json", *extra)
    return p, (json.loads(p.stdout) if p.stdout.strip() else None)


def test_verify_complete_outcomes_pass(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    p, res = verify(tmp_path, ledger, complete(ids))
    assert p.returncode == 0, p.stdout + p.stderr
    assert res["summary"]["ok"] is True and res["summary"]["ids"] == 5
    assert res["completeness"] == {"missing": [], "unknown": [], "invalid": []}


def test_verify_names_a_missing_id(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    o = complete(ids)
    del o[ids[2]]
    p, res = verify(tmp_path, ledger, o)
    assert p.returncode == 1
    assert res["completeness"]["missing"] == [ids[2]]
    assert res["summary"]["ok"] is False


def test_verify_names_an_unknown_id_and_an_invalid_outcome(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    o = complete(ids)
    o["Lecture 99 slides review 20260101a#p1.1"] = {"outcome": "applied", "note": ""}
    o[ids[1]] = {"outcome": "done", "note": "not a real outcome"}
    p, res = verify(tmp_path, ledger, o)
    assert p.returncode == 1
    assert res["completeness"]["unknown"] == ["Lecture 99 slides review 20260101a#p1.1"]
    assert [x["id"] for x in res["completeness"]["invalid"]] == [ids[1]]


def test_verify_markdown_names_the_failing_id(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    o = complete(ids)
    del o[ids[4]]
    p = run("verify", "--ledger", ledger, "--outcomes", outcomes_file(tmp_path, o))
    assert p.returncode == 1
    assert ids[4] in p.stdout


def test_verify_reads_copies_directly(tmp_path):
    copy = marked_copy(tmp_path)
    ids = [f"{OLD}#{i}" for i in FIXTURE_IDS]
    p = run("verify", copy, "--outcomes", outcomes_file(tmp_path, complete(ids)), "--json")
    assert p.returncode == 0, p.stdout + p.stderr


def checker(tmp_path, body: str) -> Path:
    """A check-cmd that logs what it was handed, then decides by `body` over `data`."""
    log = tmp_path / "check.log"
    script = tmp_path / "check.py"
    script.write_text(
        "import json, sys\n"
        "data = json.load(sys.stdin)\n"
        f"open({str(log)!r}, 'a').write(json.dumps(data) + '\\n')\n"
        + body, encoding="utf-8")
    return script


def logged(tmp_path) -> list[dict]:
    log = tmp_path / "check.log"
    return [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []


def test_check_cmd_fails_one_applied_mark_with_its_reason(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    o = complete(ids)  # ids[0] and ids[4] are applied
    script = checker(tmp_path,
                     f"if data['mark']['id'] == {ids[4]!r}:\n"
                     "    print('slide text unchanged in the new build'); sys.exit(1)\n"
                     "sys.exit(0)\n")
    p, res = verify(tmp_path, ledger, o, "--check-cmd", f"{sys.executable} {script}")
    assert p.returncode == 1, p.stderr
    by = {r["id"]: r for r in res["results"]}
    assert by[ids[4]]["status"] == "FAIL" and "slide text unchanged" in by[ids[4]]["reason"]
    assert by[ids[0]]["status"] == "PASS"
    seen = logged(tmp_path)
    assert sorted(x["mark"]["id"] for x in seen) == sorted([ids[0], ids[4]])
    handed = next(x for x in seen if x["mark"]["id"] == ids[0])
    assert handed["outcome"] == {"outcome": "applied", "note": "note 0", "target": "slides"}
    assert handed["mark"]["typed"] == "is this really a limit? this should probably point to TFW?"


def test_check_cmd_that_cannot_run_makes_verify_exit_2(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    script = checker(tmp_path, "sys.exit(2)\n")
    p, _ = verify(tmp_path, ledger, complete(ids), "--check-cmd", f"{sys.executable} {script}")
    assert p.returncode == 2


def test_check_cmd_runs_without_a_shell(tmp_path):
    ledger, ids = saved_ledger(tmp_path)
    marker = tmp_path / "shell-ran"
    p, _ = verify(tmp_path, ledger, complete(ids), "--check-cmd", f"true; touch {marker}")
    assert not marker.exists()
    assert p.returncode == 2


def test_verify_could_not_run(tmp_path):
    ledger, _ = saved_ledger(tmp_path)
    assert run("verify").returncode == 2
    assert run("verify", "--ledger", ledger).returncode == 2
    bad = tmp_path / "bad-outcomes.json"
    bad.write_text("[1, 2]")
    assert run("verify", "--ledger", ledger, "--outcomes", bad).returncode == 2
