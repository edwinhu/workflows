# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for resolve-session.sh against a stub `tuicr review list`."""

import json
import shutil
import subprocess
from pathlib import Path

BASH = shutil.which("bash")
SCRIPT = Path(__file__).resolve().parent / "resolve-session.sh"
ROWS = [
    {"slug": "repo-pr-70", "anchor": "pr/70", "updated_at": "2026-01-01T00:00:00Z"},
    {"slug": "repo-wt", "anchor": "worktree", "updated_at": "2026-03-01T00:00:00Z"},
    {"slug": "repo-pr-71", "anchor": "pr/71", "updated_at": "2026-02-01T00:00:00Z"},
]


def stub(tmp_path, body):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    t = bindir / "tuicr"
    t.write_text("#!/usr/bin/env bash\n" + body)
    t.chmod(0o755)
    return bindir


def run(tmp_path, args, body=None, path=None):
    env = {"PATH": path if path is not None else f"{stub(tmp_path, body)}:/usr/bin:/bin",
           "HOME": str(tmp_path)}
    return subprocess.run([BASH, str(SCRIPT), *args], capture_output=True, text=True, env=env)


def listing(tmp_path, rows=ROWS):
    # stub echoes its argv to a log so scope flags are observable
    log = tmp_path / "argv.log"
    return f'echo "$@" >> {log}\ncat <<\'EOF\'\n{json.dumps(rows)}\nEOF\n', log


def test_newest_session_wins(tmp_path):
    body, log = listing(tmp_path)
    r = run(tmp_path, [], body)
    assert (r.returncode, r.stdout) == (0, "repo-wt\n")
    assert log.read_text().strip() == "review list --repo ."


def test_all_flag_changes_scope(tmp_path):
    body, log = listing(tmp_path)
    run(tmp_path, ["--all"], body)
    assert log.read_text().strip() == "review list --all"


def test_filter_matches_slug_or_anchor(tmp_path):
    body, _ = listing(tmp_path)
    assert run(tmp_path, ["71"], body).stdout == "repo-pr-71\n"
    assert run(tmp_path, ["worktree"], body).stdout == "repo-wt\n"


def test_no_match_prints_nothing_exit_1(tmp_path):
    body, _ = listing(tmp_path)
    r = run(tmp_path, ["nomatch"], body)
    assert (r.returncode, r.stdout) == (1, "")


def test_unparseable_or_failing_list_is_no_session(tmp_path):
    assert run(tmp_path, [], "echo not-json\n").returncode == 1
    assert run(tmp_path, [], "exit 2\n").returncode == 1


def test_missing_tuicr_errors(tmp_path):
    (tmp_path / "empty").mkdir()
    r = run(tmp_path, [], path=str(tmp_path / "empty"))
    assert (r.returncode, r.stdout, r.stderr) == (1, "", "error: tuicr not found in PATH\n")
