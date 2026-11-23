"""R1 as a computation: ds_replay.py runs the project's replay command and its exit code decides.

Three fixture projects: replay exits 0 (PASS), replay exits 1 (FAIL), no replay command (FINDING, exit 0, lens judges).
Run: python3 -m pytest skills/ds/scripts/ds_replay_test.py -q
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "ds_replay.py"
CHECK_SH = Path(__file__).resolve().parent / "check.sh"


def project(tmp_path, plan_extra="", replay_rc=None, manifest=True):
    proj = tmp_path / "proj"
    (proj / "work/final/manifest").mkdir(parents=True)
    if manifest:
        (proj / "work/final/manifest/inputs.csv").write_text("path,md5,bytes,role\n")
    if replay_rc is not None:
        (proj / "work/final/replay.sh").write_text(f"echo replaying\nexit {replay_rc}\n")
    plan = tmp_path / "plan.md"
    plan.write_text("# plan\n\n## Reproducibility\n" + plan_extra)
    return plan, proj


def run(plan, proj):
    return subprocess.run([sys.executable, str(SCRIPT), "--plan", str(plan), "--project-dir", str(proj)], capture_output=True, text=True)


@pytest.mark.parametrize("rc,verdict", [(0, "R1 PASS: replay exit 0"), (1, "R1 FAIL: replay exit 1")])
def test_declared_replay_exit_code_decides(tmp_path, rc, verdict):
    plan, proj = project(tmp_path, f"- Replay command: `bash -c 'exit {rc}'`\n", manifest=False)
    r = run(plan, proj)
    assert r.returncode == rc, r.stdout + r.stderr
    assert verdict in r.stdout
    assert "ds-replay: 1 command(s) examined" in r.stdout


@pytest.mark.parametrize("rc", [0, 1])
def test_manifest_dir_replay_script_is_found(tmp_path, rc):
    plan, proj = project(tmp_path, replay_rc=rc)
    r = run(plan, proj)
    assert r.returncode == rc, r.stdout + r.stderr
    assert "replaying" in r.stdout and f"R1 {'PASS' if rc == 0 else 'FAIL'}" in r.stdout


def test_no_replay_command_is_a_finding_and_leaves_r1_to_the_lens(tmp_path):
    plan, proj = project(tmp_path, manifest=False)
    r = run(plan, proj)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "R1 FINDING: no replay command" in r.stdout
    assert "ds-replay: 1 plan(s) examined" in r.stdout


def test_manifest_without_a_script_and_a_plan_that_declares_none_are_findings(tmp_path):
    plan, proj = project(tmp_path)
    assert "R1 FINDING: no replay command" in run(plan, proj).stdout
    plan, proj = project(tmp_path / "b", "Replay command: none\n", replay_rc=1)
    assert "R1 FINDING: no replay command" in run(plan, proj).stdout


def test_timeout_fails(tmp_path, monkeypatch):
    plan, proj = project(tmp_path, "Replay command: `sleep 5`\n", manifest=False)
    monkeypatch.setenv("DS_REPLAY_TIMEOUT", "1")
    r = run(plan, proj)
    assert r.returncode == 1 and "R1 FAIL: replay exceeded 1s" in r.stdout


def test_missing_plan_is_a_usage_error(tmp_path):
    assert run(tmp_path / "nope.md", tmp_path).returncode == 2


@pytest.mark.parametrize("rc", [0, 1])
def test_check_sh_leg_follows_the_replay_exit(tmp_path, rc):
    plan, proj = project(tmp_path, f"Replay command: `exit {rc}`\n", manifest=False)
    stub = tmp_path / "stub_test.py"  # the ds-dq-tests leg runs DS_DQ_SUITE; pointing it at this file would recurse
    stub.write_text("def test_ok():\n    assert True\n")
    r = subprocess.run(["bash", str(CHECK_SH), "--plan", str(plan), "--project-dir", str(proj), "--no-test-cmd", "--no-lint-cmd"],
                       capture_output=True, text=True, env={**os.environ, "DS_DQ_SUITE": str(stub)})
    assert f"leg ds-replay exit={rc}" in r.stdout + r.stderr


def test_replication_skill_points_at_the_replay_contract():
    root = Path(__file__).resolve().parents[3]
    assert "references/replay.md" in (root / "skills/replication-package/SKILL.md").read_text()
