# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for assemble.py: completeness proof over dumped capture batches."""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "assemble.py"


def page(start, ids):
    return {"start": start, "rows": [{"id": i} for i in ids]}


def run(tmp_path, pages_by_file, **kw):
    for name, pages in pages_by_file.items():
        (tmp_path / name).write_text(json.dumps(pages))
    out = tmp_path / "out.jsonl"
    args = [sys.executable, str(SCRIPT), "--batches", str(tmp_path), "--out", str(out),
            "--expect-total", str(kw.get("total", 4)), "--page-size", str(kw.get("size", 2))]
    for flag in ("first_page", "id_field", "glob"):
        if flag in kw:
            args += ["--" + flag.replace("_", "-"), str(kw[flag])]
    return subprocess.run(args, capture_output=True, text=True), out


def test_complete_capture_writes_jsonl(tmp_path):
    r, out = run(tmp_path, {"batch_1.json": [page(2, [3, 4]), page(0, [1, 2])]})
    assert r.returncode == 0
    assert "pages=2 unique_starts=2 dup_starts=0" in r.stdout
    assert f"OK: complete. [out] {out}" in r.stdout
    # rows keep file order; pages are not re-sorted by start
    assert [json.loads(x)["id"] for x in out.read_text().splitlines()] == [3, 4, 1, 2]


def test_missing_page_offset_fails_and_writes_nothing(tmp_path):
    r, out = run(tmp_path, {"batch_1.json": [page(0, [1, 2]), page(4, [5, 6])]}, total=4)
    assert r.returncode == 1
    assert "gaps=1 [2]" in r.stdout
    assert "FAIL: 1 missing page offsets" in r.stderr
    assert not out.exists()


def test_duplicate_page_and_ids_reported(tmp_path):
    r, _ = run(tmp_path, {"batch_1.json": [page(0, [1, 2]), page(0, [1, 2])]}, total=4)
    assert r.returncode == 1
    assert "FAIL: 1 duplicate page offsets; 2 duplicate record ids" in r.stderr


def test_row_count_mismatch(tmp_path):
    r, _ = run(tmp_path, {"batch_1.json": [page(0, [1, 2]), page(2, [3, 4])]}, total=5)
    assert r.returncode == 1
    assert "FAIL: row count 4 != expected 5" in r.stderr


def test_no_pages_found(tmp_path):
    r, _ = run(tmp_path, {})
    assert r.returncode == 1
    assert "FAIL: no pages found" in r.stderr


def test_first_page_accepts_raw_result_and_custom_id_field(tmp_path):
    first = tmp_path / "first.json"
    first.write_text(json.dumps({"result": [{"k": "a"}, {"k": "b"}]}))
    r, out = run(tmp_path, {"batch_1.json": [{"start": 2, "rows": [{"k": "c"}, {"k": "d"}]}]},
                 first_page=first, id_field="k")
    assert r.returncode == 0, r.stderr
    assert "unique_k=4" in r.stdout
    assert len(out.read_text().splitlines()) == 4


def test_glob_filters_batch_files(tmp_path):
    r, _ = run(tmp_path, {"batch_1.json": [page(0, [1, 2])], "other.json": [page(2, [3, 4])]},
               total=2)
    assert r.returncode == 0
    assert "pages=1 " in r.stdout
