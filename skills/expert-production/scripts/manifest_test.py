"""Contract tests for manifest.py, and for the archive leg reading what it writes."""
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
SCRIPT = HERE / "manifest.py"
CHECK = HERE / "package_check.py"
NAME = "sample-production-2031-02-03"
FIXED = 1_900_000_000.75


def run(*args):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), *map(str, args)], capture_output=True, text=True)


def make_stage(root: Path) -> Path:
    stage = root / "stage" / NAME
    files = {
        "README.md": "# Sample production\n",
        "code/run.py": "print(1)\n",
        "data/input.csv": "id,value\nA1,3\n",
        "tables/book.xlsx": "placeholder workbook bytes\n",
        "RUNBOOK.pdf": "placeholder pdf bytes\n",
    }
    for rel, text in files.items():
        p = stage / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        os.utime(p, (FIXED, FIXED))
    return stage


def read(stage: Path) -> list[list[str]]:
    with (stage / "MANIFEST.csv").open(encoding="utf-8", newline="") as fh:
        return list(csv.reader(fh))


def test_rows_are_sorted_relative_and_exclude_the_manifest(tmp_path):
    stage = make_stage(tmp_path)
    assert run(stage).returncode == 0
    rows = read(stage)
    assert rows[0] == ["path", "bytes", "sha256", "modified_utc"]
    paths = [r[0] for r in rows[1:]]
    assert paths == sorted(paths) == ["README.md", "RUNBOOK.pdf", "code/run.py", "data/input.csv", "tables/book.xlsx"]
    run_py = next(r for r in rows if r[0] == "code/run.py")
    assert run_py[1] == str(len(b"print(1)\n"))
    assert run_py[2] == hashlib.sha256(b"print(1)\n").hexdigest()
    assert run_py[3] == "2030-03-17T17:46:40Z"
    assert (stage / "MANIFEST.csv").read_bytes().endswith(b"\n")
    assert b"\r\n" not in (stage / "MANIFEST.csv").read_bytes()


def test_rewrite_never_lists_itself(tmp_path):
    stage = make_stage(tmp_path)
    assert run(stage).returncode == 0
    assert run(stage).returncode == 0
    assert "MANIFEST.csv" not in [r[0] for r in read(stage)]
    assert not (stage / "MANIFEST.csv.tmp").exists()


@pytest.mark.parametrize("junk", ["code/__pycache__/run.cpython-313.pyc", "stray.pyc", ".git/HEAD",
                                  ".ruff_cache/x", ".pytest_cache/y"])
def test_cache_and_vcs_entries_are_refused(tmp_path, junk):
    stage = make_stage(tmp_path)
    p = stage / junk
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")
    r = run(stage)
    assert r.returncode == 1
    assert "must not ship" in r.stderr
    assert not (stage / "MANIFEST.csv").exists()


def test_usage_errors_exit_two(tmp_path):
    assert run().returncode == 2
    assert run(tmp_path / "missing").returncode == 2


def archive_leg(tmp_path: Path, stage: Path) -> subprocess.CompletedProcess:
    spec = {
        "name": NAME,
        "stage": str(stage),
        "archive": str(tmp_path / "dist" / f"{NAME}.7z"),
        "entry_scripts": ["code/run.py"],
        "extra_files": ["data/input.csv"],
        "workbook": "tables/book.xlsx",
        "runbook_pdf": "RUNBOOK.pdf",
        "runbook_source": str(tmp_path / "internal" / "RUNBOOK.md"),
        "leak_terms": [],
        "reruns": [],
    }
    spec_path = tmp_path / "spec.json"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    extract = tmp_path / "extract"
    if extract.exists():
        shutil.rmtree(extract)
    extract.mkdir()
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    return subprocess.run([sys.executable, "-I", "-B", str(CHECK), "archive", "--spec", str(spec_path),
                           "--extract", str(extract), "--tmp", str(work)], capture_output=True, text=True)


needs_bsdtar = pytest.mark.skipif(shutil.which("bsdtar") is None, reason="bsdtar is not installed")


@needs_bsdtar
def test_archive_leg_accepts_what_manifest_writes(tmp_path):
    stage = make_stage(tmp_path)
    assert run(stage).returncode == 0
    r = archive_leg(tmp_path, stage)
    assert r.returncode == 0, r.stderr
    assert "archive: 6 file(s) examined" in r.stderr


@needs_bsdtar
def test_archive_leg_fails_an_mtime_drift_alone(tmp_path):
    stage = make_stage(tmp_path)
    assert run(stage).returncode == 0
    os.utime(stage / "code" / "run.py", (FIXED + 5, FIXED + 5))
    r = archive_leg(tmp_path, stage)
    assert r.returncode == 1
    assert "code/run.py: modified_utc" in r.stderr
    assert "sha256" not in r.stderr


@needs_bsdtar
def test_archive_leg_fails_a_manifest_that_lists_itself(tmp_path):
    stage = make_stage(tmp_path)
    assert run(stage).returncode == 0
    with (stage / "MANIFEST.csv").open("a", encoding="utf-8") as fh:
        fh.write("MANIFEST.csv,1,00,2030-03-17T17:46:40Z\n")
    r = archive_leg(tmp_path, stage)
    assert r.returncode == 1
    assert "MANIFEST.csv lists itself" in r.stderr
