# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for init_project.sh and sync_all.sh (jupytext stubbed on PATH)."""

import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASH = shutil.which("bash")
HDR = "# ---\n# jupyter:\n#   jupytext:\n#     formats: ipynb,py:percent\n# ---\n"


def sh(script, args, cwd, path_extra=None):
    env = {"PATH": f"{path_extra}:/usr/bin:/bin" if path_extra else "/usr/bin:/bin",
           "HOME": str(cwd)}
    return subprocess.run([BASH, str(HERE / script), *args], capture_output=True, text=True,
                          cwd=cwd, env=env)


def stub_jupytext(tmp_path, fail_on=None):
    d = tmp_path / "stubbin"
    d.mkdir(exist_ok=True)
    log = tmp_path / "jt.log"
    cond = f'case "$2" in *{fail_on}*) exit 1;; esac\n' if fail_on else ""
    s = d / "jupytext"
    s.write_text(f'#!/usr/bin/env bash\n{cond}echo "$@" >> {log}\n')
    s.chmod(0o755)
    return d, log


def test_init_project_creates_layout(tmp_path):
    r = sh("init_project.sh", ["proj"], tmp_path)
    assert r.returncode == 0, r.stderr
    p = tmp_path / "proj"
    for d in ("notebooks", "data/raw", "data/processed", "results"):
        assert (p / d).is_dir()
    for f in ("jupytext.toml", "environment.yml", ".pre-commit-config.yaml", ".gitignore",
              "notebooks/01_analysis.py", "data/raw/.gitkeep", "data/processed/.gitkeep",
              "results/.gitkeep"):
        assert (p / f).is_file(), f
    assert 'formats = "ipynb,py:percent"' in (p / "jupytext.toml").read_text()
    assert (p / "notebooks/01_analysis.py").read_text().startswith("# ---\n# jupyter:")
    assert "Creating jupytext project: proj" in r.stdout
    assert "  1. cd proj" in r.stdout


def test_init_project_default_name_and_idempotent(tmp_path):
    assert sh("init_project.sh", [], tmp_path).returncode == 0
    assert (tmp_path / "my_project/jupytext.toml").is_file()
    (tmp_path / "my_project/jupytext.toml").write_text("custom")
    assert sh("init_project.sh", [], tmp_path).returncode == 0
    assert (tmp_path / "my_project/jupytext.toml").read_text().startswith("# Jupytext configuration")


def test_sync_all_syncs_only_headed_py_and_R(tmp_path):
    bindir, log = stub_jupytext(tmp_path)
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "a.py").write_text(HDR)
    (proj / "b.R").write_text(HDR)
    (proj / "plain.py").write_text("print(1)\n")
    r = sh("sync_all.sh", [str(proj)], tmp_path, bindir)
    assert r.returncode == 0, (r.stdout, r.stderr)
    assert sorted(log.read_text().split("\n")[:-1]) == [f"--sync {proj}/a.py", f"--sync {proj}/b.R"]
    assert "Synced: 2 files" in r.stdout and r.stdout.rstrip().endswith("Done.")


def test_sync_all_reports_failures_exit_1(tmp_path):
    bindir, _ = stub_jupytext(tmp_path, fail_on="bad")
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "bad.py").write_text(HDR)
    r = sh("sync_all.sh", [str(proj)], tmp_path, bindir)
    assert r.returncode == 1
    assert f"  ERROR: Failed to sync {proj}/bad.py" in r.stdout
    assert "Errors: 1 files" in r.stdout


def test_sync_all_empty_dir(tmp_path):
    bindir, _ = stub_jupytext(tmp_path)
    r = sh("sync_all.sh", [str(tmp_path / "stubbin")], tmp_path, bindir)
    assert r.returncode == 0 and "Synced: 0 files" in r.stdout
