"""matter-guard: a staged matter term is refused at commit and at push; clean work and an explicit
Matter-Override pass.

The term here is synthetic on purpose. A real matter name in this public file would publish it,
and the installed guard would refuse to commit the file anyway.
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

HOOKS = Path(__file__).resolve().parents[1] / "scripts" / "git-hooks"
TERM = "Zorblax Widgets"


def git(repo, *args, env, check=True):
    return subprocess.run(["git", "-C", str(repo), *args], env=env, capture_output=True, text=True, check=check)


@pytest.fixture
def repo(tmp_path):
    terms = tmp_path / "terms"
    terms.write_text(f"# test list\n\n{TERM}\n")
    env = {**os.environ, "MATTER_TERMS_FILE": str(terms), "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
    r = tmp_path / "r"
    subprocess.run(["git", "init", "-q", "-b", "main", str(r)], env=env, check=True)
    shutil.copytree(HOOKS, r / "scripts" / "git-hooks")
    subprocess.run(["bash", str(r / "scripts/git-hooks/matter-guard.sh"), "install"], cwd=r, env=env, check=True)
    return r, env, terms


def commit(r, env, text, msg="add notes", *extra):
    (r / "notes.md").write_text(text)
    git(r, "add", "notes.md", env=env)
    return git(r, "commit", "-q", *extra, "-m", msg, env=env, check=False)


def with_remote(r, env, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], env=env, check=True)
    git(r, "remote", "add", "origin", str(remote), env=env)
    assert commit(r, env, "clean line\n").returncode == 0
    assert git(r, "push", "-q", "origin", "main", env=env, check=False).returncode == 0


def test_staged_term_is_refused(repo):
    r, env, _ = repo
    res = commit(r, env, f"The {TERM.lower()} controller holds 79%.\n")
    assert res.returncode != 0 and "commit refused" in res.stderr
    assert TERM.lower() not in res.stderr.lower()  # the refusal names no term


def test_clean_commit_passes(repo):
    r, env, _ = repo
    assert commit(r, env, "ExampleCo's founder holds 79%.\n").returncode == 0
    assert git(r, "log", "--oneline", env=env).stdout.count("\n") == 1


def test_term_in_message_is_refused(repo):
    r, env, _ = repo
    res = commit(r, env, "clean line\n", f"rerun the {TERM} sample")
    assert res.returncode != 0 and "commit refused" in res.stderr


def test_override_line_lets_the_commit_through_and_says_so(repo):
    r, env, _ = repo
    res = commit(r, env, f"{TERM}\n", "add notes\n\nMatter-Override: public court filing, cleared")
    assert res.returncode == 0 and "override in message" in res.stderr


def test_empty_override_is_not_an_override(repo):
    r, env, _ = repo
    assert commit(r, env, f"{TERM}\n", "add notes\n\nMatter-Override:").returncode != 0


def test_missing_terms_file_fails_closed(repo):
    r, env, terms = repo
    terms.unlink()
    res = commit(r, env, "clean line\n")
    assert res.returncode != 0 and "fail closed" in res.stderr


def test_push_refuses_a_commit_made_without_hooks(repo, tmp_path):
    r, env, _ = repo
    with_remote(r, env, tmp_path)
    assert commit(r, env, f"{TERM}\n", "bypass", "--no-verify").returncode == 0
    res = git(r, "push", "origin", "main", env=env, check=False)
    assert res.returncode != 0 and "push refused" in res.stderr


def test_push_passes_an_overridden_commit(repo, tmp_path):
    r, env, _ = repo
    with_remote(r, env, tmp_path)
    assert commit(r, env, f"{TERM}\n", "add notes\n\nMatter-Override: cleared").returncode == 0
    res = git(r, "push", "origin", "main", env=env, check=False)
    assert res.returncode == 0 and "carries Matter-Override" in res.stderr
